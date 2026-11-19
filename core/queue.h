#ifndef QUEUE_H
#define QUEUE_H

#include <pthread.h>
#include <semaphore.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint64_t id;
    int sensor_id;
    const char *type;
    int severity;
    double value;
    long long arrival_ms;
    int burst_ms;
    int remaining_ms;
    int age_level;
    long long waiting_ms;
    long long wait_started_ms;
} Alert;

typedef struct {
    Alert *items;
    size_t size;
    size_t capacity;
    pthread_mutex_t mutex;
    sem_t *empty_slots;
    sem_t *full_slots;
} PriorityQueue;

int queue_init(PriorityQueue *queue, size_t capacity, sem_t *empty_slots, sem_t *full_slots);
void queue_destroy(PriorityQueue *queue);
/* Returns 1 inserted, 2 inserted after replacement, 0 dropped, or -1 on error. */
int queue_push(PriorityQueue *queue, Alert alert, Alert *dropped);
int queue_pop(PriorityQueue *queue, Alert *alert);
size_t queue_size(PriorityQueue *queue);

#endif
