#ifndef SENSOR_H
#define SENSOR_H

#include "queue.h"
#include "memory.h"

#include <semaphore.h>
#include <signal.h>
#include <stdatomic.h>
#include <time.h>

typedef struct {
    int sensor_id;
    unsigned int seed;
    PriorityQueue *queue;
    sem_t *empty_slots;
    sem_t *full_slots;
    volatile sig_atomic_t *shutdown_requested;
    const struct timespec *start_time;
    MemoryManager *memory;
    atomic_uint_fast64_t *next_alert_id;
} SensorContext;

void *sensor_thread(void *argument);

#endif
