#ifndef WATCHDOG_H
#define WATCHDOG_H

#include "sensor.h"

#include <stddef.h>

typedef struct {
    SensorContext *sensors;
    size_t sensor_count;
    volatile sig_atomic_t *shutdown_requested;
    const struct timespec *start_time;
    unsigned int heartbeat_timeout_ms;
    int injected_sensor;
    long long inject_at_ms;
    int inject_fault_enabled;
    int inject_random_enabled;
    unsigned int random_state;
} WatchdogContext;

void *watchdog_thread(void *argument);

#endif
