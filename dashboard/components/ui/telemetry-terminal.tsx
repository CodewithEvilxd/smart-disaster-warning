"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";

export type EventLogItem = {
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
  page?: number;
  accesses?: number;
  faults?: number;
  hit_ratio?: number;
  victim?: number | null;
  frames?: (number | null)[] | number;
  status?: string;
  restarts?: number;
  [key: string]: unknown;
};

interface TelemetryTerminalProps {
  events: EventLogItem[];
  maxDisplay?: number;
}

export function TelemetryTerminal({ events, maxDisplay = 100 }: TelemetryTerminalProps) {
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filteredEvents = useMemo(() => {
    return events
      .filter((e) => {
        if (filter === "readings") return e.ev === "reading";
        if (filter === "alerts") return e.ev.startsWith("alert");
        if (filter === "scheduler") return e.ev.startsWith("sched") || e.ev === "aged";
        if (filter === "paging") return e.ev.startsWith("page") || e.ev === "mem_stats";
        if (filter === "watchdog") return e.ev.startsWith("sensor_") || e.ev === "fault_injected";
        return true;
      })
      .filter((e) => {
        if (!search) return true;
        const s = search.toLowerCase();
        return JSON.stringify(e).toLowerCase().includes(s);
      })
      .slice(-maxDisplay);
  }, [events, filter, search, maxDisplay]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredEvents, autoScroll]);

  const handleCopy = () => {
    const text = filteredEvents.map((e) => JSON.stringify(e)).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getEventBadgeClass = (ev: string) => {
    if (ev === "reading") return "text-blue-400 bg-blue-950/40 border-blue-800/40";
    if (ev === "alert_enqueued") return "text-amber-400 bg-amber-950/40 border-amber-800/40";
    if (ev === "alert_dispatched") return "text-emerald-400 bg-emerald-950/40 border-emerald-800/40";
    if (ev === "alert_dropped") return "text-rose-400 bg-rose-950/40 border-rose-800/40";
    if (ev.startsWith("sched")) return "text-indigo-400 bg-indigo-950/40 border-indigo-800/40";
    if (ev === "aged") return "text-yellow-400 bg-yellow-950/40 border-yellow-800/40";
    if (ev === "page_fault") return "text-purple-400 bg-purple-950/40 border-purple-800/40";
    if (ev === "page_access") return "text-zinc-400 bg-zinc-900 border-zinc-700/40";
    if (ev === "sensor_down" || ev === "fault_injected") return "text-red-400 bg-red-950/40 border-red-800/40";
    if (ev === "sensor_restarted") return "text-teal-400 bg-teal-950/40 border-teal-800/40";
    return "text-zinc-300 bg-zinc-900 border-zinc-800";
  };

  return (
    <div className="flex flex-col rounded-xl border border-slate-800/80 bg-[#0a0d14] overflow-hidden font-mono shadow-md">
      {/* Titlebar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-[#0f131d] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          </div>
          <span className="text-xs text-slate-200 font-semibold font-hud ml-1">
            STDOUT PIPE STREAM // DISASTER WARNING OS
          </span>
          <span className="text-[10px] text-slate-500">({filteredEvents.length} events)</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg bg-black/50 border border-slate-700 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:border-slate-400 focus:outline-none"
          />

          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors ${
              autoScroll
                ? "bg-slate-800 text-white border-slate-600 font-semibold"
                : "bg-transparent text-slate-400 border-slate-800 hover:text-white"
            }`}
          >
            {autoScroll ? "Scroll Lock On" : "Paused"}
          </button>

          <button
            onClick={handleCopy}
            className="rounded-lg bg-slate-800/80 border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-slate-800/80 bg-[#07090e] px-4 py-1.5 text-xs">
        <span className="text-slate-500 text-[10px] uppercase font-hud mr-1 tracking-wider">FILTER:</span>
        {["all", "readings", "alerts", "scheduler", "paging", "watchdog"].map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`rounded-md px-2.5 py-0.5 text-[10px] uppercase font-hud tracking-wide transition-colors ${
              filter === cat
                ? "bg-slate-800 text-white font-bold border border-slate-700"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Log Output Body */}
      <div ref={scrollRef} className="h-64 overflow-y-auto p-3 text-[11px] space-y-1 bg-[#07090e]">
        {filteredEvents.length === 0 ? (
          <div className="flex h-full items-center justify-center text-zinc-400 italic">
            Connecting to C backend output pipe...
          </div>
        ) : (
          filteredEvents.map((e, index) => (
            <div
              key={`${e.t}-${e.ev}-${index}`}
              className="flex items-start gap-2.5 hover:bg-white/[0.02] px-1 py-0.5 rounded transition-colors group"
            >
              <span className="text-zinc-400 select-none tabular-nums w-14 shrink-0 text-[10px]">
                {e.t !== undefined ? `+${(e.t / 1000).toFixed(2)}s` : "--"}
              </span>
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0 border ${getEventBadgeClass(
                  e.ev
                )}`}
              >
                {e.ev}
              </span>
              <span className="text-zinc-300 break-all group-hover:text-white">
                {JSON.stringify(e)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
