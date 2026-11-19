CC = gcc
CFLAGS = -std=c11 -Wall -Wextra -pthread -D_POSIX_C_SOURCE=200809L
TARGET = disaster_warning
SOURCES = main.c sensor.c queue.c scheduler.c memory.c

.PHONY: all clean run

all: $(TARGET)

$(TARGET): $(SOURCES) queue.h sensor.h scheduler.h memory.h
	$(CC) $(CFLAGS) -o $@ $(SOURCES)

run: $(TARGET)
	./$(TARGET)

clean:
	rm -f $(TARGET)
