"use client";

import { useEffect, useRef } from "react";

const statement = "Preemptive priority scheduling, deterministic FIFO and LRU virtual memory paging, bounded IPC pipes, and autonomous watchdog fault recovery.";

export default function TaglineReveal() {
  const container = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const words = element.querySelectorAll<HTMLElement>("[data-word]");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("text-white");
            entry.target.classList.remove("text-zinc-600");
          }
        }
      },
      { rootMargin: "0px 0px -15% 0px", threshold: 0.5 }
    );
    words.forEach((word) => observer.observe(word));
    return () => observer.disconnect();
  }, []);

  const wordList = statement.split(" ");

  return (
    <div className="my-24 py-16 border-y border-white/[0.07] relative">
      <div className="max-w-4xl mx-auto space-y-6 px-4">
        <div className="flex items-center gap-3">
          <span className="font-hud text-xs uppercase tracking-widest text-zinc-400">
            SYSTEM THESIS // CCSE0353A
          </span>
          <span className="h-px flex-1 bg-white/[0.08]" />
        </div>

        <p
          ref={container}
          className="font-serif italic text-2xl sm:text-3xl md:text-4xl text-zinc-600 leading-snug flex flex-wrap gap-x-2.5 gap-y-1.5"
        >
          {wordList.map((word, index) => (
            <span
              key={`${word}-${index}`}
              data-word
              className="transition-colors duration-500 ease-out inline-block"
            >
              {word}
            </span>
          ))}
        </p>

        <div className="flex flex-wrap items-center gap-6 font-mono text-xs text-zinc-400 pt-2">
          <span>• POSIX PTHREADS</span>
          <span>• BOUNDED MAX-HEAP</span>
          <span>• COUNTING SEMAPHORES</span>
          <span>• WATCHDOG RESTART</span>
        </div>
      </div>
    </div>
  );
}
