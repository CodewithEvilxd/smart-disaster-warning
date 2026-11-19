#define _POSIX_C_SOURCE 200809L
#include "scheduler.h"

#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

#define AGING_INTERVAL_MS 1000LL
#define MAX_EFFECTIVE_SEVERITY 10

static long long elapsed_ms(const struct timespec *start)
{
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return (long long)(now.tv_sec - start->tv_sec) * 1000LL +
           (long long)(now.tv_nsec - start->tv_nsec) / 1000000LL;
}

const char *scheduler_algorithm_name(SchedulerAlgorithm algorithm)
{
    switch (algorithm) {
    case SCHED_ROUND_ROBIN: return "rr";
    case SCHED_SJF: return "sjf";
    default: return "priority";
    }
}

static int wait_for_work(sem_t *semaphore)
{
    while (sem_wait(semaphore) == -1) {
        if (errno != EINTR) return -1;
    }
    return 0;
}

/* OS concept: queued jobs age while ready, so low-priority work can gain priority. */
static void update_aging(Alert *ready, size_t count, long long now,
                         const struct timespec *start_time)
{
    for (size_t i = 0; i < count; i++) {
        Alert *alert = &ready[i];
        if (alert->wait_started_ms < 0) continue;
        long long waited = alert->waiting_ms + now - alert->wait_started_ms;
        int new_level = (int)(waited / AGING_INTERVAL_MS);
        if (new_level > MAX_EFFECTIVE_SEVERITY - alert->severity)
            new_level = MAX_EFFECTIVE_SEVERITY - alert->severity;
        while (alert->age_level < new_level) {
            alert->age_level++;
            printf("{\"t\":%lld,\"ev\":\"aged\",\"id\":%" PRIu64 ",\"sensor\":%d,\"severity\":%d,\"age_boost\":%d}\n",
                   elapsed_ms(start_time), alert->id, alert->sensor_id,
                   alert->severity + alert->age_level, alert->age_level);
            fflush(stdout);
        }
    }
}

static int effective_severity(const Alert *alert)
{
    int value = alert->severity + alert->age_level;
    return value > MAX_EFFECTIVE_SEVERITY ? MAX_EFFECTIVE_SEVERITY : value;
}

static int comes_before(const Alert *left, const Alert *right, SchedulerAlgorithm algorithm)
{
    if (algorithm == SCHED_SJF) {
        if (left->remaining_ms != right->remaining_ms)
            return left->remaining_ms < right->remaining_ms;
    } else if (algorithm == SCHED_PRIORITY) {
        int left_priority = effective_severity(left);
        int right_priority = effective_severity(right);
        if (left_priority != right_priority) return left_priority > right_priority;
    }
    return left->arrival_ms < right->arrival_ms;
}

static size_t select_next(Alert *ready, size_t count, SchedulerAlgorithm algorithm)
{
    size_t selected = 0;
    if (algorithm == SCHED_ROUND_ROBIN) {
        /* OS concept: Round Robin places returned jobs at the tail of a FIFO ready queue. */
        for (size_t i = 1; i < count; i++) {
            if (ready[i].wait_started_ms < ready[selected].wait_started_ms ||
                (ready[i].wait_started_ms == ready[selected].wait_started_ms &&
                 ready[i].arrival_ms < ready[selected].arrival_ms)) selected = i;
        }
        return selected;
    }
    for (size_t i = 1; i < count; i++) {
        if (comes_before(&ready[i], &ready[selected], algorithm)) selected = i;
    }
    return selected;
}

static void emit_schedule_event(const char *event, const Alert *alert,
                                SchedulerAlgorithm algorithm,
                                const struct timespec *start_time)
{
    printf("{\"t\":%lld,\"ev\":\"%s\",\"id\":%" PRIu64 ",\"algo\":\"%s\"}\n",
           elapsed_ms(start_time), event, alert->id, scheduler_algorithm_name(algorithm));
    fflush(stdout);
}

static void sleep_ms(int milliseconds)
{
    struct timespec remaining = {
        milliseconds / 1000,
        (long)(milliseconds % 1000) * 1000000L
    };
    while (nanosleep(&remaining, &remaining) == -1 && errno == EINTR) { }
}

static void drain_queue(SchedulerContext *context, Alert *ready, size_t *ready_count)
{
    while (sem_trywait(context->full_slots) == 0) {
        Alert alert;
        if (queue_pop(context->queue, &alert) != 1) continue;
        long long now = elapsed_ms(context->start_time);
        alert.waiting_ms = 0;
        alert.wait_started_ms = now;
        alert.age_level = 0;
        if (*ready_count < context->queue_capacity) ready[(*ready_count)++] = alert;
        else {
            /* The semaphore bounds all outstanding jobs, so this is defensive only. */
            sem_post(context->empty_slots);
        }
    }
}

static void complete_alert(SchedulerContext *context, const Alert *alert)
{
    printf("{\"t\":%lld,\"ev\":\"alert_dispatched\",\"id\":%" PRIu64 ",\"sensor\":%d,\"type\":\"%s\",\"severity\":%d}\n",
           elapsed_ms(context->start_time), alert->id, alert->sensor_id,
           alert->type, alert->severity);
    fflush(stdout);
    sem_post(context->empty_slots);
}

void *scheduler_thread(void *argument)
{
    SchedulerContext *context = argument;
    Alert *ready = calloc(context->queue_capacity, sizeof(*ready));
    if (ready == NULL) {
        fprintf(stderr, "Scheduler could not allocate its ready queue\n");
        return NULL;
    }

    size_t ready_count = 0;
    for (;;) {
        if (*context->shutdown_requested) break;
        if (ready_count == 0) {
            if (wait_for_work(context->full_slots) == -1) break;
            Alert alert;
            if (queue_pop(context->queue, &alert) == 1) {
                alert.waiting_ms = 0;
                alert.age_level = 0;
                alert.wait_started_ms = elapsed_ms(context->start_time);
                ready[ready_count++] = alert;
            } else if (*context->shutdown_requested) {
                break;
            }
        }
        drain_queue(context, ready, &ready_count);
        if (ready_count == 0) {
            if (*context->shutdown_requested) break;
            continue;
        }

        if (context->algorithm == SCHED_PRIORITY)
            update_aging(ready, ready_count, elapsed_ms(context->start_time), context->start_time);
        size_t selected = select_next(ready, ready_count, context->algorithm);
        Alert current = ready[selected];
        ready[selected] = ready[--ready_count];

        /* Exclude CPU service time from the alert's accumulated waiting time. */
        if (current.wait_started_ms >= 0) {
            current.waiting_ms += elapsed_ms(context->start_time) - current.wait_started_ms;
            current.wait_started_ms = -1;
        }
        int slice_ms = current.remaining_ms;
        if (context->algorithm == SCHED_ROUND_ROBIN && slice_ms > context->quantum_ms)
            slice_ms = context->quantum_ms;

        emit_schedule_event("sched_start", &current, context->algorithm, context->start_time);
        sleep_ms(slice_ms);
        current.remaining_ms -= slice_ms;
        emit_schedule_event("sched_end", &current, context->algorithm, context->start_time);

        if (current.remaining_ms == 0) complete_alert(context, &current);
        if (*context->shutdown_requested) break;

        drain_queue(context, ready, &ready_count);
        if (current.remaining_ms > 0) {
            current.wait_started_ms = elapsed_ms(context->start_time);
            ready[ready_count++] = current;
        }
    }

    free(ready);
    return NULL;
}
