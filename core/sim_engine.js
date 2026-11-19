#!/usr/bin/env node
'use strict';

/**
 * Sentinel Core Simulation Engine (Node.js reference engine for Windows & Linux)
 * Replicates core/main.c, sensor.c, queue.c, scheduler.c, memory.c, watchdog.c
 * Emits atomic JSON lines to stdout.
 */

const SENSOR_DEFS = [
  { id: 0, type: 'earthquake', threshold: 65.0, base: 45.0, volatility: 22.0 },
  { id: 1, type: 'flood', threshold: 70.0, base: 40.0, volatility: 25.0 },
  { id: 2, type: 'cyclone', threshold: 75.0, base: 38.0, volatility: 30.0 },
  { id: 3, type: 'fire', threshold: 68.0, base: 35.0, volatility: 26.0 },
];

const NUM_FRAMES = 8;
const NUM_PAGES = 16;
const QUEUE_CAPACITY = 16;

const startTime = Date.now();
function elapsedMs() {
  return Date.now() - startTime;
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// Initial config event
emit({
  t: 0,
  ev: 'config',
  seed: 42,
  sensors: SENSOR_DEFS.length,
  queue_size: QUEUE_CAPACITY,
  algo: 'priority',
  frames: NUM_FRAMES,
  page_algo: 'fifo',
  hb_timeout: 1500,
});

// Memory State
const frames = new Array(NUM_FRAMES).fill(null);
let fifoIndex = 0;
let memAccesses = 0;
let memFaults = 0;

function accessMemory(sensorId) {
  memAccesses += 1;
  // 80/20 locality of reference rule
  const isLocal = Math.random() < 0.8;
  const page = isLocal
    ? Math.floor(Math.random() * 4)
    : 4 + Math.floor(Math.random() * (NUM_PAGES - 4));

  const existingIdx = frames.indexOf(page);
  if (existingIdx !== -1) {
    emit({
      t: elapsedMs(),
      ev: 'page_access',
      sensor: sensorId,
      page,
      status: 'hit',
    });
  } else {
    memFaults += 1;
    // FIFO page replacement
    const victim = frames[fifoIndex];
    frames[fifoIndex] = page;
    fifoIndex = (fifoIndex + 1) % NUM_FRAMES;

    emit({
      t: elapsedMs(),
      ev: 'page_fault',
      sensor: sensorId,
      page,
      victim: victim ?? null,
      frames: [...frames],
    });
  }

  if (memAccesses % 20 === 0) {
    emit({
      t: elapsedMs(),
      ev: 'mem_stats',
      accesses: memAccesses,
      faults: memFaults,
      hit_ratio: Number(((memAccesses - memFaults) / memAccesses).toFixed(3)),
    });
  }
}

// Priority Queue (Max-Heap by severity)
const queue = [];
let nextAlertId = 100;

function pushQueue(alert) {
  if (queue.length >= QUEUE_CAPACITY) return false;
  queue.push(alert);
  // Sort descending by severity (Max-Heap equivalent)
  queue.sort((a, b) => b.severity - a.severity);
  emit({
    t: elapsedMs(),
    ev: 'queue_pushed',
    id: alert.id,
    queue_len: queue.length,
  });
  return true;
}

// CPU Scheduler State
let activeTask = null;
let activeTaskEndTime = 0;
let currentAlgo = 'priority';

function scheduleTick() {
  const now = elapsedMs();

  // Aging check: if queued alerts wait > 1500ms, increase severity
  for (const item of queue) {
    if (now - item.enqueuedAt > 1500 && item.severity < 5) {
      item.severity += 1;
      item.enqueuedAt = now;
      emit({
        t: now,
        ev: 'aged',
        id: item.id,
        new_severity: item.severity,
      });
    }
  }

  // If active task completed
  if (activeTask && now >= activeTaskEndTime) {
    emit({
      t: now,
      ev: 'sched_end',
      id: activeTask.id,
      algo: currentAlgo,
    });
    activeTask = null;
  }

  // If CPU idle, schedule next
  if (!activeTask && queue.length > 0) {
    activeTask = queue.shift();
    const burst = activeTask.burstMs || 250;
    activeTaskEndTime = now + burst;
    emit({
      t: now,
      ev: 'sched_start',
      id: activeTask.id,
      algo: currentAlgo,
      severity: activeTask.severity,
      burst_ms: burst,
    });
  }
}

// Sensor State & Workers
const sensorState = SENSOR_DEFS.map((def) => ({
  ...def,
  currentValue: def.base,
  restarts: 0,
  down: false,
  lastHeartbeat: Date.now(),
}));

function sensorTick(sensor) {
  if (sensor.down) return;

  sensor.lastHeartbeat = Date.now();
  const delta = (Math.random() - 0.48) * 8.0;
  // Occasionally produce a hazard spike (every ~15-20s or random probability)
  const isSpike = Math.random() < 0.05;
  if (isSpike) {
    sensor.currentValue = Math.min(98.5, sensor.threshold + 3.0 + Math.random() * 20.0);
  } else {
    sensor.currentValue = Math.max(12.0, Math.min(95.0, sensor.currentValue + delta));
  }

  const val = Number(sensor.currentValue.toFixed(2));
  const t = elapsedMs();

  emit({
    t,
    ev: 'reading',
    sensor: sensor.id,
    type: sensor.type,
    value: val,
  });

  accessMemory(sensor.id);

  if (val >= sensor.threshold) {
    nextAlertId += 1;
    const sev = Math.min(5, Math.max(1, 1 + Math.floor((val - sensor.threshold) / 6.0)));
    const burst = Math.floor(200 + Math.random() * 500);

    const alert = {
      id: `alert_${nextAlertId}`,
      sensor: sensor.id,
      type: sensor.type,
      severity: sev,
      value: val,
      burstMs: burst,
      enqueuedAt: t,
    };

    emit({
      t,
      ev: 'alert',
      id: alert.id,
      sensor: alert.sensor,
      type: alert.type,
      severity: alert.severity,
      value: alert.value,
      burst_ms: alert.burstMs,
    });

    pushQueue(alert);
  }
}

// Watchdog Supervisor Loop
function watchdogTick() {
  const now = Date.now();
  for (const s of sensorState) {
    if (!s.down && now - s.lastHeartbeat > 2500) {
      s.down = true;
      emit({
        t: elapsedMs(),
        ev: 'sensor_down',
        sensor: s.id,
        type: s.type,
      });

      // Autonomous recovery after 1200ms
      setTimeout(() => {
        s.down = false;
        s.restarts += 1;
        s.lastHeartbeat = Date.now();
        emit({
          t: elapsedMs(),
          ev: 'sensor_restarted',
          sensor: s.id,
          restarts: s.restarts,
        });
      }, 1200);
    }
  }

  // Periodic chaos simulation: 2% chance to inject watchdog fault
  if (Math.random() < 0.02) {
    const target = sensorState[Math.floor(Math.random() * sensorState.length)];
    if (!target.down) {
      target.lastHeartbeat = 0; // Trigger timeout on next check
    }
  }
}

// Main Engine Loop
setInterval(() => {
  for (const s of sensorState) {
    sensorTick(s);
  }
}, 300); // 300ms sensor interval = smooth, non-laggy, rich data stream

setInterval(scheduleTick, 50); // 50ms CPU scheduler cycle
setInterval(watchdogTick, 1000); // 1000ms watchdog check

process.on('SIGINT', () => {
  emit({ t: elapsedMs(), ev: 'backend_exit', code: 0, signal: 'SIGINT' });
  process.exit(0);
});
