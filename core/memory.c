#define _POSIX_C_SOURCE 200809L
#include "memory.h"

#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#define READINGS_PER_PAGE 4U
#define EMPTY_PAGE UINT64_MAX

static long long elapsed_ms(const struct timespec *start)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long long)(now.tv_sec - start->tv_sec) * 1000LL +
           (long long)(now.tv_nsec - start->tv_nsec) / 1000000LL;
}

static const char *page_algorithm_name(PageAlgorithm algorithm)
{
    return algorithm == PAGE_LRU ? "lru" : "fifo";
}

int memory_init(MemoryManager *memory, size_t sensor_count, size_t buffer_size,
                size_t frame_count, PageAlgorithm algorithm,
                const struct timespec *start_time)
{
    *memory = (MemoryManager){0};
    memory->sensor_rings = calloc(sensor_count, sizeof(*memory->sensor_rings));
    memory->frames = malloc(frame_count * sizeof(*memory->frames));
    memory->last_used = calloc(frame_count, sizeof(*memory->last_used));
    if (memory->sensor_rings == NULL || memory->frames == NULL || memory->last_used == NULL) {
        free(memory->sensor_rings);
        free(memory->frames);
        free(memory->last_used);
        return -1;
    }

    size_t initialized_rings = 0;
    for (; initialized_rings < sensor_count; initialized_rings++) {
        memory->sensor_rings[initialized_rings].values =
            calloc(buffer_size, sizeof(*memory->sensor_rings[initialized_rings].values));
        if (memory->sensor_rings[initialized_rings].values == NULL) break;
        memory->sensor_rings[initialized_rings].capacity = buffer_size;
    }
    if (initialized_rings != sensor_count || pthread_mutex_init(&memory->mutex, NULL) != 0) {
        for (size_t i = 0; i < initialized_rings; i++) free(memory->sensor_rings[i].values);
        free(memory->sensor_rings);
        free(memory->frames);
        free(memory->last_used);
        return -1;
    }

    memory->sensor_count = sensor_count;
    memory->buffer_size = buffer_size;
    memory->frame_count = frame_count;
    memory->algorithm = algorithm;
    memory->start_time = start_time;
    for (size_t i = 0; i < frame_count; i++) memory->frames[i] = EMPTY_PAGE;
    return 0;
}

void memory_destroy(MemoryManager *memory)
{
    for (size_t i = 0; i < memory->sensor_count; i++) free(memory->sensor_rings[i].values);
    free(memory->sensor_rings);
    free(memory->frames);
    free(memory->last_used);
    pthread_mutex_destroy(&memory->mutex);
    *memory = (MemoryManager){0};
}

/* OS concept: each sensor's bounded circular buffer overwrites its oldest reading. */
/* OS concept: queue_mutex -> memory_mutex -> log_mutex is the global nested lock order.
 * Sensor code releases queue_mutex before calling this API, so only memory_mutex is held here. */
void memory_record_reading(MemoryManager *memory, int sensor_id, double value)
{
    if (sensor_id < 0 || (size_t)sensor_id >= memory->sensor_count) return;

    uint64_t frame_snapshot[MEMORY_MAX_FRAMES];
    uint64_t page;
    uint64_t victim = EMPTY_PAGE;
    long long timestamp;
    int is_fault = 0;

    pthread_mutex_lock(&memory->mutex);
    ReadingRing *ring = &memory->sensor_rings[sensor_id];
    size_t slot = ring->next_index;
    ring->values[slot] = value;
    ring->next_index = (slot + 1) % ring->capacity;
    if (ring->count < ring->capacity) ring->count++;

    /* One logical page holds four ring slots; page IDs are disjoint across sensors. */
    size_t pages_per_sensor = (memory->buffer_size + READINGS_PER_PAGE - 1) / READINGS_PER_PAGE;
    page = (uint64_t)((size_t)sensor_id * pages_per_sensor + slot / READINGS_PER_PAGE);
    memory->accesses++;
    size_t target = memory->frame_count;
    for (size_t i = 0; i < memory->frame_count; i++) {
        if (memory->frames[i] == page) {
            target = i;
            break;
        }
    }

    if (target == memory->frame_count) {
        is_fault = 1;
        memory->faults++;
        for (size_t i = 0; i < memory->frame_count; i++) {
            if (memory->frames[i] == EMPTY_PAGE) {
                target = i;
                break;
            }
        }
        if (target == memory->frame_count) {
            if (memory->algorithm == PAGE_FIFO) {
                target = memory->fifo_next;
                memory->fifo_next = (memory->fifo_next + 1) % memory->frame_count;
            } else {
                target = 0;
                for (size_t i = 1; i < memory->frame_count; i++) {
                    if (memory->last_used[i] < memory->last_used[target]) target = i;
                }
            }
            victim = memory->frames[target];
        } else if (memory->algorithm == PAGE_FIFO) {
            memory->fifo_next = (target + 1) % memory->frame_count;
        }
        memory->frames[target] = page;
    }

    memory->last_used[target] = ++memory->lru_clock;
    for (size_t i = 0; i < memory->frame_count; i++) frame_snapshot[i] = memory->frames[i];
    timestamp = elapsed_ms(memory->start_time);
    pthread_mutex_unlock(&memory->mutex);

    printf("{\"t\":%lld,\"ev\":\"page_access\",\"sensor\":%d,\"page\":%" PRIu64 ",\"status\":\"%s\"}\n",
           timestamp, sensor_id, page, is_fault ? "fault" : "hit");
    if (is_fault) {
        /* Keep the variable-length frame array on one indivisible JSON output line. */
        flockfile(stdout);
        printf("{\"t\":%lld,\"ev\":\"page_fault\",\"sensor\":%d,\"page\":%" PRIu64 ",\"algo\":\"%s\",\"frames\":[",
               timestamp, sensor_id, page, page_algorithm_name(memory->algorithm));
        for (size_t i = 0; i < memory->frame_count; i++) {
            if (i > 0) putchar(',');
            if (frame_snapshot[i] == EMPTY_PAGE) fputs("null", stdout);
            else printf("%" PRIu64, frame_snapshot[i]);
        }
        fputs("],\"victim\":", stdout);
        if (victim == EMPTY_PAGE) fputs("null", stdout);
        else printf("%" PRIu64, victim);
        fputs("}\n", stdout);
        fflush(stdout);
        funlockfile(stdout);
    }
}

void *memory_stats_thread(void *argument)
{
    MemoryStatsContext *context = argument;
    while (!*context->shutdown_requested) {
        struct timespec delay = {2, 0};
        while (nanosleep(&delay, &delay) == -1 && errno == EINTR) { }
        if (*context->shutdown_requested) break;

        pthread_mutex_lock(&context->memory->mutex);
        uint64_t accesses = context->memory->accesses;
        uint64_t faults = context->memory->faults;
        pthread_mutex_unlock(&context->memory->mutex);
        double hit_ratio = accesses == 0 ? 0.0 : (double)(accesses - faults) / (double)accesses;
        printf("{\"t\":%lld,\"ev\":\"mem_stats\",\"accesses\":%" PRIu64 ",\"faults\":%" PRIu64 ",\"hit_ratio\":%.3f}\n",
               elapsed_ms(context->memory->start_time), accesses, faults, hit_ratio);
        fflush(stdout);
    }
    return NULL;
}
