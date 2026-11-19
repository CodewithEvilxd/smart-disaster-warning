#define _POSIX_C_SOURCE 200809L
#include "watchdog.h"
#include "event_log.h"

#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

static long long elapsed_ms(const struct timespec *start)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long long)(now.tv_sec - start->tv_sec) * 1000LL +
           (long long)(now.tv_nsec - start->tv_nsec) / 1000000LL;
}

static unsigned int next_random(WatchdogContext *context)
{
    unsigned int *state = &context->random_state;
    if (*state == 0) *state = 0x6d2b79f5U;
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    return *state;
}

static void sleep_watchdog_interval(void)
{
    struct timespec delay = {0, 500000000L};
    while (nanosleep(&delay, &delay) == -1 && errno == EINTR) { }
}

static void inject_fault(WatchdogContext *context, size_t sensor_id, const char *mode)
{
    SensorContext *sensor = &context->sensors[sensor_id];
    if (!atomic_load(&sensor->is_up) || atomic_load(&sensor->fault_requested)) return;
    atomic_store(&sensor->fault_requested, true);
    event_log_emit("{\"t\":%lld,\"ev\":\"fault_injected\",\"sensor\":%zu,\"mode\":\"%s\"}",
                   elapsed_ms(context->start_time), sensor_id, mode);
}

static void wake_sensor(SensorContext *sensor)
{
    pthread_mutex_lock(&sensor->fault_mutex);
    pthread_cond_broadcast(&sensor->fault_condition);
    pthread_mutex_unlock(&sensor->fault_mutex);
}

static int restart_sensor(WatchdogContext *context, size_t sensor_id)
{
    SensorContext *sensor = &context->sensors[sensor_id];
    atomic_store(&sensor->stop_requested, false);
    atomic_store(&sensor->fault_requested, false);
    atomic_store(&sensor->last_heartbeat_ms, (uint64_t)elapsed_ms(context->start_time));
    atomic_store(&sensor->is_up, true);
    if (pthread_create(&sensor->thread, NULL, sensor_thread, sensor) != 0) {
        atomic_store(&sensor->is_up, false);
        fprintf(stderr, "Failed to restart sensor %zu\n", sensor_id);
        return -1;
    }
    sensor->thread_started = 1;
    int restarts = atomic_fetch_add(&sensor->restart_count, 1) + 1;
    event_log_emit("{\"t\":%lld,\"ev\":\"sensor_restarted\",\"sensor\":%zu,\"restarts\":%d}",
                   elapsed_ms(context->start_time), sensor_id, restarts);
    return 0;
}

static void emit_sensor_status(WatchdogContext *context, size_t sensor_id)
{
    SensorContext *sensor = &context->sensors[sensor_id];
    uint64_t bits = atomic_load(&sensor->last_reading_bits);
    double reading = 0.0;
    memcpy(&reading, &bits, sizeof(reading));
    event_log_emit("{\"t\":%lld,\"ev\":\"sensor_status\",\"sensor\":%zu,\"type\":\"%s\",\"status\":\"%s\",\"last_reading\":%.2f,\"restarts\":%d}",
                   elapsed_ms(context->start_time), sensor_id, sensor_type_name((int)sensor_id),
                   atomic_load(&sensor->is_up) ? "up" : "down", reading,
                   atomic_load(&sensor->restart_count));
}

void *watchdog_thread(void *argument)
{
    WatchdogContext *context = argument;
    long long next_status = 2000;
    long long next_random_fault = 10000 + (long long)(next_random(context) % 10001U);
    int explicit_injected = 0;

    while (!*context->shutdown_requested) {
        long long now = elapsed_ms(context->start_time);
        if (context->inject_fault_enabled && !explicit_injected && now >= context->inject_at_ms) {
            inject_fault(context, (size_t)context->injected_sensor, "scheduled");
            explicit_injected = 1;
        }
        if (context->inject_random_enabled && now >= next_random_fault) {
            size_t start = context->sensor_count == 0 ? 0 : next_random(context) % context->sensor_count;
            for (size_t offset = 0; offset < context->sensor_count; offset++) {
                size_t sensor_id = (start + offset) % context->sensor_count;
                if (atomic_load(&context->sensors[sensor_id].is_up)) {
                    inject_fault(context, sensor_id, "random");
                    next_random_fault = now + 10000 + (long long)(next_random(context) % 10001U);
                    break;
                }
            }
        }

        for (size_t i = 0; i < context->sensor_count; i++) {
            SensorContext *sensor = &context->sensors[i];
            uint64_t heartbeat = atomic_load(&sensor->last_heartbeat_ms);
            if (atomic_load(&sensor->is_up) && now >= (long long)heartbeat &&
                now - (long long)heartbeat > (long long)context->heartbeat_timeout_ms) {
                atomic_store(&sensor->is_up, false);
                event_log_emit("{\"t\":%lld,\"ev\":\"sensor_down\",\"sensor\":%zu,\"last_heartbeat\":%" PRIu64 "}",
                               now, i, heartbeat);
                atomic_store(&sensor->stop_requested, true);
                wake_sensor(sensor);
                if (sensor->thread_started) {
                    pthread_join(sensor->thread, NULL);
                    sensor->thread_started = 0;
                }
                if (*context->shutdown_requested) break;
            }
            if (!atomic_load(&sensor->is_up) && !*context->shutdown_requested)
                restart_sensor(context, i);
        }

        if (now >= next_status) {
            for (size_t i = 0; i < context->sensor_count; i++) emit_sensor_status(context, i);
            next_status = now + 2000;
        }
        sleep_watchdog_interval();
    }

    for (size_t i = 0; i < context->sensor_count; i++) {
        atomic_store(&context->sensors[i].stop_requested, true);
        wake_sensor(&context->sensors[i]);
    }
    return NULL;
}
