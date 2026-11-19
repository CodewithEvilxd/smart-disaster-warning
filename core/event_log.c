#define _POSIX_C_SOURCE 200809L
#include "event_log.h"

#include <errno.h>
#include <limits.h>
#include <stdarg.h>
#include <stdio.h>
#include <unistd.h>

static int event_write_fd = -1;

void event_log_set_fd(int fd)
{
    event_write_fd = fd;
}

/* OS concept: one atomic pipe write per bounded JSON record. */
int event_log_emit(const char *format, ...)
{
    char line[PIPE_BUF];
    va_list arguments;
    va_start(arguments, format);
    int length = vsnprintf(line, sizeof(line) - 1, format, arguments);
    va_end(arguments);
    if (length < 0 || length >= (int)sizeof(line) - 1 || event_write_fd < 0) return -1;
    line[length++] = '\n';

    ssize_t written;
    do {
        written = write(event_write_fd, line, (size_t)length);
    } while (written == -1 && errno == EINTR);
    return written == length ? 0 : -1;
}
