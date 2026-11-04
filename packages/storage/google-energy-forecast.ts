import type { DatabaseSync } from 'node:sqlite';
import { forecastRestingEnergy } from '../domain/energy-forecast.ts';
import { sourceDay } from '../domain/source-day.ts';
import { savedWindows, warsawDays } from './google-band-share-day.ts';

/** Forecast of today's burned calories from saved ten-minute windows; null for any other day or when inputs are missing. */
export function readEnergyForecast(db: DatabaseSync, date: string, nowMs: number) {
  if (sourceDay(new Date(nowMs).toISOString()) !== date) return null;
  const days = warsawDays(date, date); const day = days[0]!;
  const total = savedWindows(db, 'total-calories-10m', 'total-calories', days).get(date) ?? null;
  const steps = savedWindows(db, 'steps-10m', 'steps', days).get(date) ?? null;
  const active = savedWindows(db, 'active-energy-10m', 'active-energy-burned', days).get(date) ?? null;
  return forecastRestingEnergy({ dayStart: day.start, dayEnd: day.end, total, steps, active });
}
