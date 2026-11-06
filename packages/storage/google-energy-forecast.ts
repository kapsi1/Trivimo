import type { DatabaseSync } from 'node:sqlite';
import { forecastEnergy } from '../domain/energy-forecast.ts';
import { sourceDay } from '../domain/source-day.ts';
import { savedWindows, warsawDays } from './google-band-share-day.ts';

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Days before today looked at for the profile; only complete ones count, the newest 14 of them. */
const historySpanDays = 21;

/**
 * Forecast of today's burned calories from saved ten-minute windows: the rest of the day at the everyday pace of recent
 * days (no significant exercise), with v0 as its floor and as the fallback. Null for any other day or when inputs are missing.
 */
export function readEnergyForecast(db: DatabaseSync, date: string, nowMs: number) {
  if (sourceDay(new Date(nowMs).toISOString()) !== date) return null;
  const days = warsawDays(date, date); const day = days[0]!;
  const total = savedWindows(db, 'total-calories-10m', 'total-calories', days).get(date) ?? null;
  const steps = savedWindows(db, 'steps-10m', 'steps', days).get(date) ?? null;
  const active = savedWindows(db, 'active-energy-10m', 'active-energy-burned', days).get(date) ?? null;
  const past = warsawDays(addDays(date, -historySpanDays), addDays(date, -1)), saved = savedWindows(db, 'total-calories-10m', 'total-calories', past), savedActive = savedWindows(db, 'active-energy-10m', 'active-energy-burned', past);
  const history = past.flatMap((item) => { const windows = saved.get(item.date); return windows ? [{ windows, dayWindows: (item.end - item.start) / 600000, active: savedActive.get(item.date) ?? null }] : []; });
  return forecastEnergy({ dayStart: day.start, dayEnd: day.end, total, steps, active, history });
}
