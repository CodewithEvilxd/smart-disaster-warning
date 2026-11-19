"use client";

import { useState } from "react";
import { SpotlightCard } from "@/components/ui/spotlight-card";

const stages = [
  {
    number: "01",
    title: "SENSE",
    subtitle: "POSIX Pthreads & Ring Buffer",
    concept: "MULTITHREADING & ATOMICS",
    c_func: "sensor_thread() [core/sensor.c]",
    detail: "4 concurrent worker threads sample simulated physical hazard environments. Each thread runs an independent non-blocking XOR-shift pseudo-random generator (preventing lock contention) and updates atomic heartbeat timestamps.",
    event: "{\"ev\":\"reading\", \"sensor\":0, \"value\":94.2}",
    color: "#f59e0b",
  },
  {
    number: "02",
    title: "BUFFER",
    subtitle: "Atomic IPC Pipe & Logger",
    concept: "INTER-PROCESS COMMUNICATION",
    c_func: "event_log_emit() [core/event_log.c]",
    detail: "Events are emitted via a POSIX pipe using writes strictly bounded by PIPE_BUF (4096 bytes). POSIX guarantees atomic delivery with zero byte interleaving between concurrent threads, serialized by a dedicated logger thread.",
    event: "{\"ev\":\"pipe_write\", \"bytes\":68, \"atomic\":true}",
    color: "#38bdf8",
  },
  {
    number: "03",
    title: "RANK",
    subtitle: "Priority Max-Heap & Semaphores",
    concept: "SYNCHRONIZATION & PREEMPTION",
    c_func: "queue_push() [core/queue.c]",
    detail: "Alerts entering the bounded buffer are ordered by severity (1-5) inside a binary max-heap protected by pthread_mutex_t. Counting semaphores (empty_slots / full_slots) coordinate producer-consumer handoffs without busy waiting.",
    event: "{\"ev\":\"alert_enqueued\", \"id\":14, \"severity\":5}",
    color: "#a855f7",
  },
  {
    number: "04",
    title: "DISPATCH",
    subtitle: "CPU Scheduler & Dynamic Aging",
    concept: "CPU PROCESS SCHEDULING",
    c_func: "scheduler_thread() [core/scheduler.c]",
    detail: "Implements 3 classical CPU algorithms: Priority Scheduling, Round Robin with configurable quantum slicing, and Shortest Job First. Starvation is solved by an Aging Mechanism that boosts waiting alert severity every 1000ms.",
    event: "{\"ev\":\"sched_start\", \"id\":14, \"algo\":\"priority\"}",
    color: "#06b6d4",
  },
  {
    number: "05",
    title: "PAGE",
    subtitle: "Virtual Memory & Replacement",
    concept: "PAGING & LOCALITY OF REFERENCE",
    c_func: "memory_record_reading() [core/memory.c]",
    detail: "Sensor circular history is partitioned into virtual pages. Models the 80/20 Locality of Reference rule and evaluates frame allocations using FIFO circular queues versus Least Recently Used (LRU) timestamp clocks.",
    event: "{\"ev\":\"page_fault\", \"page\":9, \"algo\":\"lru\"}",
    color: "#10b981",
  },
  {
    number: "06",
    title: "SUPERVISE",
    subtitle: "Watchdog & Thread Recovery",
    concept: "FAULT TOLERANCE & CHAOS INJECTION",
    c_func: "watchdog_thread() [core/watchdog.c]",
    detail: "Supervisory watchdog monitors atomic sensor heartbeats. If a thread stalls or is injected with a fault (--inject-fault), the watchdog safely joins the dead thread, spawns a new replacement pthread, and resumes telemetric flow.",
    event: "{\"ev\":\"sensor_restarted\", \"sensor\":2, \"restarts\":1}",
    color: "#f43f5e",
  },
];

export default function ProcessPath() {
  const [active, setActive] = useState(0);
  const stage = stages[active];

  return (
    <section className="my-20 space-y-8" aria-labelledby="pipeline-heading">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-hud text-xs uppercase tracking-widest text-zinc-400">
              ARCHITECTURE EXECUTION PIPELINE
            </span>
          </div>
          <h2
            id="pipeline-heading"
            className="font-display text-2xl md:text-3xl font-bold tracking-tight text-white mt-1"
          >
            From Sensor Sampling to Actuator Dispatch
          </h2>
        </div>
        <p className="text-sm text-zinc-400 max-w-md">
          Sequence of Operating System primitives executed for every environmental disturbance.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Step Buttons */}
        <div className="lg:col-span-5 space-y-2">
          {stages.map((item, index) => {
            const isCurrent = active === index;
            return (
              <button
                key={item.number}
                type="button"
                onClick={() => setActive(index)}
                className={`w-full text-left p-3.5 rounded-xl border transition-colors flex items-center justify-between group ${
                  isCurrent
                    ? "bg-[#181b24] border-white/20 text-white shadow-sm"
                    : "bg-[#10121a] border-white/[0.06] text-zinc-400 hover:bg-[#141722] hover:text-zinc-200 hover:border-white/[0.1]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`font-mono text-xs font-bold px-2 py-1 rounded transition-colors ${
                      isCurrent
                        ? "bg-white text-black"
                        : "bg-white/[0.05] text-zinc-400 group-hover:text-zinc-200"
                    }`}
                  >
                    {item.number}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-display text-sm font-semibold ${isCurrent ? "text-white" : "text-zinc-300"}`}>
                        {item.title}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-400 hidden sm:inline">
                        // {item.subtitle.split("&")[0]}
                      </span>
                    </div>
                    <span className="text-[10px] font-hud uppercase tracking-wider text-zinc-400 block mt-0.5">
                      {item.concept}
                    </span>
                  </div>
                </div>

                <span
                  className={`font-mono text-xs transition-transform ${
                    isCurrent ? "text-white translate-x-1" : "text-zinc-400 group-hover:text-zinc-400"
                  }`}
                >
                  →
                </span>
              </button>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-7">
          <SpotlightCard className="min-h-[380px] flex flex-col justify-between border-white/[0.1] bg-[#11131a]">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-hud text-xs tracking-wider text-zinc-400">
                  STAGE {stage.number} // KERNEL ARCHITECTURE
                </span>
                <span className="font-mono text-xs px-2.5 py-0.5 rounded border border-white/[0.12] bg-white/[0.04] text-zinc-300">
                  {stage.concept}
                </span>
              </div>

              <div>
                <h3 className="font-display text-2xl font-bold text-white flex items-center gap-3">
                  <span>{stage.title}</span>
                  <span className="text-sm font-mono text-zinc-400 font-normal">
                    — {stage.subtitle}
                  </span>
                </h3>
                <p className="font-mono text-xs text-zinc-400 mt-1">
                  SOURCE: {stage.c_func}
                </p>
              </div>

              <p className="text-sm leading-relaxed text-zinc-300 pt-3 border-t border-white/[0.06]">
                {stage.detail}
              </p>
            </div>

            <div className="mt-6 pt-4 border-t border-white/[0.06] space-y-2">
              <span className="font-hud text-[10px] uppercase tracking-wider text-zinc-400">
                ATOMIC JSONL PAYLOAD SPECIFICATION
              </span>
              <div className="rounded-lg bg-black/50 border border-white/[0.08] p-3 font-mono text-xs text-zinc-300 flex items-center justify-between">
                <code>{stage.event}</code>
                <span className="text-[10px] text-zinc-400 font-hud">POSIX PIPE</span>
              </div>
            </div>
          </SpotlightCard>
        </div>
      </div>
    </section>
  );
}
