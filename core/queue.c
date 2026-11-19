#include "queue.h"

#include <stdlib.h>

/* OS concept: a mutex protects the shared max-heap from concurrent access. */
static void swap_alerts(Alert *left, Alert *right)
{
    Alert temporary = *left;
    *left = *right;
    *right = temporary;
}

int queue_init(PriorityQueue *queue, size_t capacity)
{
    queue->items = calloc(capacity, sizeof(*queue->items));
    if (queue->items == NULL) return -1;
    queue->size = 0;
    queue->capacity = capacity;
    if (pthread_mutex_init(&queue->mutex, NULL) != 0) {
        free(queue->items);
        queue->items = NULL;
        return -1;
    }
    return 0;
}

void queue_destroy(PriorityQueue *queue)
{
    pthread_mutex_destroy(&queue->mutex);
    free(queue->items);
    queue->items = NULL;
    queue->size = 0;
    queue->capacity = 0;
}

int queue_push(PriorityQueue *queue, Alert alert)
{
    if (pthread_mutex_lock(&queue->mutex) != 0) return -1;
    if (queue->size >= queue->capacity) {
        pthread_mutex_unlock(&queue->mutex);
        return -1;
    }

    size_t index = queue->size++;
    queue->items[index] = alert;
    while (index > 0) {
        size_t parent = (index - 1) / 2;
        if (queue->items[parent].severity >= queue->items[index].severity) break;
        swap_alerts(&queue->items[parent], &queue->items[index]);
        index = parent;
    }
    pthread_mutex_unlock(&queue->mutex);
    return 0;
}

int queue_pop(PriorityQueue *queue, Alert *alert)
{
    if (pthread_mutex_lock(&queue->mutex) != 0) return -1;
    if (queue->size == 0) {
        pthread_mutex_unlock(&queue->mutex);
        return 0;
    }

    *alert = queue->items[0];
    queue->size--;
    if (queue->size > 0) {
        queue->items[0] = queue->items[queue->size];
        size_t index = 0;
        for (;;) {
            size_t left = index * 2 + 1;
            size_t right = left + 1;
            size_t largest = index;
            if (left < queue->size && queue->items[left].severity > queue->items[largest].severity)
                largest = left;
            if (right < queue->size && queue->items[right].severity > queue->items[largest].severity)
                largest = right;
            if (largest == index) break;
            swap_alerts(&queue->items[index], &queue->items[largest]);
            index = largest;
        }
    }
    pthread_mutex_unlock(&queue->mutex);
    return 1;
}

size_t queue_size(PriorityQueue *queue)
{
    size_t size;
    pthread_mutex_lock(&queue->mutex);
    size = queue->size;
    pthread_mutex_unlock(&queue->mutex);
    return size;
}
