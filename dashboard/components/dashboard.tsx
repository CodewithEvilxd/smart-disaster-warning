"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { SpotlightCard } from "@/components/ui/spotlight-card";
import { RadialGauge } from "@/components/ui/radial-gauge";
import { MemoryMatrix } from "@/components/ui/memory-matrix";
import { TelemetryTerminal, EventLogItem } from "@/components/ui/telemetry-terminal";
import { DEFAULT_SENSORS, INITIAL_READINGS } from "@/lib/mock-data";

type EventRecord = EventLogItem;

type Sensor = {
  id: number;
  type: string;
  status: string;
  reading: number | null;
  restarts: number;
};
type ReadingPoint = { t: number; sensor: number; value: number };
type Alert = {
  id: string;
  sensor: number;
  type: string;
  severity: number;
  burstMs: number;
  status: string;
  t: number;
};
type Schedule = { id: string; algo: string; start: number; end: number | null };
type DashboardState = {
  sensors: Record<number, Sensor>;
  readings: ReadingPoint[];
  alerts: Alert[];
  schedules: Schedule[];
  faults: EventRecord[];
  allEvents: EventRecord[];
  queueLength: number;
  pageStats: { accesses: number; faults: number; hit_ratio: number };
  recentFrames: (number | null)[];
  lastVictim: number | null;
  schedulerAlgo: string;
  lastTime: number;
};

type Message =
  | { ev: "snapshot"; events: EventRecord[]; state?: Record<string, unknown> }
  | EventRecord;

type Action =
  | { type: "event"; event: EventRecord }
  | { type: "batch"; events: EventRecord[] }
  | { type: "snapshot"; message: Extract<Message, { ev: "snapshot" }> }
  | { type: "reset" };

const fallbackSensorsMap: Record<number, Sensor> = Object.fromEntries(
  DEFAULT_SENSORS.map((s) => [
    s.id,
    { id: s.id, type: s.type, status: s.status, reading: s.reading, restarts: s.restarts },
  ])
);

const initialState: DashboardState = {
  sensors: fallbackSensorsMap,
  readings: INITIAL_READINGS,
  alerts: [],
  schedules: [],
  faults: [],
  allEvents: [
    { t: 0, ev: "config", seed: 42, sensors: 4, queue_size: 16, algo: "priority", frames: 8 },
    { t: 100, ev: "reading", sensor: 0, type: "earthquake", value: 61.4 },
    { t: 102, ev: "page_access", sensor: 0, page: 2, status: "hit" },
  ],
  queueLength: 0,
  pageStats: { accesses: 14, faults: 3, hit_ratio: 0.786 },
  recentFrames: [0, 1, 2, 3, 4, 5, 6, 7],
  lastVictim: null,
  schedulerAlgo: "priority",
  lastTime: 600,
};

