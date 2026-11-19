#ifndef LOGGER_H
#define LOGGER_H

#include <pthread.h>
#include <stdio.h>

typedef struct {
    int read_fd;
    FILE *log_file;
    int failed;
} LoggerContext;

int logger_prepare(LoggerContext *context);
void *logger_thread(void *argument);

#endif
