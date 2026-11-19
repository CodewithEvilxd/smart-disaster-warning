import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-[#07090e] text-[#f1f5f9] flex flex-col items-center justify-center p-6 text-center font-sans">
      <div className="max-w-md space-y-6">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-950/40 text-rose-300 font-mono text-xl font-bold shadow-[0_0_20px_rgba(244,63,94,0.3)]">
            404
          </div>
        </div>

        <div className="space-y-2">
          <span className="font-hud text-xs uppercase tracking-widest text-rose-400">
            SYSTEM ROUTE FAULT // UNMAPPED ADDRESS
          </span>
          <h1 className="font-display text-3xl font-bold text-white">
            Telemetry Vector Not Found
          </h1>
          <p className="text-sm text-slate-400">
            The requested operations route does not exist in the Sentinel system map.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <Link
            href="/"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.12] text-white text-xs font-semibold transition-all"
          >
            ← System Overview
          </Link>
          <Link
            href="/dashboard"
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-sans font-bold text-xs uppercase transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)]"
          >
            Live Mission Control ↗
          </Link>
        </div>
      </div>
    </main>
  );
}
