#ifndef EVENT_LOG_H
#define EVENT_LOG_H

void event_log_set_fd(int fd);
int event_log_emit(const char *format, ...);

#endif
