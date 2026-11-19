/*
 * Lock order: queue_mutex -> memory_mutex -> log_mutex if locks are nested.
 * Current paths never nest these locks: queue operations release queue_mutex
 * before memory access; page events take stdout's FILE lock only while holding
 * memory_mutex, and no output path takes an application mutex while holding stdout.
 * This keeps the order consistent and prevents a circular-wait deadlock.
 */
#define _POSIX_C_SOURCE 200809L
#include "queue.h"
#include "scheduler.h"
#include "sensor.h"
#include "memory.h"

#include <errno.h>
#include <inttypes.h>
#include <pthread.h>
#include <semaphore.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define MAX_SENSORS 128

static volatile sig_atomic_t shutdown_requested = 0;
static sem_t *signal_empty_slots;
static int signal_sensor_count;
static struct timespec program_start;

static void handle_sigint(int signal_number)
{
    (void)signal_number;
    shutdown_requested = 1;
    if (signal_empty_slots != NULL) {
        for (int i = 0; i < signal_sensor_count; i++) sem_post(signal_empty_slots);
    }
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

static int parse_algorithm(const char *name, SchedulerAlgorithm *algorithm)
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

static int parse_options(int argc, char **argv, int *sensors, int *queue_size,
                         SchedulerAlgorithm *algorithm, int *quantum_ms,
                         int *buffer_size, int *page_size, int *frame_count,
                         PageAlgorithm *page_algorithm, uint32_t *seed,
                         int *page_trace_only)
{
    *sensors = 4;
    *queue_size = 16;
    *algorithm = SCHED_PRIORITY;
    *quantum_ms = 100;
    *buffer_size = 16;
    *frame_count = 8;
    *page_algorithm = PAGE_FIFO;
    *page_size = 4;
    *seed = (uint32_t)time(NULL);
    if (*seed == 0) *seed = 1;
    *page_trace_only = 0;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--page-trace-only") == 0) {
            *page_trace_only = 1;
            continue;
        }
        if (i + 1 >= argc) return -1;
        int *destination = NULL;
        int maximum = 0;
        if (strcmp(argv[i], "--sensors") == 0) {
            destination = sensors;
            maximum = MAX_SENSORS;
        } else if (strcmp(argv[i], "--queue-size") == 0) {
            destination = queue_size;
            maximum = 100000;
        } else if (strcmp(argv[i], "--quantum") == 0) {
            destination = quantum_ms;
            maximum = 60000;
        } else if (strcmp(argv[i], "--buffer-size") == 0) {
            destination = buffer_size;
            maximum = 65536;
        } else if (strcmp(argv[i], "--page-size") == 0) {
            destination = page_size;
            maximum = 65536;
        } else if (strcmp(argv[i], "--frames") == 0) {
            destination = frame_count;
            maximum = MEMORY_MAX_FRAMES;
        } else if (strcmp(argv[i], "--algo") == 0) {
            if (parse_algorithm(argv[++i], algorithm) == -1) return -1;
            continue;
        } else if (strcmp(argv[i], "--page-algo") == 0) {
            if (parse_page_algorithm(argv[++i], page_algorithm) == -1) return -1;
            continue;
        } else if (strcmp(argv[i], "--seed") == 0) {
            if (parse_seed(argv[++i], seed) == -1) return -1;
            continue;
        } else {
            return -1;
        }
        if (parse_positive(argv[++i], maximum, destination) == -1) return -1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    int sensor_count;
    int queue_capacity;
    int quantum_ms;
    int buffer_size;
    int page_size;
    int frame_count;
    int page_trace_only;
    uint32_t seed;
    SchedulerAlgorithm algorithm;
    PageAlgorithm page_algorithm;
    if (parse_options(argc, argv, &sensor_count, &queue_capacity, &algorithm, &quantum_ms,
                      &buffer_size, &page_size, &frame_count, &page_algorithm,
                      &seed, &page_trace_only) == -1 || page_size > buffer_size) {
        fprintf(stderr, "Usage: %s [--sensors N] [--queue-size N] [--algo priority|rr|sjf] [--quantum MS] [--buffer-size N] [--page-size N] [--frames N] [--page-algo fifo|lru] [--seed N] [--page-trace-only]\n", argv[0]);
        return EXIT_FAILURE;
    }

    printf("{\"t\":0,\"ev\":\"config\",\"seed\":%" PRIu32 ",\"sensors\":%d,\"queue_size\":%d,\"buffer_size\":%d,\"page_size\":%d,\"frames\":%d,\"page_algo\":\"%s\",\"page_trace_only\":%s}\n",
           seed, sensor_count, queue_capacity, buffer_size, page_size, frame_count,
           page_algorithm == PAGE_LRU ? "lru" : "fifo", page_trace_only ? "true" : "false");
    fflush(stdout);
    if (page_trace_only) {
        memory_run_page_comparison((size_t)sensor_count, (size_t)buffer_size,
                                   (size_t)page_size, (size_t)frame_count, seed);
        return EXIT_SUCCESS;
    }

    PriorityQueue queue;
    sem_t empty_slots;
    sem_t full_slots;
    if (queue_init(&queue, (size_t)queue_capacity) == -1) {
        fprintf(stderr, "Failed to initialize queue or semaphores\n");
        return EXIT_FAILURE;
    }
    if (sem_init(&empty_slots, 0, (unsigned int)queue_capacity) == -1) {
        fprintf(stderr, "Failed to initialize queue or semaphores\n");
        queue_destroy(&queue);
        return EXIT_FAILURE;
    }
    if (sem_init(&full_slots, 0, 0) == -1) {
        fprintf(stderr, "Failed to initialize queue or semaphores\n");
        sem_destroy(&empty_slots);
        queue_destroy(&queue);
        return EXIT_FAILURE;
    }

    clock_gettime(CLOCK_MONOTONIC, &program_start);
    MemoryManager memory;
    if (memory_init(&memory, (size_t)sensor_count, (size_t)buffer_size,
                    (size_t)page_size, (size_t)frame_count, page_algorithm,
                    seed, &shutdown_requested, &program_start) == -1) {
        fprintf(stderr, "Failed to initialize memory module\n");
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        queue_destroy(&queue);
        return EXIT_FAILURE;
    }

    signal_empty_slots = &empty_slots;
    signal_sensor_count = sensor_count;
    struct sigaction action;
    memset(&action, 0, sizeof(action));
    action.sa_handler = handle_sigint;
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGINT, &action, NULL) == -1) {
        perror("sigaction");
        memory_destroy(&memory);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        queue_destroy(&queue);
        return EXIT_FAILURE;
    }

    atomic_uint_fast64_t next_alert_id;
    atomic_init(&next_alert_id, 1);
    pthread_t scheduler;
    pthread_t *threads = calloc((size_t)sensor_count, sizeof(*threads));
    SensorContext *contexts = calloc((size_t)sensor_count, sizeof(*contexts));
    if (threads == NULL || contexts == NULL) {
        fprintf(stderr, "Failed to create threads\n");
        free(threads);
        free(contexts);
        memory_destroy(&memory);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        queue_destroy(&queue);
        return EXIT_FAILURE;
    }
    SchedulerContext scheduler_context = {
        .queue = &queue,
        .empty_slots = &empty_slots,
        .full_slots = &full_slots,
        .shutdown_requested = &shutdown_requested,
        .start_time = &program_start,
        .queue_capacity = (size_t)queue_capacity,
        .algorithm = algorithm,
        .quantum_ms = quantum_ms
    };
    if (pthread_create(&scheduler, NULL, scheduler_thread, &scheduler_context) != 0) {
        fprintf(stderr, "Failed to create scheduler thread\n");
        free(threads);
        free(contexts);
        memory_destroy(&memory);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        queue_destroy(&queue);
        return EXIT_FAILURE;
    }

    MemoryStatsContext memory_stats_context = {
        .memory = &memory,
        .shutdown_requested = &shutdown_requested
    };
    pthread_t memory_stats;
    if (pthread_create(&memory_stats, NULL, memory_stats_thread, &memory_stats_context) != 0) {
        fprintf(stderr, "Failed to create memory statistics thread\n");
        shutdown_requested = 1;
        sem_post(&full_slots);
        pthread_join(scheduler, NULL);
        free(threads);
        free(contexts);
        memory_destroy(&memory);
        sem_destroy(&full_slots);
        sem_destroy(&empty_slots);
        queue_destroy(&queue);
        return EXIT_FAILURE;
    }

    int created = 0;
    for (int i = 0; i < sensor_count; i++) {
        contexts[i] = (SensorContext){
            .sensor_id = i,
            .seed = seed ^ ((unsigned int)(i + 1) * 0x9e3779b9U),
            .queue = &queue,
            .empty_slots = &empty_slots,
            .full_slots = &full_slots,
            .shutdown_requested = &shutdown_requested,
            .start_time = &program_start,
            .memory = &memory,
            .next_alert_id = &next_alert_id
        };
        /* OS concept: each pthread owns its sensor context and random seed. */
        if (pthread_create(&threads[i], NULL, sensor_thread, &contexts[i]) != 0) break;
        created++;
    }

    if (created != sensor_count) {
        fprintf(stderr, "Failed to create all sensor threads; shutting down\n");
        shutdown_requested = 1;
        for (int i = 0; i < created; i++) sem_post(&empty_slots);
    }
    for (int i = 0; i < created; i++) pthread_join(threads[i], NULL);
    shutdown_requested = 1;
    sem_post(&full_slots);
    pthread_join(scheduler, NULL);
    pthread_join(memory_stats, NULL);

    free(contexts);
    free(threads);
    sem_destroy(&full_slots);
    sem_destroy(&empty_slots);
    queue_destroy(&queue);
    memory_destroy(&memory);
    return created == sensor_count ? EXIT_SUCCESS : EXIT_FAILURE;
}
