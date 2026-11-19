"use client";

import Link from "next/link";
import { useState } from "react";
import ProcessPath from "@/components/process-path";
import ScrollProgress from "@/components/ui/scroll-progress";
import { SplitHeadline, TextEffect } from "@/components/ui/text-effects";
import WelcomePreview from "@/components/welcome-preview";
import TaglineReveal from "@/components/tagline-reveal";
import { SpotlightCard } from "@/components/ui/spotlight-card";

const teamMembers = [
  { name: "Nishant Gaurav", roll: "2501331540190", role: "Project Lead & OS Architecture", files: "main.c, event_log.c, integration", focus: "Process lifecycle, atomic pipe IPC, lock ordering & signal handling." },
  { name: "Rudra Pratap Nagar", roll: "2501331540225", role: "Process Scheduling & Alerts", files: "scheduler.c, queue.c", focus: "Binary max-heap, Priority with aging, Round Robin & SJF." },
  { name: "Priyanshu Raj", roll: "2501331540206", role: "Sensor & Real-Time Data", files: "sensor.c, memory.c", focus: "Sensor pthreads, circular history buffers & virtual memory paging." },
  { name: "Om Patel", roll: "2501331540193", role: "Synchronization & Watchdog", files: "watchdog.c, mutex/semaphores", focus: "Producer-consumer semaphores, heartbeat watchdog & chaos injection." },
  { name: "Neeraj Kumar", roll: "2501331540183", role: "UI Dashboard & Middleware", files: "bridge/server.js, dashboard", focus: "WebSocket JSONL streaming bridge, telemetry gauges & Next.js UI." },
];

const osMatrix = [
  { concept: "Multithreading", tech: "POSIX Threads (pthreads)", file: "core/sensor.c, core/scheduler.c", desc: "Concurrent worker threads for 4 sensors, scheduler, logger, memory stats, and watchdog running simultaneously with zero blocking." },
  { concept: "Mutual Exclusion", tech: "pthread_mutex_t", file: "core/queue.c, core/memory.c", desc: "Guards the binary max-heap queue and physical page frames against race conditions and state corruption." },
  { concept: "Counting Semaphores", tech: "sem_t empty_slots, full_slots", file: "core/queue.c, core/main.c", desc: "Coordinates bounded-buffer producer-consumer synchronization without busy waiting or CPU polling." },
  { concept: "CPU Scheduling", tech: "Priority + Aging, RR, SJF", file: "core/scheduler.c", desc: "Preemptive and non-preemptive algorithms with starvation prevention via periodic age boosts every 1000ms." },
  { concept: "Virtual Memory Paging", tech: "FIFO & LRU Page Replacement", file: "core/memory.c", desc: "Simulates physical page frames, locality of reference (80/20 rule), and deterministic offline trace comparisons." },
  { concept: "Inter-Process Comm.", tech: "POSIX Unidirectional Pipes", file: "core/event_log.c, core/logger.c", desc: "Atomic pipe writes strictly bounded by PIPE_BUF (4096B) prevent interleaving between concurrent threads." },
  { concept: "Fault Tolerance", tech: "Watchdog Heartbeat Timer", file: "core/watchdog.c", desc: "Supervisory thread detects dead or injected sensor failures, joins dead pthreads, and spawns replacements." },
  { concept: "Signal Handling", tech: "sigaction (SIGINT)", file: "core/main.c", desc: "Clean, leak-free termination with pthread_join, mutex destruction, and POSIX semaphore reclamation." },
];

