export type DefaultSensor = {
  id: number;
  type: string;
  status: "up" | "down";
  reading: number;
  restarts: number;
  threshold: number;
  unit: string;
};

export const DEFAULT_SENSORS: DefaultSensor[] = [
  { id: 0, type: "earthquake", status: "up", reading: 61.4, restarts: 0, threshold: 65.0, unit: "MAG" },
  { id: 1, type: "flood", status: "up", reading: 48.7, restarts: 0, threshold: 70.0, unit: "LVL" },
  { id: 2, type: "cyclone", status: "up", reading: 52.3, restarts: 1, threshold: 75.0, unit: "hPa" },
  { id: 3, type: "fire", status: "up", reading: 41.9, restarts: 0, threshold: 68.0, unit: "°C" },
];

export const INITIAL_READINGS = [
  { t: 100, sensor: 0, value: 58.2 },
  { t: 100, sensor: 1, value: 42.1 },
  { t: 100, sensor: 2, value: 51.0 },
  { t: 100, sensor: 3, value: 39.5 },
  { t: 600, sensor: 0, value: 61.4 },
  { t: 600, sensor: 1, value: 48.7 },
  { t: 600, sensor: 2, value: 52.3 },
  { t: 600, sensor: 3, value: 41.9 },
];

export const SAMPLE_ALERTS = [
  { id: "101", sensor: 0, type: "earthquake", severity: 4, burstMs: 520, status: "queued", t: 1200 },
  { id: "102", sensor: 3, type: "fire", severity: 5, burstMs: 680, status: "queued", t: 1240 },
  { id: "103", sensor: 1, type: "flood", severity: 3, burstMs: 340, status: "queued", t: 1310 },
];
