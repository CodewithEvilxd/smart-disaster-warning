#define _POSIX_C_SOURCE 200809L
#include "sensor.h"

#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <time.h>

static const char *sensor_types[] = {"earthquake", "flood", "cyclone", "fire"};
static const double thresholds[] = {65.0, 70.0, 75.0, 68.0};

static long long elapsed_ms(const struct timespec *start)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long long)(now.tv_sec - start->tv_sec) * 1000LL +
           (long long)(now.tv_nsec - start->tv_nsec) / 1000000LL;
}

/* OS concept: each sensor has independent pseudo-random state with no shared lock. */
static unsigned int next_random(unsigned int *state)
{
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    return *state;
}

static int wait_semaphore(sem_t *semaphore)
{
    while (sem_wait(semaphore) == -1) {
        if (errno != EINTR) return -1;
    }
    return 0;
}

static void sleep_ms(long milliseconds)
{
    struct timespec remaining = {milliseconds / 1000, (milliseconds % 1000) * 1000000L};
    while (nanosleep(&remaining, &remaining) == -1 && errno == EINTR) { }
}

void *sensor_thread(void *argument)
{
    SensorContext *context = argument;
    const int type_index = context->sensor_id % 4;
    while (!*context->shutdown_requested) {
        const double value = (double)(next_random(&context->seed) % 10001U) / 100.0;
        printf("{\"t\":%lld,\"ev\":\"reading\",\"sensor\":%d,\"type\":\"%s\",\"value\":%.2f}\n",
               elapsed_ms(context->start_time), context->sensor_id, sensor_types[type_index], value);
        fflush(stdout);
        memory_record_reading(context->memory, context->sensor_id, value);

        if (value >= thresholds[type_index] && !*context->shutdown_requested) {
            if (wait_semaphore(context->empty_slots) == -1) break;
            if (*context->shutdown_requested) {
                sem_post(context->empty_slots);
                break;
            }
            Alert alert = {
                /* OS concept: an atomic counter assigns unique IDs across producer threads. */
                .id = (uint64_t)atomic_fetch_add_explicit(context->next_alert_id, 1, memory_order_relaxed),
                .sensor_id = context->sensor_id,
                .type = sensor_types[type_index],
                .severity = 1 + (int)((value - thresholds[type_index]) / 7.0),
                .value = value,
                .arrival_ms = elapsed_ms(context->start_time),
                .burst_ms = 200 + (int)(next_random(&context->seed) % 601U)
            };
            if (alert.severity > 5) alert.severity = 5;
            alert.remaining_ms = alert.burst_ms;

            /* Queue lock is released before event output; see main.c for global lock order. */
            if (queue_push(context->queue, alert) == -1) {
                sem_post(context->empty_slots);
                break;
            }
            printf("{\"t\":%lld,\"ev\":\"alert_enqueued\",\"id\":%" PRIu64 ",\"sensor\":%d,\"severity\":%d,\"burst_ms\":%d,\"queue_len\":%zu}\n",
                   elapsed_ms(context->start_time), alert.id, alert.sensor_id, alert.severity, alert.burst_ms,
                   queue_size(context->queue));
            fflush(stdout);
            sem_post(context->full_slots);
        }
        sleep_ms(500 + (long)(next_random(&context->seed) % 501U));
    }
    return NULL;
}
