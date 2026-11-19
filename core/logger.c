#define _POSIX_C_SOURCE 200809L
#include "logger.h"

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int logger_prepare(LoggerContext *context)
{
    if (mkdir("logs", 0777) == -1 && errno != EEXIST) return -1;
    struct stat info;
    if (stat("logs", &info) == -1 || !S_ISDIR(info.st_mode)) return -1;
    context->log_file = fopen("logs/events.jsonl", "a");
    context->failed = 0;
    return context->log_file == NULL ? -1 : 0;
}

static int write_stdout(const char *line, size_t length)
{
    size_t written = 0;
    while (written < length) {
        ssize_t amount = write(STDOUT_FILENO, line + written, length - written);
        if (amount < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        if (amount == 0) return -1;
        written += (size_t)amount;
    }
    return 0;
}

static int write_record(LoggerContext *context, const char *line, size_t length)
{
    if (write_stdout(line, length) == -1) return -1;
    size_t written = 0;
    while (written < length) {
        size_t amount = fwrite(line + written, 1, length - written, context->log_file);
        if (amount == 0) return -1;
        written += amount;
    }
    return fflush(context->log_file) == 0 ? 0 : -1;
}

/* OS concept: one consumer drains the pipe and serializes all event destinations. */
void *logger_thread(void *argument)
{
    LoggerContext *context = argument;
    char chunk[1024];
    char line[PIPE_BUF];
    size_t used = 0;
    for (;;) {
        ssize_t amount = read(context->read_fd, chunk, sizeof(chunk));
        if (amount == 0) break;
        if (amount < 0) {
            if (errno == EINTR) continue;
            perror("event pipe read");
            context->failed = 1;
            break;
        }
        for (ssize_t i = 0; i < amount; i++) {
            if (used >= sizeof(line)) {
                fprintf(stderr, "Event line exceeded PIPE_BUF\n");
                context->failed = 1;
                used = 0;
            }
            line[used++] = chunk[i];
            if (chunk[i] == '\n') {
                if (write_record(context, line, used) == -1) {
                    fprintf(stderr, "Failed to persist event record\n");
                    context->failed = 1;
                }
                used = 0;
            }
        }
    }
    if (used > 0) {
        line[used++] = '\n';
        if (write_record(context, line, used) == -1) context->failed = 1;
    }
    fclose(context->log_file);
    context->log_file = NULL;
    close(context->read_fd);
    return NULL;
}
