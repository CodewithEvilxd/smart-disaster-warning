/*
 * Lock order: queue_mutex -> memory_mutex -> event pipe; there is no log mutex.
 * Queue users release queue_mutex before memory access or event writes. Memory
 * page events write to the pipe while holding memory_mutex, and the logger takes
 * no application locks. The logger is the only stdout/file writer, so no reverse
 * lock path exists and there is no circular-wait deadlock.
 */
#define _POSIX_C_SOURCE 200809L
#include "event_log.h"
#include "logger.h"
#include "memory.h"
#include "queue.h"
#include "scheduler.h"
#include "sensor.h"
#include "watchdog.h"

#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <pthread.h>
#include <semaphore.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define MAX_SENSORS 128
#define MAX_FRAMES_FOR_PIPE 128

static volatile sig_atomic_t shutdown_requested = 0;
static sem_t *signal_full_slots;
static struct timespec program_start;

static void handle_sigint(int signal_number)
{
    (void)signal_number;
    shutdown_requested = 1;
    if (signal_full_slots != NULL) sem_post(signal_full_slots);
}

static long long elapsed_ms(void)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long long)(now.tv_sec - program_start.tv_sec) * 1000LL +
           (long long)(now.tv_nsec - program_start.tv_nsec) / 1000000LL;
}

static int parse_positive(const char *text, int maximum, int *result)
{
    char *end = NULL;
    errno = 0;
    long value = strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || value < 1 || value > maximum) return -1;
    *result = (int)value;
    return 0;
}

static int parse_seed(const char *text, uint32_t *seed)
{
    char *end = NULL;
    errno = 0;
    unsigned long long value = strtoull(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || value > UINT32_MAX) return -1;
    *seed = (uint32_t)value;
    return 0;
}

static int parse_injection(const char *text, int *sensor_id, long long *at_ms)
{
    char *separator = strchr(text, '@');
    if (separator == NULL || separator == text || separator[1] == '\0') return -1;
    char *end = NULL;
    errno = 0;
    long sensor = strtol(text, &end, 10);
    if (errno != 0 || end != separator || sensor < 0 || sensor >= MAX_SENSORS) return -1;
    errno = 0;
    long long seconds = strtoll(separator + 1, &end, 10);
    if (errno != 0 || end == separator + 1 || *end != '\0' || seconds < 0 || seconds > LLONG_MAX / 1000)
        return -1;
    *sensor_id = (int)sensor;
    *at_ms = seconds * 1000;
    return 0;
}

static int parse_scheduler_algorithm(const char *name, SchedulerAlgorithm *algorithm)
{
    if (strcmp(name, "priority") == 0) *algorithm = SCHED_PRIORITY;
    else if (strcmp(name, "rr") == 0) *algorithm = SCHED_ROUND_ROBIN;
    else if (strcmp(name, "sjf") == 0) *algorithm = SCHED_SJF;
    else return -1;
    return 0;
}

static int parse_page_algorithm(const char *name, PageAlgorithm *algorithm)
{
    if (strcmp(name, "fifo") == 0) *algorithm = PAGE_FIFO;
    else if (strcmp(name, "lru") == 0) *algorithm = PAGE_LRU;
    else return -1;
    return 0;
}

typedef struct {
    int sensor_count;
    int queue_capacity;
    int quantum_ms;
    int buffer_size;
    int page_size;
    int frame_count;
    int heartbeat_timeout_ms;
    SchedulerAlgorithm scheduler_algorithm;
    PageAlgorithm page_algorithm;
    uint32_t seed;
    int page_trace_only;
    int inject_sensor;
    long long inject_at_ms;
    int inject_fault_enabled;
    int inject_random_enabled;
} Options;

