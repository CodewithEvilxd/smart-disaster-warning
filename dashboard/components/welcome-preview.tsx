"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LiveNumber } from "@/components/ui/text-effects";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { DEFAULT_SENSORS, INITIAL_READINGS } from "@/lib/mock-data";

type EventRecord = {
  ev: string;
  t?: number;
  id?: number | string;
  sensor?: number;
  type?: string;
  value?: number;
  severity?: number;
  burst_ms?: number;
  queue_len?: number;
  algo?: string;
  status?: string;
  restarts?: number;
  last_reading?: number;
  accesses?: number;
  faults?: number;
  hit_ratio?: number;
  [key: string]: unknown;
};

type SensorChannel = {
  id: number;
  type: string;
  status: string;
  reading: number | null;
  restarts: number;
};
type ReadingSample = { t: number; sensor: number; value: number };
type RunningAlert = {
  id: number | string;
  sensor?: number;
  type?: string;
  severity?: number;
  burstMs?: number;
  algo: string;
};
type BoardState = {
  sensors: Record<number, SensorChannel>;
  readings: ReadingSample[];
  events: EventRecord[];
  queueLength: number;
  runningAlert: RunningAlert | null;
  algo: string;
  pageFaults: number;
  lastTime: number;
};

type Snapshot = {
  ev: "snapshot";
  events: EventRecord[];
  state?: {
    sensors?: Record<
      string,
      { status?: string; type?: string; lastReading?: number | null; restarts?: number }
    >;
    queueLength?: number;
    currentRunningAlert?: { id?: number | string; algo?: string; startedAt?: number } | null;
    pageStats?: { accesses?: number; faults?: number; hit_ratio?: number };
    schedulerAlgo?: string | null;
  };
};

const initialSensorsMap: Record<number, SensorChannel> = Object.fromEntries(
  DEFAULT_SENSORS.map((s) => [
    s.id,
    { id: s.id, type: s.type, status: s.status, reading: s.reading, restarts: s.restarts },
  ])
);

const initialState: BoardState = {
  sensors: initialSensorsMap,
  readings: INITIAL_READINGS,
  events: [
    { t: 0, ev: "config", seed: 42, sensors: 4, queue_size: 16, algo: "priority", frames: 8 },
    { t: 100, ev: "reading", sensor: 0, type: "earthquake", value: 61.4 },
    { t: 102, ev: "page_access", sensor: 0, page: 2, status: "hit" },
  ],
  queueLength: 0,
  runningAlert: null,
  algo: "PRIORITY",
  pageFaults: 2,
  lastTime: 600,
};

function stateFromSnapshot(snapshot: Snapshot): BoardState {
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const bridge = snapshot.state || {};
  const bridgeSensors = bridge.sensors || {};

  const sensors: Record<number, SensorChannel> = {};
  for (const [idText, item] of Object.entries(bridgeSensors)) {
    const id = Number(idText);
    sensors[id] = {
      id,
      type: item?.type || "sensor",
      status: item?.status || "up",
      reading: typeof item?.lastReading === "number" ? item.lastReading : null,
      restarts: typeof item?.restarts === "number" ? item.restarts : 0,
    };
  }

  const running = bridge.currentRunningAlert;
  const enqueueEvent = running
    ? events.find((item) => item.ev === "alert_enqueued" && String(item.id) === String(running.id))
    : null;

  return {
    sensors: Object.keys(sensors).length ? sensors : initialSensorsMap,
    readings: events
      .filter((e): e is EventRecord & { t: number; sensor: number; value: number } =>
        e.ev === "reading" && typeof e.t === "number" && typeof e.sensor === "number" && typeof e.value === "number"
      )
      .map((e) => ({ t: e.t, sensor: e.sensor, value: e.value }))
      .slice(-90),
    events: events.slice(-300),
    queueLength: typeof bridge.queueLength === "number" ? bridge.queueLength : 0,
    runningAlert: !running
      ? null
      : {
          id: running.id ?? "--",
          sensor: enqueueEvent?.sensor,
          severity: enqueueEvent?.severity,
          burstMs: enqueueEvent?.burst_ms,
          algo: running.algo || bridge.schedulerAlgo || "priority",
        },
    algo: (bridge.schedulerAlgo || "priority").toUpperCase(),
    pageFaults: bridge.pageStats?.faults || 0,
    lastTime: events.at(-1)?.t || 0,
  };
}

