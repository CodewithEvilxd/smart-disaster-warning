"use client";

import React from "react";

interface MemoryMatrixProps {
  frames?: (number | null)[];
  lastVictim?: number | null;
  victim?: number | null;
  lastFault?: boolean;
  algo?: string;
  pageAlgo?: string;
  accesses?: number;
  hitRatio?: number;
}

export function MemoryMatrix({
  frames = [0, 1, 2, 3, 4, 5, 6, 7],
  lastVictim = null,
  victim = null,
  algo,
  pageAlgo = "FIFO",
  accesses,
  hitRatio,
}: MemoryMatrixProps) {
  const displayFrames = frames.slice(0, 8);
  while (displayFrames.length < 8) {
    displayFrames.push(null);
  }
  const effectiveVictim = victim ?? lastVictim;
  const effectiveAlgo = (algo || pageAlgo).toUpperCase();

  return (
    <div className="space-y-4 font-mono">
      {/* Stats Summary */}
      {(accesses !== undefined || hitRatio !== undefined) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-slate-800/80 bg-[#0a0d14] p-2.5">
            <span className="font-hud text-[9px] uppercase text-slate-500 block">ACCESSES</span>
            <span className="text-base font-bold text-white">{accesses ?? 0}</span>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-[#0a0d14] p-2.5">
            <span className="font-hud text-[9px] uppercase text-slate-500 block">HIT RATIO</span>
            <span className="text-base font-bold text-emerald-400">
              {hitRatio !== undefined ? `${(hitRatio * 100).toFixed(1)}%` : "--"}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs">
        <span className="font-hud uppercase tracking-wider text-slate-500 text-[10px]">
          PHYSICAL FRAME SLOTS [8 SLOTS]
        </span>
        <span className="text-[10px] text-slate-300 bg-slate-800 border border-slate-700/80 px-2 py-0.5 rounded font-hud uppercase">
          {effectiveAlgo}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {displayFrames.map((page, idx) => {
          const isOccupied = page !== null && page !== undefined;
          const isVictim = effectiveVictim !== null && effectiveVictim === page;

          return (
            <div
              key={idx}
              className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${
                isVictim
                  ? "bg-red-950/40 border-red-500/60 shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                  : isOccupied
                  ? "bg-[#0a0d14] border-slate-800/80 hover:border-slate-700"
                  : "bg-black/20 border-dashed border-slate-800/60"
              }`}
            >
              <span className="font-hud text-[8px] uppercase tracking-wider text-slate-500">
                F0{idx}
              </span>
              <span
                className={`text-xs font-bold my-0.5 ${
                  isVictim
                    ? "text-red-400"
                    : isOccupied
                    ? "text-white"
                    : "text-slate-600"
                }`}
              >
                {isOccupied ? `PAGE ${page}` : "EMPTY"}
              </span>
              <span
                className={`text-[8px] uppercase px-1 rounded ${
                  isVictim
                    ? "bg-red-900/50 text-red-300 font-bold"
                    : isOccupied
                    ? "bg-slate-800 text-slate-400"
                    : "text-slate-600"
                }`}
              >
                {isVictim ? "VICTIM" : isOccupied ? "LOADED" : "FREE"}
              </span>
            </div>
          );
        })}
      </div>

      <p className="font-hud text-[10px] text-slate-500 leading-tight">
        Models 80/20 Locality of Reference on circular history buffers.
      </p>
    </div>
  );
}