static int parse_options(int argc, char **argv, Options *options)
{
    *options = (Options){
        .sensor_count = 4,
        .queue_capacity = 16,
        .quantum_ms = 100,
        .buffer_size = 16,
        .page_size = 4,
        .frame_count = 8,
        .heartbeat_timeout_ms = 3000,
        .scheduler_algorithm = SCHED_PRIORITY,
        .page_algorithm = PAGE_FIFO,
        .seed = (uint32_t)time(NULL),
        .inject_sensor = -1
    };
    if (options->seed == 0) options->seed = 1;

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--page-trace-only") == 0) {
            options->page_trace_only = 1;
            continue;
        }
        if (strcmp(argv[i], "--inject-random") == 0) {
            options->inject_random_enabled = 1;
            continue;
        }
        if (i + 1 >= argc) return -1;
        int *numeric = NULL;
        int maximum = 0;
        if (strcmp(argv[i], "--sensors") == 0) {
            numeric = &options->sensor_count;
            maximum = MAX_SENSORS;
        } else if (strcmp(argv[i], "--queue-size") == 0) {
            numeric = &options->queue_capacity;
            maximum = 100000;
        } else if (strcmp(argv[i], "--quantum") == 0) {
            numeric = &options->quantum_ms;
            maximum = 60000;
        } else if (strcmp(argv[i], "--buffer-size") == 0) {
            numeric = &options->buffer_size;
            maximum = 65536;
        } else if (strcmp(argv[i], "--page-size") == 0) {
            numeric = &options->page_size;
            maximum = 65536;
        } else if (strcmp(argv[i], "--frames") == 0) {
            numeric = &options->frame_count;
            maximum = MAX_FRAMES_FOR_PIPE;
        } else if (strcmp(argv[i], "--hb-timeout") == 0) {
            numeric = &options->heartbeat_timeout_ms;
            maximum = 600000;
        } else if (strcmp(argv[i], "--algo") == 0) {
            if (parse_scheduler_algorithm(argv[++i], &options->scheduler_algorithm) == -1) return -1;
            continue;
        } else if (strcmp(argv[i], "--page-algo") == 0) {
            if (parse_page_algorithm(argv[++i], &options->page_algorithm) == -1) return -1;
            continue;
        } else if (strcmp(argv[i], "--seed") == 0) {
            if (parse_seed(argv[++i], &options->seed) == -1) return -1;
            continue;
        } else if (strcmp(argv[i], "--inject-fault") == 0) {
            if (parse_injection(argv[++i], &options->inject_sensor, &options->inject_at_ms) == -1) return -1;
            options->inject_fault_enabled = 1;
            continue;
        } else return -1;
        if (parse_positive(argv[++i], maximum, numeric) == -1) return -1;
    }
    if (options->page_size > options->buffer_size || options->inject_sensor >= options->sensor_count)
        return -1;
    return 0;
}

static void emit_config(const Options *options)
{
    event_log_emit("{\"t\":0,\"ev\":\"config\",\"seed\":%" PRIu32 ",\"sensors\":%d,\"queue_size\":%d,\"algo\":\"%s\",\"frames\":%d,\"page_algo\":\"%s\",\"hb_timeout_ms\":%d}",
                   options->seed, options->sensor_count, options->queue_capacity,
                   scheduler_algorithm_name(options->scheduler_algorithm), options->frame_count,
                   options->page_algorithm == PAGE_LRU ? "lru" : "fifo", options->heartbeat_timeout_ms);
}

static void wake_all_sensors(SensorContext *sensors, int count)
{
    for (int i = 0; i < count; i++) {
        atomic_store(&sensors[i].stop_requested, true);
        pthread_mutex_lock(&sensors[i].fault_mutex);
        pthread_cond_broadcast(&sensors[i].fault_condition);
        pthread_mutex_unlock(&sensors[i].fault_mutex);
    }
}

static void cleanup_sensor_controls(SensorContext *sensors, int initialized)
{
    for (int i = 0; i < initialized; i++) {
        pthread_cond_destroy(&sensors[i].fault_condition);
        pthread_mutex_destroy(&sensors[i].fault_mutex);
    }
}