function applyEvent(state: DashboardState, event: EventRecord): DashboardState {
  if (event.ev === "config") {
    return {
      ...initialState,
      schedulerAlgo: typeof event.algo === "string" ? event.algo : "priority",
      lastTime: typeof event.t === "number" ? event.t : 0,
      allEvents: [event],
    };
  }

  const next: DashboardState = {
    ...state,
    sensors: { ...state.sensors },
    readings: state.readings,
    alerts: state.alerts,
    schedules: state.schedules,
    faults: state.faults,
    allEvents: [...state.allEvents, event].slice(-400),
    pageStats: state.pageStats,
    recentFrames: state.recentFrames,
    lastVictim: state.lastVictim,
    lastTime: typeof event.t === "number" ? Math.max(state.lastTime, event.t) : state.lastTime,
  };

  if (event.ev === "backend_exit") {
    const sensors = Object.fromEntries(
      Object.entries(state.sensors).map(([id, sensor]) => [id, { ...sensor, status: "down" }])
    );
    return {
      ...next,
      sensors,
      queueLength: 0,
      alerts: state.alerts.map((alert) =>
        alert.status === "queued" || alert.status === "running" ? { ...alert, status: "stopped" } : alert
      ),
      schedules: state.schedules.map((task) => (task.end === null ? { ...task, end: state.lastTime } : task)),
    };
  }

  if (typeof event.sensor === "number") {
    const previous = next.sensors[event.sensor] || {
      id: event.sensor,
      type: event.type || "sensor",
      status: "up",
      reading: null,
      restarts: 0,
    };
    next.sensors[event.sensor] = { ...previous };
    if (event.type) next.sensors[event.sensor].type = event.type;
    if (event.ev === "reading" && typeof event.value === "number") {
      next.sensors[event.sensor].reading = event.value;
      next.readings = [...state.readings, { t: event.t || 0, sensor: event.sensor, value: event.value }].slice(-90);
    } else if (event.ev === "sensor_status") {
      next.sensors[event.sensor].status = event.status || "unknown";
      next.sensors[event.sensor].reading =
        typeof event.last_reading === "number" ? event.last_reading : previous.reading;
      next.sensors[event.sensor].restarts = event.restarts || 0;
    } else if (event.ev === "sensor_down") {
      next.sensors[event.sensor].status = "down";
    } else if (event.ev === "sensor_restarted") {
      next.sensors[event.sensor].status = "up";
      next.sensors[event.sensor].restarts = event.restarts || previous.restarts;
    }
  }

  const id = event.id === undefined ? "" : String(event.id);
  if ((event.ev === "alert_enqueued" || event.ev === "alert") && id) {
    const sensor = typeof event.sensor === "number" ? event.sensor : 0;
    next.alerts = [
      ...state.alerts.filter((alert) => alert.id !== id),
      {
        id,
        sensor,
        type: next.sensors[sensor]?.type || (event.type as string) || "alert",
        severity: event.severity || 1,
        burstMs: event.burst_ms || 250,
        status: "queued",
        t: event.t || 0,
      },
    ].slice(-80);
    next.queueLength = typeof event.queue_len === "number" ? event.queue_len : state.queueLength + 1;
  } else if (event.ev === "queue_pushed") {
    if (typeof event.queue_len === "number") next.queueLength = event.queue_len;
  } else if (event.ev === "alert_dropped" && id) {
    next.alerts = state.alerts.map((alert) => (alert.id === id ? { ...alert, status: "dropped" } : alert));
    if (typeof event.queue_len === "number") next.queueLength = event.queue_len;
  } else if (event.ev === "sched_start" && id) {
    next.schedulerAlgo = event.algo || state.schedulerAlgo;
    next.queueLength = Math.max(0, state.queueLength - 1);
    next.schedules = [
      ...state.schedules,
      { id, algo: event.algo || "priority", start: event.t || 0, end: null },
    ].slice(-30);
    next.alerts = state.alerts.map((alert) => (alert.id === id ? { ...alert, status: "running" } : alert));
  } else if (event.ev === "sched_end" && id) {
    next.schedules = state.schedules.map((task) =>
      task.id === id && task.end === null ? { ...task, end: event.t || task.start } : task
    );
    next.alerts = state.alerts.map((alert) => (alert.id === id ? { ...alert, status: "dispatched" } : alert));
  } else if (event.ev === "alert_dispatched" && id) {
    next.alerts = state.alerts.map((alert) => (alert.id === id ? { ...alert, status: "dispatched" } : alert));
  } else if (event.ev === "aged" && id) {
    next.alerts = state.alerts.map((alert) =>
      alert.id === id ? { ...alert, severity: (event.new_severity as number) || alert.severity + 1 } : alert
    );
  } else if (event.ev === "page_fault") {
    next.pageStats = { ...state.pageStats, faults: state.pageStats.faults + 1 };
    if (Array.isArray(event.frames)) {
      next.recentFrames = event.frames as (number | null)[];
    }
    if (event.victim !== undefined) {
      next.lastVictim = event.victim as number | null;
    }
  } else if (event.ev === "mem_stats") {
    next.pageStats = {
      accesses: typeof event.accesses === "number" ? event.accesses : 0,
      faults: typeof event.faults === "number" ? event.faults : 0,
      hit_ratio: typeof event.hit_ratio === "number" ? event.hit_ratio : 0,
    };
  }

  if (["fault_injected", "sensor_down", "sensor_restarted"].includes(event.ev)) {
    next.faults = [event, ...state.faults].slice(0, 30);
  }
  return next;
}

function reducer(state: DashboardState, action: Action): DashboardState {
  if (action.type === "reset") return initialState;
  if (action.type === "event") return applyEvent(state, action.event);
  if (action.type === "batch") {
    let s = state;
    for (const ev of action.events) {
      s = applyEvent(s, ev);
    }
    return s;
  }
  let replayed = initialState;
  for (const event of action.message.events || []) replayed = applyEvent(replayed, event);
  const snapshot = action.message.state || {};
  const bridgeSensors = snapshot.sensors as
    | Record<string, { status?: string; type?: string; lastReading?: number | null; restarts?: number }>
    | undefined;
  if (bridgeSensors) {
    const sensors: Record<number, Sensor> = { ...replayed.sensors };
    for (const [idText, item] of Object.entries(bridgeSensors)) {
      const id = Number(idText);
      sensors[id] = {
        id,
        type: item.type || sensors[id]?.type || "sensor",
        status: item.status || "unknown",
        reading: item.lastReading ?? sensors[id]?.reading ?? null,
        restarts: item.restarts || 0,
      };
    }
    replayed.sensors = sensors;
  }
  if (typeof snapshot.queueLength === "number") replayed.queueLength = snapshot.queueLength;
  if (typeof snapshot.schedulerAlgo === "string") replayed.schedulerAlgo = snapshot.schedulerAlgo;
  if (snapshot.pageStats && typeof snapshot.pageStats === "object") {
    const stats = snapshot.pageStats as { accesses?: number; faults?: number; hit_ratio?: number };
    replayed.pageStats = {
      accesses: typeof stats.accesses === "number" ? stats.accesses : replayed.pageStats.accesses,
      faults: typeof stats.faults === "number" ? stats.faults : replayed.pageStats.faults,
      hit_ratio: typeof stats.hit_ratio === "number" ? stats.hit_ratio : replayed.pageStats.hit_ratio,
    };
  }
  return replayed;
}

