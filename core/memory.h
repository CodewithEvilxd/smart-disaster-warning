#ifndef MEMORY_H
#define MEMORY_H

#include <pthread.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <time.h>

#define MEMORY_MAX_FRAMES 4096

typedef enum {
    PAGE_FIFO,
    PAGE_LRU
} PageAlgorithm;

typedef struct {
    double *values;
    size_t capacity;
    size_t next_index;
    size_t count;
} ReadingRing;

typedef struct {
    ReadingRing *sensor_rings;
    size_t sensor_count;
    size_t buffer_size;
    size_t frame_count;
    uint64_t *frames;
    uint64_t *last_used;
    size_t fifo_next;
    uint64_t lru_clock;
    uint64_t accesses;
    uint64_t faults;
    PageAlgorithm algorithm;
    pthread_mutex_t mutex;
    const struct timespec *start_time;
} MemoryManager;

typedef struct {
    MemoryManager *memory;
    volatile sig_atomic_t *shutdown_requested;
} MemoryStatsContext;

int memory_init(MemoryManager *memory, size_t sensor_count, size_t buffer_size,
                size_t frame_count, PageAlgorithm algorithm,
                const struct timespec *start_time);
void memory_destroy(MemoryManager *memory);
void memory_record_reading(MemoryManager *memory, int sensor_id, double value);
void *memory_stats_thread(void *argument);

#endif