int main(int argc, char **argv)
{
    Options options;
    if (parse_options(argc, argv, &options) == -1) {
        fprintf(stderr, "Usage: %s [--sensors N] [--queue-size N] [--algo priority|rr|sjf] [--quantum MS] [--buffer-size N] [--page-size N] [--frames N] [--page-algo fifo|lru] [--seed N] [--page-trace-only] [--hb-timeout MS] [--inject-fault SENSOR_ID@SECONDS] [--inject-random]\n", argv[0]);
        return EXIT_FAILURE;
    }
    if (options.page_trace_only) {
        printf("{\"t\":0,\"ev\":\"config\",\"seed\":%" PRIu32 ",\"page_trace_only\":true}\n",
               options.seed);
        memory_run_page_comparison((size_t)options.sensor_count, (size_t)options.buffer_size,
                                   (size_t)options.page_size, (size_t)options.frame_count,
                                   options.seed);
        return EXIT_SUCCESS;
    }

    PriorityQueue queue;
    sem_t empty_slots;
    sem_t full_slots;
    if (sem_init(&empty_slots, 0, (unsigned int)options.queue_capacity) == -1) {
        perror("sem_init empty_slots");
        return EXIT_FAILURE;
    }
    if (sem_init(&full_slots, 0, 0) == -1) {
        perror("sem_init full_slots");
        sem_destroy(&empty_slots);
        return EXIT_FAILURE;
    }
    if (queue_init(&queue, (size_t)options.queue_capacity, &empty_slots, &full_slots) == -1) {
        fprintf(stderr, "Failed to initialize priority queue\n");
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        return EXIT_FAILURE;
    }

    clock_gettime(CLOCK_MONOTONIC, &program_start);
    MemoryManager memory;
    if (memory_init(&memory, (size_t)options.sensor_count, (size_t)options.buffer_size,
                    (size_t)options.page_size, (size_t)options.frame_count,
                    options.page_algorithm, options.seed, &shutdown_requested,
                    &program_start) == -1) {
        fprintf(stderr, "Failed to initialize memory module\n");
        queue_destroy(&queue);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        return EXIT_FAILURE;
    }

    SensorContext *sensors = calloc((size_t)options.sensor_count, sizeof(*sensors));
    if (sensors == NULL) {
        fprintf(stderr, "Failed to allocate sensor contexts\n");
        memory_destroy(&memory);
        queue_destroy(&queue);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        return EXIT_FAILURE;
    }
    int controls_initialized = 0;
    for (; controls_initialized < options.sensor_count; controls_initialized++) {
        SensorContext *sensor = &sensors[controls_initialized];
        sensor->sensor_id = controls_initialized;
        sensor->seed = options.seed ^ ((unsigned int)(controls_initialized + 1) * 0x9e3779b9U);
        sensor->queue = &queue;
        sensor->shutdown_requested = &shutdown_requested;
        sensor->start_time = &program_start;
        sensor->memory = &memory;
        atomic_init(&sensor->last_heartbeat_ms, 0);
        atomic_init(&sensor->last_reading_bits, 0);
        atomic_init(&sensor->restart_count, 0);
        atomic_init(&sensor->fault_requested, false);
        atomic_init(&sensor->stop_requested, false);
        atomic_init(&sensor->is_up, false);
        if (pthread_mutex_init(&sensor->fault_mutex, NULL) != 0) break;
        if (pthread_cond_init(&sensor->fault_condition, NULL) != 0) {
            pthread_mutex_destroy(&sensor->fault_mutex);
            break;
        }
    }
    if (controls_initialized != options.sensor_count) {
        fprintf(stderr, "Failed to initialize sensor controls\n");
        cleanup_sensor_controls(sensors, controls_initialized);
        free(sensors);
        memory_destroy(&memory);
        queue_destroy(&queue);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        return EXIT_FAILURE;
    }

    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = handle_sigint;
    sigemptyset(&action.sa_mask);
    signal_full_slots = &full_slots;
    if (sigaction(SIGINT, &action, NULL) == -1) {
        perror("sigaction");
        cleanup_sensor_controls(sensors, controls_initialized);
        free(sensors);
        memory_destroy(&memory);
        queue_destroy(&queue);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        return EXIT_FAILURE;
    }

    LoggerContext logger = {0};
    int event_pipe[2];
    if (logger_prepare(&logger) == -1 || pipe(event_pipe) == -1) {
        perror("logger or pipe setup");
        if (logger.log_file != NULL) fclose(logger.log_file);
        cleanup_sensor_controls(sensors, controls_initialized);
        free(sensors);
        memory_destroy(&memory);
        queue_destroy(&queue);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        return EXIT_FAILURE;
    }
    logger.read_fd = event_pipe[0];
    pthread_t logger_handle;
    if (pthread_create(&logger_handle, NULL, logger_thread, &logger) != 0) {
        fprintf(stderr, "Failed to create logger thread\n");
        close(event_pipe[0]);
        close(event_pipe[1]);
        fclose(logger.log_file);
        cleanup_sensor_controls(sensors, controls_initialized);
        free(sensors);
        memory_destroy(&memory);
        queue_destroy(&queue);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        return EXIT_FAILURE;
    }
    event_log_set_fd(event_pipe[1]);
    emit_config(&options);

    atomic_uint_fast64_t next_alert_id;
    atomic_init(&next_alert_id, 1);
    for (int i = 0; i < options.sensor_count; i++)
        sensors[i].next_alert_id = &next_alert_id;
    SchedulerContext scheduler_context = {
        .queue = &queue,
        .empty_slots = &empty_slots,
        .full_slots = &full_slots,
        .shutdown_requested = &shutdown_requested,
        .start_time = &program_start,
        .queue_capacity = (size_t)options.queue_capacity,
        .algorithm = options.scheduler_algorithm,
        .quantum_ms = options.quantum_ms
    };
    MemoryStatsContext memory_stats_context = {
        .memory = &memory,
        .shutdown_requested = &shutdown_requested
    };
    WatchdogContext watchdog_context = {
        .sensors = sensors,
        .sensor_count = (size_t)options.sensor_count,
        .shutdown_requested = &shutdown_requested,
        .start_time = &program_start,
        .heartbeat_timeout_ms = (unsigned int)options.heartbeat_timeout_ms,
        .injected_sensor = options.inject_sensor,
        .inject_at_ms = options.inject_at_ms,
        .inject_fault_enabled = options.inject_fault_enabled,
        .inject_random_enabled = options.inject_random_enabled,
        .random_state = options.seed ^ 0xa511e9b3U
    };

    pthread_t scheduler_handle;
    pthread_t memory_stats_handle;
    pthread_t watchdog_handle;
    int scheduler_started = 0;
    int memory_stats_started = 0;
    int watchdog_started = 0;
    int sensor_count_started = 0;
    if (pthread_create(&scheduler_handle, NULL, scheduler_thread, &scheduler_context) == 0)
        scheduler_started = 1;
    if (scheduler_started && pthread_create(&memory_stats_handle, NULL, memory_stats_thread,
                                           &memory_stats_context) == 0)
        memory_stats_started = 1;
    if (memory_stats_started) {
        for (int i = 0; i < options.sensor_count; i++) {
            atomic_store(&sensors[i].last_heartbeat_ms, (uint64_t)elapsed_ms());
            atomic_store(&sensors[i].is_up, true);
            if (pthread_create(&sensors[i].thread, NULL, sensor_thread, &sensors[i]) != 0) {
                atomic_store(&sensors[i].is_up, false);
                break;
            }
            sensors[i].thread_started = 1;
            sensor_count_started++;
        }
    }
    if (sensor_count_started == options.sensor_count &&
        pthread_create(&watchdog_handle, NULL, watchdog_thread, &watchdog_context) == 0)
        watchdog_started = 1;

    if (!scheduler_started || !memory_stats_started || sensor_count_started != options.sensor_count ||
        !watchdog_started) {
        fprintf(stderr, "Failed to create all worker threads; stopping started workers\n");
        shutdown_requested = 1;
        sem_post(&full_slots);
        wake_all_sensors(sensors, options.sensor_count);
    }
    if (watchdog_started) pthread_join(watchdog_handle, NULL);
    for (int i = 0; i < options.sensor_count; i++) {
        if (sensors[i].thread_started) {
            pthread_join(sensors[i].thread, NULL);
            sensors[i].thread_started = 0;
        }
    }
    if (scheduler_started) pthread_join(scheduler_handle, NULL);
    if (memory_stats_started) pthread_join(memory_stats_handle, NULL);

    event_log_set_fd(-1);
    close(event_pipe[1]);
    pthread_join(logger_handle, NULL);

    cleanup_sensor_controls(sensors, controls_initialized);
    free(sensors);
    memory_destroy(&memory);
    queue_destroy(&queue);
    sem_destroy(&full_slots);
    sem_destroy(&empty_slots);
    return (!scheduler_started || !memory_stats_started ||
            sensor_count_started != options.sensor_count || !watchdog_started || logger.failed)
           ? EXIT_FAILURE : EXIT_SUCCESS;
}
