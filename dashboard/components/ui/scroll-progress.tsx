"use client";

import { useEffect, useRef } from "react";

// Animate UI Scroll Progress pattern, implemented with the browser scroll API.
export default function ScrollProgress() {
  const bar = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const range = document.documentElement.scrollHeight - window.innerHeight;
        const progress = range > 0 ? window.scrollY / range : 0;
        bar.current?.style.setProperty("transform", `scaleX(${Math.max(0, Math.min(1, progress))})`);
      });
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return <div className="page-progress" aria-hidden="true"><span ref={bar} /></div>;
}