export default function WelcomePage() {
  const [copiedCli, setCopiedCli] = useState(false);

  const handleCopyCli = () => {
    navigator.clipboard.writeText("make -C core && ./core/disaster_warning");
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  return (
    <main className="min-h-screen bg-[#07090e] text-[#f1f5f9]" id="top">
      <ScrollProgress />
      <a className="skip-link sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-white focus:text-black focus:px-4 focus:py-2 focus:rounded" href="#main-content">
        Skip to content
      </a>

      {/* Floating Clean Header */}
      <header className="sticky top-4 z-40 max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-[#0d1017]/90 backdrop-blur-md px-5 py-3 shadow-lg">
          <Link href="/" className="flex items-center gap-3" aria-label="Sentinel home">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black font-mono text-xs font-bold tracking-tight">
              OS
            </div>
            <div>
              <span className="font-display text-sm font-bold tracking-wider text-white block">
                SENTINEL
              </span>
              <span className="font-hud text-[8px] uppercase tracking-widest text-slate-400 block -mt-0.5">
                DISASTER WARNING SYSTEM
              </span>
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-5 font-hud text-xs text-slate-400">
            <span>COURSE: CCSE0353A</span>
            <span className="text-slate-700">/</span>
            <span>NIET GREATER NOIDA</span>
            <span className="text-slate-700">/</span>
            <span className="text-slate-300">SEC C • TEAM 01</span>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-lg bg-white hover:bg-slate-200 text-black font-sans font-semibold text-xs px-3.5 py-2 transition-colors shadow-sm"
            >
              <span>Live Console</span>
              <span className="font-mono text-xs">→</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 md:pt-16" id="main-content">
        {/* Kicker */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4 mb-8">
          <div className="font-hud text-xs uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
            OPERATING SYSTEMS LABORATORY // GROUP 01 RESEARCH
          </div>
          <div className="font-mono text-xs text-slate-400">
            POSIX PTHREADS · SEMAPHORES · C11 ARCHITECTURE
          </div>
        </div>

        {/* Hero Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-end pb-12 border-b border-slate-800/80">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded border border-slate-700/80 bg-slate-900/60 font-hud text-xs text-slate-300">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                <span>SIMULATED MULTI-HAZARD MISSION CONTROL</span>
              </div>
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded border border-amber-500/30 bg-amber-950/30 font-hud text-xs text-amber-300">
                <span>🌐 SDG 11: SUSTAINABLE CITIES &amp; COMMUNITIES</span>
              </div>
            </div>
            <SplitHeadline />
            <TextEffect>
              A research simulation modeling core Operating System concepts: multithreaded sensor sampling, max-heap severity queues, CPU scheduling with aging, virtual memory page replacement, and autonomous watchdog supervision.
            </TextEffect>

            {/* Spec Pills */}
            <div className="flex flex-wrap gap-2 pt-2 font-mono text-xs text-slate-400">
              <span className="px-2.5 py-1 rounded border border-slate-800/80 bg-[#0a0d14]">
                4 Sensor Threads
              </span>
              <span className="px-2.5 py-1 rounded border border-slate-800/80 bg-[#0a0d14]">
                Priority Max-Heap
              </span>
              <span className="px-2.5 py-1 rounded border border-slate-800/80 bg-[#0a0d14]">
                FIFO / LRU Paging
              </span>
              <span className="px-2.5 py-1 rounded border border-slate-800/80 bg-[#0a0d14]">
                Watchdog Heartbeat
              </span>
            </div>
          </div>

          {/* Right Side: Architecture Runner Box */}
          <div className="lg:col-span-5 space-y-3">
            <SpotlightCard className="p-5 border-slate-800/80 bg-[#0d1017] space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-hud text-xs text-slate-400 uppercase tracking-wider">CLI COMPILE &amp; RUNNER</span>
                <span className="font-mono text-[10px] text-slate-300 bg-white/[0.06] border border-white/[0.1] px-2 py-0.5 rounded">
                  GCC -PTHREAD
                </span>
              </div>

              <div className="rounded-xl bg-black/60 border border-slate-800/80 p-3.5 font-mono text-xs text-slate-300 space-y-1">
                <div className="text-slate-500 text-[10px]"># Linux / WSL Build Command</div>
                <div className="text-white flex items-center justify-between">
                  <code>make -C core &amp;&amp; ./core/disaster_warning</code>
                  <button
                    onClick={handleCopyCli}
                    className="text-[10px] font-sans px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                  >
                    {copiedCli ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-400">
                <div className="p-2.5 rounded-lg bg-[#0a0d14] border border-slate-800/80">
                  <span className="text-[10px] block font-hud text-slate-500 tracking-wider">IPC PROTOCOL</span>
                  <span className="text-white font-medium">Atomic JSONL</span>
                </div>
                <div className="p-2.5 rounded-lg bg-[#0a0d14] border border-slate-800/80">
                  <span className="text-[10px] block font-hud text-slate-500 tracking-wider">SCHEDULERS</span>
                  <span className="text-white font-medium">Priority, RR, SJF</span>
                </div>
              </div>

              <Link
                href="/dashboard"
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-white hover:bg-slate-200 text-black font-sans text-xs font-semibold py-2.5 transition-colors shadow-sm"
              >
                <span>Launch Mission Control Console</span>
                <span>→</span>
              </Link>
            </SpotlightCard>
          </div>
        </div>

        {/* Hazards Line */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 py-6 border-b border-slate-800/80">
          <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#0d1017] flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
              <span className="text-white font-semibold uppercase tracking-wider font-display">Earthquake</span>
            </div>
            <span className="text-slate-400 font-hud text-[11px]">&gt;= 65.0%</span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#0d1017] flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
              <span className="text-white font-semibold uppercase tracking-wider font-display">Flood</span>
            </div>
            <span className="text-slate-400 font-hud text-[11px]">&gt;= 70.0%</span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#0d1017] flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
              <span className="text-white font-semibold uppercase tracking-wider font-display">Cyclone</span>
            </div>
            <span className="text-slate-400 font-hud text-[11px]">&gt;= 75.0%</span>
          </div>

          <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#0d1017] flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2.5">
              <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]" />
              <span className="text-white font-semibold uppercase tracking-wider font-display">Wildfire</span>
            </div>
            <span className="text-slate-400 font-hud text-[11px]">&gt;= 68.0%</span>
          </div>
        </div>

        {/* Live Instrument Preview */}
        <section className="py-14 space-y-4" aria-labelledby="live-preview-title">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <span className="font-hud text-xs uppercase tracking-widest text-slate-500">
                ACTIVE TELEMETRY STREAM
              </span>
              <h2 id="live-preview-title" className="font-display text-2xl font-bold text-white">
                Live Sensor Telemetry
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400">
              WEBSOCKET: WS://LOCALHOST:8080
            </span>
          </div>
          <WelcomePreview />
        </section>

        {/* Editorial Thesis Statement */}
        <TaglineReveal />

        {/* Process Architecture Pipeline */}
        <ProcessPath />

        {/* OS Concepts Mapping Matrix */}
        <section className="my-20 space-y-6" aria-labelledby="matrix-title">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div>
              <span className="font-hud text-xs uppercase tracking-widest text-slate-500">
                CURRICULUM MAPPING // CCSE0353A
              </span>
              <h2 id="matrix-title" className="font-display text-2xl font-bold text-white">
                Operating System Concepts Implementation
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400">
              8 CORE LAB COMPETENCIES
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {osMatrix.map((item, index) => (
              <SpotlightCard
                key={index}
                className="p-5 border-slate-800/80 bg-[#0d1017] flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-hud text-slate-500 uppercase tracking-wider">
                      MODULE 0{index + 1}
                    </span>
                    <span className="font-mono text-[10px] text-slate-300 bg-white/[0.04] px-1.5 py-0.5 rounded border border-slate-800">
                      {item.tech.split(" ")[0]}
                    </span>
                  </div>
                  <h3 className="font-display text-base font-bold text-white">
                    {item.concept}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/80 font-mono text-[11px] text-slate-500 truncate">
                  → {item.file}
                </div>
              </SpotlightCard>
            ))}
          </div>
        </section>

        {/* Engineering Team Section */}
        <section className="my-20 space-y-6" aria-labelledby="team-title">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div>
              <span className="font-hud text-xs uppercase tracking-widest text-slate-500">
                RESEARCH SQUAD // NIET GREATER NOIDA
              </span>
              <h2 id="team-title" className="font-display text-2xl font-bold text-white">
                Engineering Team &amp; Roles
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400">
              FACULTY GUIDE: MS. AMITA PATHANIA
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {teamMembers.map((member, idx) => (
              <SpotlightCard
                key={idx}
                className="p-5 border-slate-800/80 bg-[#0d1017] space-y-3"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-hud text-slate-500 uppercase">ROLL NO.</span>
                  <span className="font-mono text-slate-300 font-bold">{member.roll}</span>
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-white">
                    {member.name}
                  </h3>
                  <span className="font-hud text-xs text-slate-400 font-semibold uppercase block mt-0.5">
                    {member.role}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {member.focus}
                </p>
                <div className="pt-2 border-t border-slate-800/80 font-mono text-[11px] text-slate-500">
                  <span className="text-slate-500 block font-hud text-[9px] uppercase">FILES OWNED:</span>
                  <span className="text-slate-300">{member.files}</span>
                </div>
              </SpotlightCard>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-20 py-8 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span className="font-display font-bold text-white text-sm">SENTINEL</span>
            <span>//</span>
            <span>DEPARTMENT OF COMPUTER SCIENCE &amp; ENGINEERING</span>
          </div>
          <div>
            B.TECH DATA SCIENCE (CCSE0353A) • 2026
          </div>
        </footer>
      </div>
    </main>
  );
}
