#ifndef QUEUE_H
#define QUEUE_H

#include <pthread.h>
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
} PriorityQueue;

int queue_init(PriorityQueue *queue, size_t capacity);
void queue_destroy(PriorityQueue *queue);
int queue_push(PriorityQueue *queue, Alert alert);
int queue_pop(PriorityQueue *queue, Alert *alert);
size_t queue_size(PriorityQueue *queue);

#endif
