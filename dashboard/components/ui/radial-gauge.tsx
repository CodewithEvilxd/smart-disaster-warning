"use client";

import React from "react";

interface RadialGaugeProps {
  value: number; // 0 to 100
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
  unit?: string;
  threshold?: number;
}

// Precision instrumentation gauge inspired by physical analog meters
export function RadialGauge({
  value,
  size = 84,
  strokeWidth = 6,
  color = "#ffffff",
  label = "LVL",
  unit = "%",
  threshold = 70,
}: RadialGaugeProps) {
  const clampedValue = Math.max(0, Math.min(100, isNaN(value) ? 0 : value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcPercentage = 0.75;
  const arcCircumference = circumference * arcPercentage;
  const strokeDashoffset = arcCircumference - (clampedValue / 100) * arcCircumference;
  const isCritical = clampedValue >= threshold;

  return (
    <div className="relative inline-flex flex-col items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-[135deg]" viewBox={`0 0 ${size} ${size}`}>
        {/* Background Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcCircumference} ${circumference}`}
          strokeLinecap="round"
        />
        {/* Value Arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={isCritical ? "#ef4444" : color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${arcCircumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-300 ease-out will-change-[stroke-dashoffset]"
        />
      </svg>
      {/* Centered Digital Readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-mono text-base font-bold text-white tabular-nums tracking-tight">
          {clampedValue.toFixed(1)}
          <span className="text-[10px] text-zinc-400 font-normal ml-0.5">{unit}</span>
        </span>
        <span className="font-hud text-[8px] uppercase tracking-wider text-zinc-400 -mt-0.5">
          {label}
        </span>
      </div>
    </div>
  );
}
