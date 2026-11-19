"use client";

import React, { useRef } from "react";

interface SpotlightCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  spotlightColor?: string;
}

// Zero-render hardware-accelerated cursor spotlight (Pure CSS custom property tracking)
export function SpotlightCard({
  children,
  className = "",
  spotlightColor = "rgba(56, 189, 248, 0.08)",
  ...props
}: SpotlightCardProps) {
  const divRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!divRef.current) return;
    const rect = divRef.current.getBoundingClientRect();
    divRef.current.style.setProperty("--spotlight-x", `${e.clientX - rect.left}px`);
    divRef.current.style.setProperty("--spotlight-y", `${e.clientY - rect.top}px`);
    divRef.current.style.setProperty("--spotlight-opacity", "1");
  };

  const handleMouseLeave = () => {
    if (!divRef.current) return;
    divRef.current.style.setProperty("--spotlight-opacity", "0");
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`group relative overflow-hidden rounded-xl border border-slate-800/80 bg-[#0d1017] p-6 transition-all duration-200 hover:border-slate-700/80 hover:shadow-[0_0_24px_rgba(0,0,0,0.4)] ${className}`}
      {...props}
    >
      {/* Specular Edge Highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Hardware Accelerated Spotlight Layer */}
      <div
        className="pointer-events-none absolute -inset-px opacity-0 transition-opacity duration-300"
        style={{
          opacity: "var(--spotlight-opacity, 0)",
          background: `radial-gradient(380px circle at var(--spotlight-x, -999px) var(--spotlight-y, -999px), ${spotlightColor}, transparent 80%)`,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
