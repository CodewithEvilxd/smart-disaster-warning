import type { Metadata } from "next";
import { Instrument_Serif, Plus_Jakarta_Sans, Space_Grotesk, Space_Mono, Geist_Mono } from "next/font/google";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-hud",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sentinel — Disaster Warning Operating System",
  description: "Real-time Operating System simulation: POSIX threads, preemptive priority scheduling, virtual memory paging, and watchdog fault recovery.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${plusJakartaSans.variable} ${spaceGrotesk.variable} ${geistMono.variable} ${instrumentSerif.variable} ${spaceMono.variable} font-sans antialiased bg-[#07090e] text-[#f1f5f9] min-h-screen selection:bg-sky-500/20 selection:text-white`}
      >
        {children}
      </body>
    </html>
  );
}
