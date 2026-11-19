'use strict';

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const WebSocket = require('ws');

const HISTORY_LIMIT = 500;
const CLIENT_BUFFER_LIMIT = 1024 * 1024;

function parseArguments(argv) {
  const separator = argv.indexOf('--');
  const bridgeArgs = separator === -1 ? argv : argv.slice(0, separator);
  const backendArgs = separator === -1 ? [] : argv.slice(separator + 1);
  let backendPath = process.env.BACKEND_BIN || '../core/disaster_warning';
  let autoRestart = false;

  for (let i = 0; i < bridgeArgs.length; i += 1) {
    if (bridgeArgs[i] === '--auto-restart') {
      autoRestart = true;
    } else if (bridgeArgs[i] === '--binary' && bridgeArgs[i + 1]) {
      backendPath = bridgeArgs[++i];
    } else if (bridgeArgs[i].startsWith('--binary=')) {
      backendPath = bridgeArgs[i].slice('--binary='.length);
    } else {
      throw new Error(`Unknown bridge option: ${bridgeArgs[i]}`);
    }
  }

  const port = Number.parseInt(process.env.PORT || '8080', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }

  return {
    backendPath: path.resolve(__dirname, backendPath),
    backendArgs,
    autoRestart,
    port,
  };
}

const options = parseArguments(process.argv.slice(2));
let history = new Array(HISTORY_LIMIT);
let historyStart = 0;
let historyCount = 0;
let backend = null;
let backendRunning = false;
let shuttingDown = false;
let shutdownFinished = false;
let restartTimer = null;
let restartDelayMs = 1000;
let eventsSeen = 0;
let malformedLines = 0;
let slowClientDrops = 0;

const state = {
  sensors: {},
  queueLength: 0,
  currentRunningAlert: null,
  pageStats: { accesses: 0, faults: 0, hit_ratio: 0 },
  lastMemStats: null,
  schedulerAlgo: null,
};

function remember(event) {
  const index = (historyStart + historyCount) % HISTORY_LIMIT;
  history[index] = event;
  if (historyCount < HISTORY_LIMIT) {
    historyCount += 1;
  } else {
    historyStart = (historyStart + 1) % HISTORY_LIMIT;
  }
}

function historySnapshot() {
  const result = new Array(historyCount);
  for (let i = 0; i < historyCount; i += 1) {
    result[i] = history[(historyStart + i) % HISTORY_LIMIT];
  }
  return result;
}

function cloneState() {
  const sensors = {};
  for (const [id, sensor] of Object.entries(state.sensors)) {
    sensors[id] = { ...sensor };
  }
  return {
    sensors,
    queueLength: state.queueLength,
    currentRunningAlert: state.currentRunningAlert ? { ...state.currentRunningAlert } : null,
    pageStats: { ...state.pageStats },
    lastMemStats: state.lastMemStats ? { ...state.lastMemStats } : null,
    schedulerAlgo: state.schedulerAlgo,
  };
}

function updateState(event) {
  const sensorId = event.sensor;
  if (Number.isInteger(sensorId)) {
    const sensor = state.sensors[sensorId] || {
      status: 'up',
      type: event.type || null,
      lastReading: null,
      restarts: 0,
    };
    if (event.ev === 'reading') {
      sensor.type = event.type;
      sensor.lastReading = event.value;
      if (!sensor.status) sensor.status = 'up';
    } else if (event.ev === 'sensor_status') {
      sensor.type = event.type;
      sensor.status = event.status;
      sensor.lastReading = event.last_reading;
      sensor.restarts = event.restarts;
    } else if (event.ev === 'sensor_down') {
      sensor.status = 'down';
    } else if (event.ev === 'sensor_restarted') {
      sensor.status = 'up';
      sensor.restarts = event.restarts;
    }
    state.sensors[sensorId] = sensor;
  }

  if (Number.isInteger(event.queue_len)) state.queueLength = event.queue_len;
  if (event.ev === 'sched_start') {
    state.queueLength = Math.max(0, state.queueLength - 1);
    state.schedulerAlgo = event.algo;
    state.currentRunningAlert = { id: event.id, algo: event.algo, startedAt: event.t };
  } else if (event.ev === 'sched_end' && state.currentRunningAlert?.id === event.id) {
    state.currentRunningAlert = null;
  } else if (event.ev === 'page_access') {
    state.pageStats.accesses += 1;
    if (event.status === 'hit') {
      state.pageStats.hit_ratio =
        (state.pageStats.accesses - state.pageStats.faults) / state.pageStats.accesses;
    }
  } else if (event.ev === 'page_fault') {
    state.pageStats.faults += 1;
    if (state.pageStats.accesses > 0) {
      state.pageStats.hit_ratio =
        (state.pageStats.accesses - state.pageStats.faults) / state.pageStats.accesses;
    }
  } else if (event.ev === 'mem_stats') {
    state.lastMemStats = {
      accesses: event.accesses,
      faults: event.faults,
      hit_ratio: event.hit_ratio,
      t: event.t,
    };
    state.pageStats = {
      accesses: event.accesses,
      faults: event.faults,
      hit_ratio: event.hit_ratio,
    };
  }
}

