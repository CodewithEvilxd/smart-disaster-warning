#ifndef SCHEDULER_H
#define SCHEDULER_H

#include "queue.h"

#include <semaphore.h>
#include <signal.h>
#include <stddef.h>
#include <time.h>

typedef enum {
    SCHED_PRIORITY,
    SCHED_ROUND_ROBIN,
    SCHED_SJF
} SchedulerAlgorithm;

typedef struct {
    PriorityQueue *queue;
    sem_t *empty_slots;
    sem_t *full_slots;
    volatile sig_atomic_t *shutdown_requested;
    const struct timespec *start_time;
    size_t queue_capacity;
    SchedulerAlgorithm algorithm;
    int quantum_ms;
} SchedulerContext;

void *scheduler_thread(void *argument);
const char *scheduler_algorithm_name(SchedulerAlgorithm algorithm);

#endif
