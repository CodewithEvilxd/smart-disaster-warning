#ifndef SENSOR_H
#define SENSOR_H

#include "queue.h"
#include "memory.h"

#include <signal.h>
#include <stdbool.h>
#include <stdatomic.h>
#include <pthread.h>
#include <time.h>

typedef struct {
    int sensor_id;
    unsigned int seed;
    PriorityQueue *queue;
    volatile sig_atomic_t *shutdown_requested;
    const struct timespec *start_time;
    MemoryManager *memory;
    atomic_uint_fast64_t *next_alert_id;
    atomic_uint_fast64_t last_heartbeat_ms;
    atomic_uint_fast64_t last_reading_bits;
    atomic_int restart_count;
    atomic_bool fault_requested;
    atomic_bool stop_requested;
    atomic_bool is_up;
    pthread_mutex_t fault_mutex;
    pthread_cond_t fault_condition;
    pthread_t thread;
    int thread_started;
} SensorContext;

void *sensor_thread(void *argument);
const char *sensor_type_name(int sensor_id);

#endif