function broadcast(event) {
  const serialized = JSON.stringify(event);
  for (const client of webSockets.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    if (client.bufferedAmount > CLIENT_BUFFER_LIMIT) {
      slowClientDrops += 1;
      continue;
    }
    try {
      client.send(serialized, (error) => {
        if (error) slowClientDrops += 1;
      });
    } catch {
      slowClientDrops += 1;
    }
  }
}

function publish(event, fromBackend = false) {
  if (fromBackend) eventsSeen += 1;
  updateState(event);
  remember(event);
  broadcast(event);
}

function snapshotMessage() {
  return {
    ev: 'snapshot',
    events: historySnapshot(),
    state: cloneState(),
  };
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    const body = JSON.stringify({
      backendRunning,
      clients: webSockets.clients.size,
      eventsSeen,
      malformedLines,
      slowClientDrops,
      autoRestart: options.autoRestart,
    });
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    response.end(body);
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end('{"error":"not found"}');
});

const webSockets = new WebSocket.WebSocketServer({ server });
webSockets.on('connection', (socket) => {
  socket.send(JSON.stringify(snapshotMessage()));
});

function handleBackendLine(line) {
  if (line.trim() === '') return;
  let event;
  try {
    event = JSON.parse(line);
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.ev !== 'string') {
      throw new Error('expected an event object with a string ev field');
    }
  } catch (error) {
    malformedLines += 1;
    console.warn(`[bridge] skipped malformed backend line (${malformedLines}): ${error.message}`);
    return;
  }
  publish(event, true);
}

function scheduleRestart() {
  if (!options.autoRestart || shuttingDown || restartTimer) return;
  const delay = restartDelayMs;
  restartDelayMs = Math.min(restartDelayMs * 2, 8000);
  console.warn(`[bridge] restarting backend in ${delay}ms`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    spawnBackend();
  }, delay);
}

function spawnBackend() {
  if (shuttingDown) return;
  let child;
  try {
    child = spawn(options.backendPath, options.backendArgs, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (error) {
    backendRunning = false;
    publish({ ev: 'backend_exit', code: null, signal: null, error: error.message });
    scheduleRestart();
    return;
  }

  backend = child;
  backendRunning = true;
  console.log(`[bridge] backend pid=${child.pid} path=${options.backendPath}`);

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on('line', handleBackendLine);

  child.on('error', (error) => {
    console.warn(`[bridge] backend process error: ${error.message}`);
  });
  child.on('close', (code, signal) => {
    lines.close();
    if (backend === child) {
      backend = null;
      backendRunning = false;
    }
    publish({ ev: 'backend_exit', code, signal });
    if (shuttingDown) {
      finishShutdown();
    } else {
      scheduleRestart();
    }
  });
}

function finishShutdown() {
  if (shutdownFinished) return;
  shutdownFinished = true;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  for (const client of webSockets.clients) {
    try {
      client.close(1001, 'bridge shutting down');
      client.terminate();
    } catch { /* socket already closed */ }
  }
  webSockets.close();
  server.close(() => {
    console.log('[bridge] shutdown complete');
    process.exitCode = 0;
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[bridge] ${signal} received; stopping backend`);
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  if (backend && backend.exitCode === null && backend.signalCode === null) {
    const child = backend;
    child.kill('SIGINT');
    const forceTimer = setTimeout(() => {
      if (backend === child && child.exitCode === null && child.signalCode === null) {
        console.warn('[bridge] backend did not stop within 10s; sending SIGTERM');
        child.kill('SIGTERM');
      }
    }, 10000);
    forceTimer.unref();
    child.once('close', () => clearTimeout(forceTimer));
  } else {
    finishShutdown();
  }
}

server.listen(options.port, '0.0.0.0', () => {
  console.log(`[bridge] listening on 0.0.0.0:${options.port}`);
  console.log(`[bridge] WebSocket: ws://127.0.0.1:${options.port}; health: http://127.0.0.1:${options.port}/health`);
  spawnBackend();
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

