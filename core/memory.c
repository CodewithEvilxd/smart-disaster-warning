#define _POSIX_C_SOURCE 200809L
#include "memory.h"

#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#define EMPTY_PAGE UINT64_MAX
#define RECENT_PAGE_WINDOW 3U
#define LOCALITY_PERCENT 80U

static long long elapsed_ms(const struct timespec *start)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long long)(now.tv_sec - start->tv_sec) * 1000LL +
           (long long)(now.tv_nsec - start->tv_nsec) / 1000000LL;
}

static uint32_t next_random(uint32_t *state)
{
    if (*state == 0) *state = 0x6d2b79f5U;
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    return *state;
}

static const char *page_algorithm_name(PageAlgorithm algorithm)
{
    return algorithm == PAGE_LRU ? "lru" : "fifo";
}

static size_t pages_per_sensor(size_t buffer_size, size_t page_size)
{
    return (buffer_size + page_size - 1) / page_size;
}

/* OS concept: map a reading's ring slot to a page, then favor the sensor's recent pages (80%). */
static uint64_t choose_reading_page(size_t sensor_id, size_t slot, size_t page_count,
                                    uint32_t *random_state)
{
    const size_t recent_count = page_count < RECENT_PAGE_WINDOW ? page_count : RECENT_PAGE_WINDOW;
    size_t page_index;
    if (next_random(random_state) % 100U < LOCALITY_PERCENT || recent_count == page_count) {
        size_t distance = next_random(random_state) % recent_count;
        page_index = (slot + page_count - distance) % page_count;
    } else {
        size_t older_count = page_count - recent_count;
        size_t offset = next_random(random_state) % older_count;
        page_index = (slot + page_count - recent_count - offset - 1U) % page_count;
    }
    return (uint64_t)(sensor_id * page_count + page_index);
}

static int find_frame(const uint64_t *frames, size_t frame_count, uint64_t page)
{
    for (size_t i = 0; i < frame_count; i++) {
        if (frames[i] == page) return (int)i;
    }
    return -1;
}