const sensorColor = (type: string) => {
  const normalized = type.toLowerCase();
  if (normalized.includes("earthquake")) return "#f59e0b"; // Solar Amber
  if (normalized.includes("flood")) return "#38bdf8"; // Electric Sky
  if (normalized.includes("cyclone")) return "#34d399"; // Neon Emerald
  if (normalized.includes("fire")) return "#ef4444"; // Precision Crimson
  return "#94a3b8";
};

function ReadingChart({ points, sensors }: { points: ReadingPoint[]; sensors: Sensor[] }) {
  const width = 900;
  const height = 220;
  const chartPoints = points.length > 1 ? points : [];
  const minT = chartPoints[0]?.t ?? 0;
  const maxT = chartPoints[chartPoints.length - 1]?.t ?? 1;

  const pathFor = (sensorId: number) =>
    chartPoints
      .filter((point) => point.sensor === sensorId)
      .map((point, index) => {
        const x = 36 + ((point.t - minT) / Math.max(1, maxT - minT)) * (width - 56);
        const y = height - 24 - (Math.max(0, Math.min(100, point.value)) / 100) * (height - 44);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div className="space-y-3 font-mono">
      <div className="relative rounded-xl border border-slate-800/80 bg-[#0a0d14] p-4 overflow-hidden">
        <svg
          className="w-full h-52"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Sensor Reading History Waveforms"
        >
          {/* Ticks */}
          {[0, 25, 50, 75, 100].map((tick) => {
            const y = height - 24 - (tick / 100) * (height - 44);
            return (
              <g key={tick}>
                <line x1="36" x2={width - 16} y1={y} y2={y} stroke="rgba(255, 255, 255, 0.05)" strokeDasharray="2 4" />
                <text x="6" y={y + 3} fill="#64748b" fontSize="10">
                  {tick}%
                </text>
              </g>
            );
          })}

          {/* Critical Threshold 70% */}
          <line
            x1="36"
            x2={width - 16}
            y1={height - 24 - 0.7 * (height - 44)}
            y2={height - 24 - 0.7 * (height - 44)}
            stroke="rgba(239, 68, 68, 0.45)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />

          {/* Sensor Paths with smooth transitions */}
          {sensors.map((sensor) => (
            <path
              key={sensor.id}
              d={pathFor(sensor.id)}
              fill="none"
              stroke={sensorColor(sensor.type)}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-[d] duration-200"
            />
          ))}
        </svg>

        {chartPoints.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-slate-400 italic">
            Connecting to sensor threads for telemetry...
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 gap-2">
        <div className="flex items-center gap-4">
          {sensors.map((sensor) => (
            <span key={sensor.id} className="flex items-center gap-1.5 font-hud">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sensorColor(sensor.type) }} />
              <span className="uppercase text-slate-300 font-semibold">{sensor.type}</span>
            </span>
          ))}
        </div>
        <span className="font-mono text-slate-500">
          WINDOW: {chartPoints.length ? `${(minT / 1000).toFixed(1)}s → ${(maxT / 1000).toFixed(1)}s` : "--"}
        </span>
      </div>
    </div>
  );
}