function applyLiveEvent(state: BoardState, event: EventRecord): BoardState {
  const next = { ...state, sensors: { ...state.sensors }, lastTime: event.t ?? state.lastTime };
  if (event.ev === "config") return { ...initialState, algo: (event.algo || "priority").toUpperCase(), events: [event] };
  if (event.ev === "backend_exit") {
    for (const sensor of Object.values(next.sensors)) sensor.status = "down";
    next.queueLength = 0;
    next.runningAlert = null;
  }
  if (typeof event.sensor === "number") {
    const old = next.sensors[event.sensor] || {
      id: event.sensor,
      type: event.type || "sensor",
      status: "up",
      reading: null,
      restarts: 0,
    };
    const sensor = { ...old, type: event.type || old.type };
    if (event.ev === "reading" && typeof event.value === "number") {
      sensor.reading = event.value;
      next.readings = [...state.readings, { t: event.t || 0, sensor: event.sensor, value: event.value }].slice(-90);
    }
    if (event.ev === "sensor_status") {
      sensor.status = event.status || "unknown";
      sensor.reading = typeof event.last_reading === "number" ? event.last_reading : sensor.reading;
      sensor.restarts = event.restarts || 0;
    }
    if (event.ev === "sensor_down") sensor.status = "down";
    if (event.ev === "sensor_restarted") {
      sensor.status = "up";
      sensor.restarts = event.restarts || sensor.restarts;
    }
    next.sensors[event.sensor] = sensor;
  }
  if (typeof event.queue_len === "number") next.queueLength = event.queue_len;
  if (event.ev === "sched_start") {
    if (typeof event.queue_len !== "number") next.queueLength = Math.max(0, next.queueLength - 1);
    next.runningAlert = {
      id: event.id || "--",
      sensor: event.sensor,
      type: event.type || state.events.find((item) => item.ev === "alert_enqueued" && String(item.id) === String(event.id))?.type,
      severity: event.severity,
      burstMs: event.burst_ms,
      algo: event.algo || state.algo,
    };
    next.algo = (event.algo || next.algo).toUpperCase();
  }
  if (
    (event.ev === "sched_end" || event.ev === "alert_dispatched") &&
    String(next.runningAlert?.id) === String(event.id)
  )
    next.runningAlert = null;
  if (event.ev === "page_fault") next.pageFaults += 1;
  if (event.ev === "mem_stats") next.pageFaults = event.faults || next.pageFaults;
  next.events = [...state.events, event].slice(-300);
  return next;
}

export const colorForSensor = (type: string) => {
  const name = type.toLowerCase();
  if (name.includes("earthquake")) return "#f59e0b"; // Solar Amber
  if (name.includes("flood")) return "#38bdf8"; // Electric Sky
  if (name.includes("cyclone")) return "#34d399"; // Neon Emerald
  if (name.includes("fire")) return "#ef4444"; // Precision Crimson
  return "#94a3b8";
};

function SignalTrace({ readings, sensors }: { readings: ReadingSample[]; sensors: SensorChannel[] }) {
  const width = 800;
  const height = 180;
  const first = readings[0]?.t ?? 0;
  const last = readings[readings.length - 1]?.t ?? 1;

  const pathFor = (sensorId: number) =>
    readings
      .filter((point) => point.sensor === sensorId)
      .map((point, index) => {
        const x = 36 + ((point.t - first) / Math.max(1, last - first)) * (width - 56);
        const y = height - 20 - (Math.max(0, Math.min(100, point.value)) / 100) * (height - 36);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div className="relative rounded-xl border border-slate-800/80 bg-[#0a0d14] p-4 font-mono overflow-hidden">
      <svg
        className="w-full h-40"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Real-time multi-hazard sensor readings"
      >
        {/* Subtle grid lines */}
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = height - 20 - (tick / 100) * (height - 36);
          return (
            <g key={tick}>
              <line x1="36" x2={width - 20} y1={y} y2={y} stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="2 4" />
              <text x="6" y={y + 3} fill="#64748b" fontSize="10" fontFamily="monospace">
                {tick}%
              </text>
            </g>
          );
        })}

        {/* Threshold 70.0% */}
        <line
          x1="36"
          x2={width - 20}
          y1={height - 20 - 0.7 * (height - 36)}
          y2={height - 20 - 0.7 * (height - 36)}
          stroke="rgba(239, 68, 68, 0.45)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <text
          x={width - 120}
          y={height - 24 - 0.7 * (height - 36)}
          fill="#ef4444"
          fontSize="9"
          className="font-mono uppercase tracking-wider"
        >
          THRESHOLD 70%
        </text>

        {/* Sensor Lines with smooth stroke */}
        {sensors.map((sensor) => {
          const path = pathFor(sensor.id);
          if (!path) return null;
          return (
            <path
              key={sensor.id}
              d={path}
              fill="none"
              stroke={colorForSensor(sensor.type)}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-[d] duration-200"
            />
          );
        })}
      </svg>

      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800/80">
        <span className="font-hud uppercase tracking-wider text-slate-500">SAMPLING TIMELINE</span>
        <span className="font-mono text-slate-400">
          {readings.length
            ? `ELAPSED: ${(first / 1000).toFixed(1)}s → ${(last / 1000).toFixed(1)}s`
            : "WAITING FOR SAMPLING..."}
        </span>
      </div>
    </div>
  );
}

