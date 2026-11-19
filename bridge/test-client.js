'use strict';

const WebSocket = require('ws');

const url = process.argv[2] || `ws://127.0.0.1:${process.env.PORT || 8080}`;
const counts = Object.create(null);
let snapshotSize = null;
let snapshotState = null;

const socket = new WebSocket(url);
socket.on('open', () => console.log(`[test-client] connected ${url}`));
socket.on('message', (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    counts.malformed_client_message = (counts.malformed_client_message || 0) + 1;
    return;
  }
  if (message.ev === 'snapshot') {
    snapshotSize = Array.isArray(message.events) ? message.events.length : 0;
    snapshotState = message.state || null;
    for (const event of message.events || []) {
      if (event && typeof event.ev === 'string') counts[event.ev] = (counts[event.ev] || 0) + 1;
    }
  } else if (typeof message.ev === 'string') {
    counts[message.ev] = (counts[message.ev] || 0) + 1;
  }
});
socket.on('error', (error) => console.error(`[test-client] ${error.message}`));
socket.on('close', () => {
  clearInterval(summaryTimer);
  console.log('[test-client] disconnected');
});

const summaryTimer = setInterval(() => {
  const sensors = snapshotState?.sensors || {};
  const sensorStatuses = Object.fromEntries(
    Object.entries(sensors).map(([id, sensor]) => [id, {
      status: sensor.status,
      restarts: sensor.restarts,
      lastReading: sensor.lastReading,
    }]),
  );
  console.log(JSON.stringify({
    ev: 'client_summary',
    snapshotSize,
    counts: { ...counts },
    state: snapshotState && {
      sensorCount: Object.keys(sensors).length,
      sensorStatuses,
      queueLength: snapshotState.queueLength,
      currentRunningAlert: snapshotState.currentRunningAlert,
      pageStats: snapshotState.pageStats,
      lastMemStats: snapshotState.lastMemStats,
      schedulerAlgo: snapshotState.schedulerAlgo,
    },
  }));
}, 2000);

const durationArgument = process.argv.find((argument) => argument.startsWith('--duration-ms='));
if (durationArgument) {
  const duration = Number.parseInt(durationArgument.slice('--duration-ms='.length), 10);
  if (Number.isInteger(duration) && duration > 0) setTimeout(() => socket.close(), duration);
}

process.on('SIGINT', () => socket.close());
process.on('SIGTERM', () => socket.close());
