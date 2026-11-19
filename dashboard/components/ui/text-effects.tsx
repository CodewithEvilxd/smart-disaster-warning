import React from "react";

export function SplitHeadline() {
  return (
    <div className="space-y-2 my-4">
      <h1 className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.08]">
        Disaster Warning <br />
        <span className="font-serif italic font-normal text-slate-300">
          Operating System
        </span>
      </h1>
    </div>
  );
}

export function TextEffect({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-base sm:text-lg text-slate-400 leading-relaxed max-w-xl font-normal font-sans">
      {children}
    </p>
  );
}

export function LiveNumber({ value }: { value: number }) {
  return (
    <span className="inline-block tabular-nums font-mono font-semibold tracking-tight">
      {value.toLocaleString()}
    </span>
  );
}