static void emit_page_fault(long long timestamp, int sensor_id, uint64_t page,
                            PageAlgorithm algorithm, const uint64_t *frame_snapshot,
                            size_t frame_count, uint64_t victim)
{
    flockfile(stdout);
    printf("{\"t\":%lld,\"ev\":\"page_fault\",\"sensor\":%d,\"page\":%" PRIu64 ",\"algo\":\"%s\",\"frames\":[",
           timestamp, sensor_id, page, page_algorithm_name(algorithm));
    for (size_t i = 0; i < frame_count; i++) {
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

int memory_init(MemoryManager *memory, size_t sensor_count, size_t buffer_size,
                size_t page_size, size_t frame_count, PageAlgorithm algorithm,
                uint32_t seed, volatile sig_atomic_t *shutdown_requested,
                const struct timespec *start_time)
{
    *memory = (MemoryManager){0};
    memory->sensor_rings = calloc(sensor_count, sizeof(*memory->sensor_rings));
    memory->frames = malloc(frame_count * sizeof(*memory->frames));
    memory->last_used = calloc(frame_count, sizeof(*memory->last_used));
    memory->page_seeds = calloc(sensor_count, sizeof(*memory->page_seeds));
    if (memory->sensor_rings == NULL || memory->frames == NULL ||
        memory->last_used == NULL || memory->page_seeds == NULL) {
        free(memory->sensor_rings);
        free(memory->frames);
        free(memory->last_used);
        free(memory->page_seeds);
        return -1;
    }

    size_t initialized_rings = 0;
    for (; initialized_rings < sensor_count; initialized_rings++) {
        memory->sensor_rings[initialized_rings].values =
            calloc(buffer_size, sizeof(*memory->sensor_rings[initialized_rings].values));
        if (memory->sensor_rings[initialized_rings].values == NULL) break;
        memory->sensor_rings[initialized_rings].capacity = buffer_size;
        memory->page_seeds[initialized_rings] = seed ^
            (uint32_t)((initialized_rings + 1U) * 0x9e3779b9U);
        if (memory->page_seeds[initialized_rings] == 0)
            memory->page_seeds[initialized_rings] = 0x6d2b79f5U;
    }
    int mutex_initialized = 0;
    if (initialized_rings == sensor_count && pthread_mutex_init(&memory->mutex, NULL) == 0)
        mutex_initialized = 1;
    if (!mutex_initialized || pthread_cond_init(&memory->turn_changed, NULL) != 0) {
        if (mutex_initialized) pthread_mutex_destroy(&memory->mutex);
        for (size_t i = 0; i < initialized_rings; i++) free(memory->sensor_rings[i].values);
        free(memory->sensor_rings);
        free(memory->frames);
        free(memory->last_used);
        free(memory->page_seeds);
        return -1;
    }

    memory->sensor_count = sensor_count;
    memory->buffer_size = buffer_size;
    memory->page_size = page_size;
    memory->frame_count = frame_count;
    memory->algorithm = algorithm;
    memory->start_time = start_time;
    memory->shutdown_requested = shutdown_requested;
    for (size_t i = 0; i < frame_count; i++) memory->frames[i] = EMPTY_PAGE;
    return 0;
}

void memory_destroy(MemoryManager *memory)
{
    for (size_t i = 0; i < memory->sensor_count; i++) free(memory->sensor_rings[i].values);
    free(memory->sensor_rings);
    free(memory->frames);
    free(memory->last_used);
    free(memory->page_seeds);
    pthread_cond_destroy(&memory->turn_changed);
    pthread_mutex_destroy(&memory->mutex);
    *memory = (MemoryManager){0};
}

/* OS concept: the bounded per-sensor circular buffer overwrites its oldest reading. */
/* Lock order: queue_mutex -> memory_mutex -> stdout FILE lock. Callers release queue_mutex
 * before entering this module, so page events can be emitted in memory-access order. */
void memory_record_reading(MemoryManager *memory, int sensor_id, double value)
{
    if (sensor_id < 0 || (size_t)sensor_id >= memory->sensor_count) return;

    uint64_t frame_snapshot[MEMORY_MAX_FRAMES];
    uint64_t page;
    uint64_t victim = EMPTY_PAGE;
    long long timestamp;
    int is_fault = 0;

    pthread_mutex_lock(&memory->mutex);
    /* OS concept: a condition variable serializes page accesses for reproducible seeded runs. */
    while (memory->next_sensor != (size_t)sensor_id && !*memory->shutdown_requested) {
        struct timespec deadline;
        clock_gettime(CLOCK_REALTIME, &deadline);
        deadline.tv_nsec += 100000000L;
        if (deadline.tv_nsec >= 1000000000L) {
            deadline.tv_sec++;
            deadline.tv_nsec -= 1000000000L;
        }
        (void)pthread_cond_timedwait(&memory->turn_changed, &memory->mutex, &deadline);
    }
    if (*memory->shutdown_requested) {
        pthread_mutex_unlock(&memory->mutex);
        return;
    }
    ReadingRing *ring = &memory->sensor_rings[sensor_id];
    size_t slot = ring->next_index;
    ring->values[slot] = value;
    ring->next_index = (slot + 1) % ring->capacity;
    if (ring->count < ring->capacity) ring->count++;

    size_t page_count = pages_per_sensor(memory->buffer_size, memory->page_size);
    page = choose_reading_page((size_t)sensor_id, slot / memory->page_size,
                               page_count, &memory->page_seeds[sensor_id]);
    memory->accesses++;
    int found = find_frame(memory->frames, memory->frame_count, page);
    size_t target = found < 0 ? memory->frame_count : (size_t)found;

    if (found < 0) {
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
                for (size_t i = 1; i < memory->frame_count; i++)
                    if (memory->last_used[i] < memory->last_used[target]) target = i;
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
    printf("{\"t\":%lld,\"ev\":\"page_access\",\"sensor\":%d,\"page\":%" PRIu64 ",\"status\":\"%s\"}\n",
           timestamp, sensor_id, page, is_fault ? "fault" : "hit");
    fflush(stdout);
    if (is_fault)
        emit_page_fault(timestamp, sensor_id, page, memory->algorithm,
                        frame_snapshot, memory->frame_count, victim);
    memory->next_sensor = (memory->next_sensor + 1) % memory->sensor_count;
    pthread_cond_broadcast(&memory->turn_changed);
    pthread_mutex_unlock(&memory->mutex);
}

static uint64_t count_trace_faults(const uint64_t *trace, size_t access_count,
                                   size_t frame_count, PageAlgorithm algorithm)
{
    uint64_t *frames = malloc(frame_count * sizeof(*frames));
    uint64_t *last_used = calloc(frame_count, sizeof(*last_used));
    if (frames == NULL || last_used == NULL) {
        free(frames);
        free(last_used);
        return UINT64_MAX;
    }
    for (size_t i = 0; i < frame_count; i++) frames[i] = EMPTY_PAGE;

    uint64_t faults = 0;
    uint64_t clock = 0;
    size_t fifo_next = 0;
    for (size_t access = 0; access < access_count; access++) {
        int found = find_frame(frames, frame_count, trace[access]);
        size_t target = found < 0 ? frame_count : (size_t)found;
        if (found < 0) {
            faults++;
            for (size_t i = 0; i < frame_count; i++) {
                if (frames[i] == EMPTY_PAGE) {
                    target = i;
                    break;
                }
            }
            if (target == frame_count) {
                if (algorithm == PAGE_FIFO) {
                    target = fifo_next;
                    fifo_next = (fifo_next + 1) % frame_count;
                } else {
                    target = 0;
                    for (size_t i = 1; i < frame_count; i++)
                        if (last_used[i] < last_used[target]) target = i;
                }
            } else if (algorithm == PAGE_FIFO) {
                fifo_next = (target + 1) % frame_count;
            }
            frames[target] = trace[access];
        }
        last_used[target] = ++clock;
    }

    free(frames);
    free(last_used);
    return faults;
}

/* OS concept: deterministic offline trace uses the same locality generator for both policies. */
void memory_run_page_comparison(size_t sensor_count, size_t buffer_size,
                                size_t page_size, size_t frame_count, uint32_t seed)
{
    size_t page_count = pages_per_sensor(buffer_size, page_size);
    uint64_t trace[MEMORY_TRACE_LENGTH];
    size_t slots[MEMORY_MAX_FRAMES] = {0};
    uint32_t page_seeds[MEMORY_MAX_FRAMES];
    if (sensor_count > MEMORY_MAX_FRAMES) return;

    for (size_t sensor = 0; sensor < sensor_count; sensor++) {
        page_seeds[sensor] = seed ^ (uint32_t)((sensor + 1U) * 0x9e3779b9U);
        if (page_seeds[sensor] == 0) page_seeds[sensor] = 0x6d2b79f5U;
    }
    for (size_t access = 0; access < MEMORY_TRACE_LENGTH; access++) {
        size_t sensor = access % sensor_count;
        size_t slot = slots[sensor]++ % buffer_size;
        trace[access] = choose_reading_page(sensor, slot / page_size, page_count,
                                            &page_seeds[sensor]);
    }

    uint64_t fifo_faults = count_trace_faults(trace, MEMORY_TRACE_LENGTH, frame_count, PAGE_FIFO);
    uint64_t lru_faults = count_trace_faults(trace, MEMORY_TRACE_LENGTH, frame_count, PAGE_LRU);
    double fifo_hit_ratio = (double)(MEMORY_TRACE_LENGTH - fifo_faults) / MEMORY_TRACE_LENGTH;
    double lru_hit_ratio = (double)(MEMORY_TRACE_LENGTH - lru_faults) / MEMORY_TRACE_LENGTH;
    printf("{\"t\":0,\"ev\":\"page_compare\",\"accesses\":%u,\"seed\":%u,\"frames\":%zu,\"fifo\":{\"faults\":%" PRIu64 ",\"hit_ratio\":%.3f},\"lru\":{\"faults\":%" PRIu64 ",\"hit_ratio\":%.3f}}\n",
           MEMORY_TRACE_LENGTH, seed, frame_count, fifo_faults, fifo_hit_ratio,
           lru_faults, lru_hit_ratio);
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