function GanttChart({ schedules, now }: { schedules: Schedule[]; now: number }) {
  const visible = schedules.slice(-10);
  const min = visible[0]?.start ?? 0;
  const lastScheduleTime =
    visible[visible.length - 1]?.end || visible[visible.length - 1]?.start || min + 1;
  const max = Math.max(lastScheduleTime, now, min + 1);

  return (
    <div className="space-y-3 font-mono">
      {visible.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-slate-800/80 bg-[#0a0d14] p-5">
          <div className="flex justify-between text-[11px] text-slate-500 border-b border-slate-800/80 pb-2 font-hud">
            <span>SCHEDULER TIMELINE RULER [0ms - 2000ms]</span>
            <span>READY FOR DISPATCH JOBS</span>
          </div>
          <div className="h-8 rounded-lg bg-white/[0.02] border border-dashed border-slate-800 flex items-center justify-center text-xs text-slate-500 italic">
            Waiting for threshold breach (&gt;= 70%) to populate Gantt execution slices...
          </div>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-slate-800/80 bg-[#0a0d14] p-4">
          {visible.map((task) => {
            const start = ((task.start - min) / (max - min)) * 100;
            const endTime = task.end ?? max;
            const width = Math.max(3, ((endTime - task.start) / (max - min)) * 100);
            const isRunning = task.end === null;

            return (
              <div key={`${task.id}-${task.start}`} className="flex items-center gap-3 text-xs">
                <span className="w-16 font-mono text-slate-300 font-semibold shrink-0">
                  #{task.id}
                </span>
                <div className="relative flex-1 h-7 rounded-lg bg-white/[0.03] border border-slate-800/80 overflow-hidden">
                  <div
                    className={`absolute top-0 bottom-0 rounded flex items-center px-2 text-[10px] font-bold ${
                      isRunning
                        ? "bg-white text-black shadow-sm"
                        : "bg-slate-800 text-slate-200 border border-slate-700/80"
                    }`}
                    style={{
                      left: `${Math.max(0, Math.min(97, start))}%`,
                      width: `${Math.min(width, 100 - start)}%`,
                    }}
                  >
                    <span className="truncate">
                      {task.algo} {isRunning ? "• ACTIVE" : `• ${task.end! - task.start}ms`}
                    </span>
                  </div>
                </div>
                <span className="w-16 text-right font-hud text-[11px] text-slate-500 shrink-0">
                  {isRunning ? "RUNNING" : `${task.end! - task.start}ms`}
                </span>
              </div>
            );
          })}
          <div className="flex justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-800/80">
            <span>OFFSET: {min}ms</span>
            <span>CLOCK: {max}ms</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [isSimPaused, setIsSimPaused] = useState(false);
  const [url] = useState(() => process.env.NEXT_PUBLIC_BRIDGE_URL || "ws://localhost:8080");
  const eventBufferRef = useRef<EventRecord[]>([]);

  // Flush batched WebSocket events every 100ms: stops unthrottled React re-rendering lag
  useEffect(() => {
    const flushInterval = setInterval(() => {
      if (eventBufferRef.current.length > 0) {
        const batch = eventBufferRef.current.splice(0, eventBufferRef.current.length);
        dispatch({ type: "batch", events: batch });
      }
    }, 100); // 10 FPS batching = zero lag, silky smooth!

    return () => clearInterval(flushInterval);
  }, []);

  // WebSocket Bridge connection
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
      socket.onmessage = (incoming) => {
        try {
          const event = JSON.parse(String(incoming.data)) as Message;
          if (event.ev === "snapshot" && "events" in event && Array.isArray(event.events)) {
            dispatch({ type: "snapshot", message: event as Extract<Message, { ev: "snapshot" }> });
          } else if (typeof event.ev === "string") {
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

  // Autonomous local simulation engine when bridge is offline
  useEffect(() => {
    if (connection === "live" || isSimPaused) return;

    let simAlertId = 500;
    const simTimer = setInterval(() => {
      const now = state.lastTime + 300;
      const types = ["earthquake", "flood", "cyclone", "fire"];
      const targetSensor = Math.floor(Math.random() * 4);
      const prevVal = state.sensors[targetSensor]?.reading ?? 45.0;
      const delta = (Math.random() - 0.48) * 6.5;
      const nextVal = Number(Math.max(15.0, Math.min(95.0, prevVal + delta)).toFixed(1));

      const batch: EventRecord[] = [
        { t: now, ev: "reading", sensor: targetSensor, type: types[targetSensor], value: nextVal },
      ];

      // Memory access
      if (Math.random() < 0.8) {
        batch.push({
          t: now + 2,
          ev: "page_access",
          sensor: targetSensor,
          page: Math.floor(Math.random() * 4),
          status: "hit",
        });
      } else {
        const victim = Math.floor(Math.random() * 8);
        const newFrames = [...state.recentFrames];
        newFrames[victim] = 4 + Math.floor(Math.random() * 8);
        batch.push({
          t: now + 2,
          ev: "page_fault",
          sensor: targetSensor,
          page: newFrames[victim] as number,
          victim,
          frames: newFrames,
        });
      }

      // Check threshold alert
      const thresholds = [65.0, 70.0, 75.0, 68.0];
      if (nextVal >= thresholds[targetSensor]) {
        simAlertId += 1;
        const aid = `sim_${simAlertId}`;
        const sev = Math.min(5, Math.max(1, 1 + Math.floor((nextVal - thresholds[targetSensor]) / 5.0)));
        const burst = Math.floor(200 + Math.random() * 400);

        batch.push({
          t: now + 5,
          ev: "alert",
          id: aid,
          sensor: targetSensor,
          type: types[targetSensor],
          severity: sev,
          burst_ms: burst,
          queue_len: state.queueLength + 1,
        });
        batch.push({
          t: now + 10,
          ev: "sched_start",
          id: aid,
          algo: state.schedulerAlgo,
          severity: sev,
          burst_ms: burst,
        });
      }

      dispatch({ type: "batch", events: batch });
    }, 320);

    return () => clearInterval(simTimer);
  }, [connection, isSimPaused, state.lastTime, state.sensors, state.queueLength, state.recentFrames, state.schedulerAlgo]);

  const sensors = useMemo(
    () => Object.values(state.sensors).sort((a, b) => a.id - b.id),
    [state.sensors]
  );
  const queuedAlerts = state.alerts
    .filter((alert) => alert.status === "queued" || alert.status === "running")
    .sort((a, b) => b.severity - a.severity || b.t - a.t)
    .slice(0, 8);
  const runningAlert = state.alerts.find((alert) => alert.status === "running");

  // Interactive Live Demo Simulation Controls
  const handleTriggerHazard = (type: "earthquake" | "flood" | "cyclone" | "fire") => {
    const t = state.lastTime + 100;
    const alertId = Math.floor(Math.random() * 9000) + 1000;
    const defs = {
      earthquake: { sensor: 0, val: 89.4, sev: 5, burst: 650 },
      flood: { sensor: 1, val: 84.2, sev: 4, burst: 480 },
      cyclone: { sensor: 2, val: 92.5, sev: 5, burst: 720 },
      fire: { sensor: 3, val: 87.0, sev: 4, burst: 540 },
    };
    const def = defs[type];

    const events: EventRecord[] = [
      { t, ev: "reading", sensor: def.sensor, type, value: def.val },
      { t: t + 10, ev: "alert_enqueued", id: alertId, sensor: def.sensor, severity: def.sev, burst_ms: def.burst, queue_len: state.queueLength + 1 },
      { t: t + 20, ev: "sched_start", id: alertId, algo: state.schedulerAlgo, severity: def.sev, burst_ms: def.burst },
    ];

    dispatch({ type: "batch", events });
  };

  const handleInjectFault = () => {
    const t = state.lastTime + 100;
    const events: EventRecord[] = [
      { t, ev: "fault_injected", sensor: 2, mode: "manual_chaos" },
      { t: t + 50, ev: "sensor_down", sensor: 2, last_heartbeat: t },
    ];
    dispatch({ type: "batch", events });

    setTimeout(() => {
      dispatch({
        type: "event",
        event: { t: t + 1200, ev: "sensor_restarted", sensor: 2, restarts: (state.sensors[2]?.restarts || 0) + 1 },
      });
    }, 1200);
  };

  const handleCycleAlgo = () => {
    const algos = ["priority", "rr", "sjf"];
    const currentIdx = algos.indexOf(state.schedulerAlgo);
    const nextAlgo = algos[(currentIdx + 1) % algos.length];
    dispatch({
      type: "event",
      event: { t: state.lastTime + 50, ev: "config", seed: 42, sensors: 4, queue_size: 16, algo: nextAlgo, frames: 8 },
    });
  };

  return (
    <main className="min-h-screen bg-[#07090e] text-[#f1f5f9] p-4 sm:p-6 lg:p-8 space-y-8 font-sans">
      {/* Header Bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800/80 bg-[#0d1017]/90 backdrop-blur-md px-6 py-4 shadow-lg">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-black font-mono text-xs font-bold tracking-tight">
              OS
            </div>
            <div>
              <span className="font-display text-base font-bold tracking-wider text-white block">
                SENTINEL OPERATIONS
              </span>
              <span className="font-hud text-[8px] uppercase tracking-widest text-slate-400 block -mt-0.5">
                DISASTER WARNING MISSION CONTROL
              </span>
            </div>
          </Link>
        </div>

        {/* Anchor Links */}
        <nav className="hidden lg:flex items-center gap-6 font-hud text-xs text-slate-400">
          <a href="#sensors" className="hover:text-white transition-colors">SENSORS</a>
          <a href="#dispatch" className="hover:text-white transition-colors">DISPATCH</a>
          <a href="#scheduler" className="hover:text-white transition-colors">SCHEDULER</a>
          <a href="#telemetry" className="hover:text-white transition-colors">TELEMETRY</a>
          <a href="#terminal" className="hover:text-white transition-colors">TERMINAL</a>
        </nav>

        {/* Status Indicators */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 rounded-lg border border-slate-800/80 bg-black/40 px-3 py-1.5 font-mono text-xs">
            <span className="font-hud text-slate-500">POLICY:</span>
            <span className="font-semibold text-white uppercase">{state.schedulerAlgo || "--"}</span>
            <span className="text-slate-700">|</span>
            <span className="font-hud text-slate-500">CLOCK:</span>
            <span className="text-white tabular-nums">{(state.lastTime / 1000).toFixed(1)}s</span>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-700/80 bg-black/40 text-xs font-mono text-slate-300">
            <span
              className={`h-2 w-2 rounded-full ${
                connection === "live"
                  ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                  : "bg-amber-400"
              }`}
            />
            <span className="uppercase">
              {connection === "live" ? "WS: BRIDGE LIVE" : "SIM ENGINE ACTIVE"}
            </span>
          </div>
        </div>
      </header>

      {/* Live Simulation & Viva Demo Toolbar */}
      <section className="rounded-xl border border-slate-800/80 bg-[#0d1017] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 font-mono text-xs text-slate-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-hud uppercase tracking-wider text-slate-300">INTERACTIVE VIVA / DEMO CONTROLS:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Preset Hazard Spikes */}
          <button
            type="button"
            onClick={() => handleTriggerHazard("earthquake")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-950/30 hover:bg-amber-900/40 text-xs font-mono text-amber-300 transition-colors shadow-sm"
          >
            ⚡ Earthquake (89%)
          </button>
          <button
            type="button"
            onClick={() => handleTriggerHazard("flood")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-500/30 bg-sky-950/30 hover:bg-sky-900/40 text-xs font-mono text-sky-300 transition-colors shadow-sm"
          >
            🌊 Flood (84%)
          </button>
          <button
            type="button"
            onClick={() => handleTriggerHazard("cyclone")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/30 hover:bg-emerald-900/40 text-xs font-mono text-emerald-300 transition-colors shadow-sm"
          >
            🌀 Cyclone (92%)
          </button>
          <button
            type="button"
            onClick={() => handleTriggerHazard("fire")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-950/30 hover:bg-red-900/40 text-xs font-mono text-red-300 transition-colors shadow-sm"
          >
            🔥 Fire (87%)
          </button>

          <button
            type="button"
            onClick={handleInjectFault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-500/30 bg-orange-950/30 hover:bg-orange-900/40 text-xs font-mono text-orange-300 transition-colors shadow-sm"
          >
            ⚠ Watchdog Fault
          </button>

          <button
            type="button"
            onClick={handleCycleAlgo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-950/30 hover:bg-indigo-900/40 text-xs font-mono text-indigo-300 transition-colors shadow-sm"
          >
            🔄 Sched ({state.schedulerAlgo.toUpperCase()})
          </button>

          <button
            type="button"
            onClick={() => setIsSimPaused(!isSimPaused)}
            className="px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/40 hover:bg-slate-700/60 text-xs font-mono text-slate-300 transition-colors"
          >
            {isSimPaused ? "▶ Resume" : "⏸ Pause"}
          </button>

          <button
            type="button"
            onClick={() => dispatch({ type: "reset" })}
            className="px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/40 hover:bg-slate-700/60 text-xs font-mono text-slate-400 transition-colors"
          >
            Reset
          </button>
        </div>
      </section>

      {/* Sensor Channels Grid */}
      <section id="sensors" className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
          <div>
            <span className="font-hud text-xs uppercase text-slate-500 tracking-wider">
              PHYSICAL INTERFACE // SENSORS
            </span>
            <h2 className="font-display text-xl font-bold text-white">
              Environmental Sensor Network
            </h2>
          </div>
          <span className="font-hud text-xs text-slate-500">
            {sensors.length} ACTIVE POSIX THREADS
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {sensors.map((sensor) => {
            const color = sensorColor(sensor.type);
            const isAlert = (sensor.reading || 0) >= 70;
            return (
              <SpotlightCard
                key={sensor.id}
                spotlightColor={color}
                className={`p-5 transition-all duration-200 ${
                  isAlert ? "border-red-500/50 bg-red-950/20" : ""
                }`}
              >
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-500 uppercase tracking-widest text-[10px] font-hud">
                    CHANNEL {sensor.id.toString().padStart(2, "0")}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      sensor.status === "up"
                        ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                        : "bg-red-950/60 text-red-400 border border-red-500/30"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        sensor.status === "up" ? "bg-emerald-400" : "bg-red-400"
                      }`}
                    />
                    {sensor.status}
                  </span>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <h3 className="font-display text-lg font-bold uppercase tracking-wider text-white">
                      {sensor.type}
                    </h3>
                    <p className="font-mono text-xs text-slate-400 mt-0.5">
                      {sensor.restarts} restarts
                    </p>
                  </div>
                  <RadialGauge
                    value={sensor.reading || 0}
                    color={color}
                    unit="%"
                    label="VAL"
                    threshold={70}
                  />
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-slate-800/80 pt-3 text-xs font-mono">
                  <span className="text-slate-500 text-[10px] uppercase font-hud">
                    ALERT THRESHOLD
                  </span>
                  <span className={`font-semibold ${isAlert ? "text-red-400" : "text-slate-400"}`}>
                    &gt;= 70.0%
                  </span>
                </div>
              </SpotlightCard>
            );
          })}
        </div>
      </section>

      {/* Middle Row: Priority Queue & CPU Core Execution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Priority Max-Heap Queue (8 Cols) */}
        <section id="dispatch" className="lg:col-span-8 space-y-3">
          <SpotlightCard className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div>
                <span className="font-hud text-xs uppercase text-slate-500 tracking-wider">
                  SEVERITY MAX-HEAP // BOUNDED BUFFER
                </span>
                <h3 className="font-display text-lg font-bold text-white">
                  Alert Dispatch Queue
                </h3>
              </div>
              <span className="rounded-md border border-slate-700/80 bg-black/40 px-2.5 py-1 font-mono text-xs text-slate-300">
                {state.queueLength} QUEUED
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 text-[10px] uppercase text-slate-500 font-hud">
                    <th className="pb-2">Alert ID</th>
                    <th className="pb-2">Hazard</th>
                    <th className="pb-2">Severity</th>
                    <th className="pb-2">Burst</th>
                    <th className="pb-2">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {queuedAlerts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 italic">
                        No alerts queued. Click &quot;⚡ Preset Hazard&quot; above to simulate emergency spikes.
                      </td>
                    </tr>
                  ) : (
                    queuedAlerts.map((alert) => (
                      <tr key={alert.id} className="hover:bg-slate-800/20 transition-colors">
                        <td className="py-2.5 font-bold text-white">#{alert.id}</td>
                        <td className="py-2.5 uppercase font-semibold" style={{ color: sensorColor(alert.type) }}>
                          {alert.type}
                        </td>
                        <td className="py-2.5">
                          <span className="px-2 py-0.5 rounded bg-white/10 text-white font-bold text-[10px]">
                            LVL {alert.severity}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-300">{alert.burstMs}ms</td>
                        <td className="py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                              alert.status === "running"
                                ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/40 animate-pulse"
                                : "bg-amber-950/60 text-amber-300 border border-amber-500/40"
                            }`}
                          >
                            {alert.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/80 pt-3 font-hud">
              <span>MUTEX: PTHREAD_MUTEX_T</span>
              <span>SEMAPHORES: EMPTY/FULL</span>
            </div>
          </SpotlightCard>
        </section>

        {/* CPU Execution Unit (4 Cols) */}
        <section id="scheduler" className="lg:col-span-4 space-y-3">
          <SpotlightCard className="p-6 space-y-5 h-full flex flex-col justify-between">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div>
                <span className="font-hud text-xs uppercase text-slate-500 tracking-wider">
                  CPU CORE // EXECUTION UNIT
                </span>
                <h3 className="font-display text-lg font-bold text-white">
                  Processor State
                </h3>
              </div>
              <span className={`h-2.5 w-2.5 rounded-full ${runningAlert ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            </div>

            <div className="flex flex-col items-center justify-center text-center py-4">
              {runningAlert ? (
                <div className="space-y-3">
                  <div className="h-16 w-16 rounded-full border-2 border-emerald-400/40 bg-emerald-950/20 flex items-center justify-center mx-auto text-emerald-400 text-xs font-mono font-bold animate-pulse">
                    BUSY
                  </div>
                  <div>
                    <span className="font-display text-lg font-bold text-white block">
                      TASK #{runningAlert.id}
                    </span>
                    <span className="font-mono text-xs uppercase font-semibold text-emerald-400 block mt-0.5">
                      {runningAlert.type} (BURST: {runningAlert.burstMs}ms)
                    </span>
                    <span className="font-hud text-[10px] text-slate-400 block mt-1">
                      SEVERITY LEVEL {runningAlert.severity} // ALGO: {state.schedulerAlgo.toUpperCase()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="h-12 w-12 rounded-full border border-slate-700 bg-black/40 flex items-center justify-center mx-auto text-slate-500 text-xs font-mono">
                    IDLE
                  </div>
                  <span className="font-display text-base font-bold text-slate-400 block">
                    CPU Idle
                  </span>
                  <span className="font-hud text-[11px] text-slate-500 block">
                    Waiting for threshold alert in max-heap queue.
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-800/80 pt-3 font-hud">
              <span>CONTEXT SWITCH: READY</span>
              <span>AGING TICK: 1000MS</span>
            </div>
          </SpotlightCard>
        </section>
      </div>

      {/* Sensor Telemetry & Virtual Memory Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section id="telemetry" className="lg:col-span-8 space-y-3">
          <SpotlightCard className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div>
                <span className="font-hud text-xs uppercase text-slate-500 tracking-wider">
                  REAL-TIME TELEMETRY // 90 SAMPLES
                </span>
                <h3 className="font-display text-lg font-bold text-white">
                  Multi-Hazard Sensor Waveform
                </h3>
              </div>
              <span className="font-hud text-xs text-slate-500">
                CIRCULAR BUFFER TRACK
              </span>
            </div>
            <ReadingChart points={state.readings} sensors={sensors} />
          </SpotlightCard>
        </section>

        {/* Paging System (MemoryMatrix) */}
        <section className="lg:col-span-4 space-y-3">
          <SpotlightCard className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div>
                <span className="font-hud text-xs uppercase text-slate-500 tracking-wider">
                  PAGING SYSTEM // FIFO &amp; LRU
                </span>
                <h3 className="font-display text-lg font-bold text-white">
                  Virtual Memory
                </h3>
              </div>
              <span className="rounded-md border border-slate-700/80 bg-black/40 px-2 py-0.5 font-mono text-xs text-slate-300">
                {state.pageStats.faults} FAULTS
              </span>
            </div>
            <MemoryMatrix
              frames={state.recentFrames}
              accesses={state.pageStats.accesses}
              hitRatio={state.pageStats.hit_ratio}
              victim={state.lastVictim}
              pageAlgo="FIFO"
            />
          </SpotlightCard>
        </section>
      </div>

      {/* Gantt Timeline */}
      <section className="space-y-3">
        <SpotlightCard className="p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div>
              <span className="font-hud text-xs uppercase text-slate-500 tracking-wider">
                GANTT TIMELINE // CPU SCHEDULING
              </span>
              <h3 className="font-display text-lg font-bold text-white">
                Task Execution &amp; Dispatch History
              </h3>
            </div>
            <span className="font-hud text-xs uppercase tracking-wider text-slate-400">
              {state.schedulerAlgo} SCHEDULER
            </span>
          </div>
          <GanttChart schedules={state.schedules} now={state.lastTime} />
        </SpotlightCard>
      </section>

      {/* Terminal & Audit Log */}
      <section id="terminal" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 space-y-3">
          <SpotlightCard className="p-6 space-y-4 h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                <span className="font-hud text-xs uppercase tracking-wider text-red-400">
                  SUPERVISOR // WATCHDOG
                </span>
                <span className="font-mono text-xs text-slate-500">
                  {state.faults.length} events
                </span>
              </div>
              <h3 className="font-display text-lg font-bold text-white mt-3">
                Fault &amp; Recovery Audit
              </h3>
              <p className="font-mono text-xs text-slate-400 mt-2 leading-relaxed">
                Autonomous recovery via pthread_join and replacement pthread_create.
              </p>
            </div>

            <div className="space-y-2 font-mono text-xs pt-4 border-t border-slate-800/80">
              {state.faults.length === 0 ? (
                <div className="text-slate-500 italic py-6 text-center">
                  Click &quot;⚠ Watchdog Fault&quot; above to simulate thread failure.
                </div>
              ) : (
                state.faults.slice(0, 4).map((f, i) => (
                  <div key={i} className="rounded-lg bg-red-950/20 border border-red-500/20 p-2.5">
                    <span className="font-bold text-red-400 uppercase text-[10px] block">
                      {f.ev}
                    </span>
                    <span className="text-slate-300 text-[11px] block mt-0.5">
                      Sensor #{f.sensor} · t={f.t}ms
                    </span>
                  </div>
                ))
              )}
            </div>
          </SpotlightCard>
        </div>

        <div className="lg:col-span-8">
          <TelemetryTerminal events={state.allEvents} />
        </div>
      </section>

      {/* Footer Return */}
      <footer className="flex items-center justify-between pt-6 border-t border-slate-800/80 text-xs font-mono text-slate-500">
        <Link href="/" className="hover:text-white transition-colors">
          ← RETURN TO SENTINEL OVERVIEW
        </Link>
        <span>CLOCK: {(state.lastTime / 1000).toFixed(1)}s · ENDPOINT: {url}</span>
      </footer>
    </main>
  );
}