export default function WelcomePreview() {
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [state, setState] = useState(initialState);
  const url = process.env.NEXT_PUBLIC_BRIDGE_URL || "ws://localhost:8080";
  const eventBufferRef = useRef<EventRecord[]>([]);

  // Smooth batching flush: groups high-frequency events to avoid React lag
  useEffect(() => {
    const flushInterval = setInterval(() => {
      if (eventBufferRef.current.length > 0) {
        const batch = eventBufferRef.current.splice(0, eventBufferRef.current.length);
        setState((current) => {
          let s = current;
          for (const ev of batch) {
            s = applyLiveEvent(s, ev);
          }
          return s;
        });
      }
    }, 100); // 10 FPS batching = buttery smooth, 0 lag!

    return () => clearInterval(flushInterval);
  }, []);

  // WebSocket Connection to Bridge
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(url);
      socket.onopen = () => {
        retryDelay = 1000;
        setConnection("live");
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as Snapshot | EventRecord;
          if (event.ev === "snapshot" && "events" in event && Array.isArray(event.events)) {
            setState(stateFromSnapshot(event as Snapshot));
          } else if (typeof event.ev === "string") {
            if (event.ev === "backend_exit") setConnection("offline");
            else if (event.ev === "config") setConnection("live");
            eventBufferRef.current.push(event);
          }
        } catch {
          // Handled
        }
      };
      socket.onerror = () => setConnection("offline");
      socket.onclose = () => {
        setConnection("offline");
        if (!disposed) {
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 8000);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [url]);

  // Autonomous local simulation ticker when offline
  useEffect(() => {
    if (connection === "live") return;
    const simTick = setInterval(() => {
      setState((curr) => {
        const t = curr.lastTime + 300;
        const targetSensor = Math.floor(Math.random() * 4);
        const types = ["earthquake", "flood", "cyclone", "fire"];
        const oldVal = curr.sensors[targetSensor]?.reading ?? 45.0;
        const delta = (Math.random() - 0.48) * 6.0;
        const nextVal = Number(Math.max(15.0, Math.min(95.0, oldVal + delta)).toFixed(1));

        const readingEvent: EventRecord = {
          t,
          ev: "reading",
          sensor: targetSensor,
          type: types[targetSensor],
          value: nextVal,
        };

        let s = applyLiveEvent(curr, readingEvent);
        if (Math.random() < 0.2) {
          s = applyLiveEvent(s, {
            t: t + 2,
            ev: "page_access",
            sensor: targetSensor,
            page: Math.floor(Math.random() * 4),
            status: "hit",
          });
        }
        return s;
      });
    }, 350);

    return () => clearInterval(simTick);
  }, [connection]);

  const sensors = useMemo(
    () => Object.values(state.sensors).sort((a, b) => a.id - b.id),
    [state.sensors]
  );
  const recentEvents = state.events.filter((event) => event.ev !== "config").slice(-4);

  // Simulation test spike trigger for viva/presentation
  const handleSimulateBurst = () => {
    const now = state.lastTime + 500;
    const spikeVal = 88.5;
    const newReading: EventRecord = { t: now, ev: "reading", sensor: 0, type: "earthquake", value: spikeVal };
    const alertEv: EventRecord = { t: now + 5, ev: "alert_enqueued", id: Math.floor(Math.random() * 900) + 100, sensor: 0, severity: 5, burst_ms: 600, queue_len: state.queueLength + 1 };
    setState((curr) => {
      let s = applyLiveEvent(curr, newReading);
      s = applyLiveEvent(s, alertEv);
      return s;
    });
  };

  return (
    <SpotlightCard className="border-slate-800/80 bg-[#0d1017] p-6 rounded-xl space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <span className="font-hud text-xs uppercase tracking-widest text-slate-500 block">
            TELEMETRY STREAM // MONOTONIC CLOCK
          </span>
          <h3 className="font-display text-xl font-bold text-white mt-0.5">
            Active Hazard Sensing Grid
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSimulateBurst}
            className="px-3.5 py-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-700/60 border border-slate-700/80 text-xs font-mono text-slate-200 transition-colors shadow-sm"
          >
            ⚡ Test Hazard Spike
          </button>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-700/80 bg-black/40 text-xs font-mono text-slate-300">
            <span
              className={`h-2 w-2 rounded-full ${
                connection === "live"
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                  : "bg-amber-400"
              }`}
            />
            {connection === "live" ? "WS: CONNECTED" : "WS: OFFLINE (SIMULATING)"}
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-800/80 bg-[#0a0d14] p-3.5">
          <span className="font-hud text-[10px] uppercase text-slate-500 block tracking-wider">CHANNELS</span>
          <span className="font-mono text-xl font-bold text-white">
            {sensors.length.toString().padStart(2, "0")}
          </span>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#0a0d14] p-3.5">
          <span className="font-hud text-[10px] uppercase text-slate-500 block tracking-wider">MAX-HEAP DEPTH</span>
          <span className="font-mono text-xl font-bold text-white">
            {state.queueLength.toString().padStart(2, "0")}
            <span className="text-xs text-slate-400 font-normal ml-1">alerts</span>
          </span>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#0a0d14] p-3.5">
          <span className="font-hud text-[10px] uppercase text-slate-500 block tracking-wider">SCHEDULER POLICY</span>
          <span className="font-mono text-xl font-bold text-white uppercase">
            {state.algo}
          </span>
        </div>
        <div className="rounded-xl border border-slate-800/80 bg-[#0a0d14] p-3.5">
          <span className="font-hud text-[10px] uppercase text-slate-500 block tracking-wider">PAGE FAULTS</span>
          <span className="font-mono text-xl font-bold text-white">
            <LiveNumber value={state.pageFaults} />
          </span>
        </div>
      </div>

      {/* Sensor Channels Grid (Clean Tactile Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {sensors.map((sensor) => {
          const color = colorForSensor(sensor.type);
          const isWarning = (sensor.reading || 0) >= 70;
          return (
            <div
              key={sensor.id}
              className={`rounded-xl border p-4 transition-all duration-200 ${
                isWarning
                  ? "border-red-500/40 bg-red-950/20"
                  : "border-slate-800/80 bg-[#0a0d14] hover:border-slate-700/80"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-500 text-[10px] uppercase tracking-wider font-hud">
                  SENSOR {sensor.id.toString().padStart(2, "0")}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-bold ${
                    sensor.status === "up" ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30" : "bg-red-950/60 text-red-400 border border-red-500/30"
                  }`}
                >
                  {sensor.status}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="font-display text-sm font-bold uppercase tracking-wider text-white">
                  {sensor.type}
                </span>
              </div>

              <div className="mt-3 flex items-baseline justify-between border-t border-slate-800/80 pt-2 font-mono">
                <span className="text-[10px] uppercase text-slate-500">VALUE</span>
                <span className="text-lg font-bold text-white tabular-nums">
                  {sensor.reading !== null ? `${sensor.reading.toFixed(1)}%` : "--"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Waveform Trace */}
      <SignalTrace readings={state.readings} sensors={sensors} />

      {/* Real-time Subsystem Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 font-mono text-xs">
        <div className="rounded-xl border border-slate-800/80 bg-[#0a0d14] p-4 space-y-2">
          <span className="font-hud text-[10px] uppercase text-slate-500 block tracking-wider">CURRENT CPU DISPATCH</span>
          <div className="text-slate-200 flex items-center gap-2 font-semibold">
            {state.runningAlert ? (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>TASK #{state.runningAlert.id} // {state.runningAlert.type} (SEV: {state.runningAlert.severity})</span>
              </>
            ) : (
              <span className="text-slate-500 italic">Standby mode / Ready for alerts</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-[#0a0d14] p-4 space-y-2">
          <span className="font-hud text-[10px] uppercase text-slate-500 block tracking-wider">RECENT PIPE EMISSIONS</span>
          <div className="space-y-1 text-[11px] text-slate-400 font-mono">
            {recentEvents.length ? (
              recentEvents.map((e, idx) => (
                <div key={idx} className="truncate">
                  <span className="text-slate-600">▪</span> {JSON.stringify(e)}
                </div>
              ))
            ) : (
              <span className="text-slate-600 italic">Waiting for pipe messages...</span>
            )}
          </div>
        </div>
      </div>
    </SpotlightCard>
  );
}
