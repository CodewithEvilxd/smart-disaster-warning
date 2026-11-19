#define _POSIX_C_SOURCE 200809L
#include "sensor.h"
#include "event_log.h"

#include <errno.h>
#include <inttypes.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

static const char *sensor_types[] = {"earthquake", "flood", "cyclone", "fire"};
static const double thresholds[] = {65.0, 70.0, 75.0, 68.0};

const char *sensor_type_name(int sensor_id)
{
    return sensor_types[sensor_id % 4];
}

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

static void sleep_ms(long milliseconds)
{
    struct timespec remaining = {milliseconds / 1000, (milliseconds % 1000) * 1000000L};
    while (nanosleep(&remaining, &remaining) == -1 && errno == EINTR) { }
}

void *sensor_thread(void *argument)
{
    SensorContext *context = argument;
    const int type_index = context->sensor_id % 4;
    context->seed = context->seed == 0 ? 0x6d2b79f5U : context->seed;
    while (!*context->shutdown_requested && !atomic_load(&context->stop_requested)) {
        if (atomic_load(&context->fault_requested)) {
            pthread_mutex_lock(&context->fault_mutex);
            while (!atomic_load(&context->stop_requested) && !*context->shutdown_requested)
                pthread_cond_wait(&context->fault_condition, &context->fault_mutex);
            pthread_mutex_unlock(&context->fault_mutex);
            break;
        }
        atomic_store(&context->last_heartbeat_ms, (uint64_t)elapsed_ms(context->start_time));
        const double value = (double)(next_random(&context->seed) % 10001U) / 100.0;
        uint64_t reading_bits;
        memcpy(&reading_bits, &value, sizeof(reading_bits));
        atomic_store(&context->last_reading_bits, reading_bits);
        event_log_emit("{\"t\":%lld,\"ev\":\"reading\",\"sensor\":%d,\"type\":\"%s\",\"value\":%.2f}",
                       elapsed_ms(context->start_time), context->sensor_id, sensor_types[type_index], value);
        memory_record_reading(context->memory, context->sensor_id, value,
                              &context->last_heartbeat_ms, &context->fault_requested);
        if (atomic_load(&context->fault_requested)) continue;

        if (value >= thresholds[type_index] && !*context->shutdown_requested) {
            if (*context->shutdown_requested) break;
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
            Alert dropped;
            int push_result = queue_push(context->queue, alert, &dropped);
            if (push_result == -1) break;
            if (push_result == 2)
                event_log_emit("{\"t\":%lld,\"ev\":\"alert_dropped\",\"id\":%" PRIu64 ",\"severity\":%d,\"reason\":\"replaced_by_higher_severity\",\"by_id\":%" PRIu64 ",\"by_severity\":%d}",
                               elapsed_ms(context->start_time), dropped.id, dropped.severity,
                               alert.id, alert.severity);
            else if (push_result == 0)
                event_log_emit("{\"t\":%lld,\"ev\":\"alert_dropped\",\"id\":%" PRIu64 ",\"severity\":%d,\"reason\":\"%s\"}",
                               elapsed_ms(context->start_time), dropped.id, dropped.severity, "queue_capacity");
            if (push_result != 0)
                event_log_emit("{\"t\":%lld,\"ev\":\"alert_enqueued\",\"id\":%" PRIu64 ",\"sensor\":%d,\"severity\":%d,\"burst_ms\":%d,\"queue_len\":%zu}",
                               elapsed_ms(context->start_time), alert.id, alert.sensor_id, alert.severity,
                               alert.burst_ms, queue_size(context->queue));
        }
        sleep_ms(500 + (long)(next_random(&context->seed) % 501U));
    }
    atomic_store(&context->is_up, false);
    return NULL;
}
