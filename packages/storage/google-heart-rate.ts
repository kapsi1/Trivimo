import type { DatabaseSync } from 'node:sqlite';
import { parseHeartRateWindows, windowSeconds } from '../adapters/google-health/window-rollup.ts';
import { savedWindowsWith, warsawDays, type Day } from './google-band-share-day.ts';

type Saved = { start: number; avg: number; min: number; max: number };
const parse = (raw: string): Saved[] => parseHeartRateWindows(raw).map((window) => ({ ...window, start: Date.parse(window.start) }));
const read = (db: DatabaseSync, days: Day[]) => savedWindowsWith(db, 'heart-rate-10m', days, parse);

/**
 * Heart-rate windows of one Warsaw day for presentation: mean, min and max of each ten-minute window with a measurement.
 * Windows without a measurement are absent (a gap, the wearable did not measure). Null when the day was not read completely.
 */
export function readHeartRateDay(db: DatabaseSync, date: string) {
  const [day] = warsawDays(date, date);
  const windows = read(db, [day!]).get(date);
  if (!windows) return null;
  return {
    dayWindows: (day!.end - day!.start) / (windowSeconds * 1000),
    windows: windows.map((window) => ({ start: new Date(window.start).toISOString(), avg: window.avg, min: window.min, max: window.max })),
  };
}

/**
 * Per Warsaw day: min and max over the windows and the mean of window means (not weighted by samples, which the producer
 * does not give). A presentation aggregate, not resting heart rate. `read: false` means not read, never "no heart rate".
 */
export function readHeartRateRange(db: DatabaseSync, from: string, to: string) {
  const days = warsawDays(from, to);
  if (days.length > 366) throw new Error('range_too_large');
  const saved = read(db, days);
  return days.map((day) => {
    const windows = saved.get(day.date);
    if (!windows) return { date: day.date, read: false as const, windows: 0, avg: null, min: null, max: null };
    if (windows.length === 0) return { date: day.date, read: true as const, windows: 0, avg: null, min: null, max: null };
    return {
      date: day.date, read: true as const, windows: windows.length,
      avg: windows.reduce((sum, window) => sum + window.avg, 0) / windows.length,
      min: Math.min(...windows.map((window) => window.min)), max: Math.max(...windows.map((window) => window.max)),
    };
  });
}
