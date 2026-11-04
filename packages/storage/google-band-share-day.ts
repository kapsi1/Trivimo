import type { DatabaseSync } from 'node:sqlite';
import { parseWindowRollup, windowSeconds, type WindowRollupType } from '../adapters/google-health/window-rollup.ts';
import { warsawDay } from '../domain/warsaw-day.ts';
import type { WindowJobKind } from './google-pages.ts';

const scale = 1000000n;
function toScaled(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}
function format(value: bigint): string {
  const cents = (value + 5000n) / 10000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export interface Day { date: string; start: number; end: number }
export type Window = { start: number; value: string | null };

function dates(from: string, to: string): Day[] {
  const days: Day[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86400000) {
    const date = new Date(at).toISOString().slice(0, 10); const bounds = warsawDay(date);
    days.push({ date, start: Date.parse(bounds.start), end: Date.parse(bounds.end) });
  }
  return days;
}

/**
 * For each Warsaw day the windows of the newest complete saved job whose UTC range covers the whole day.
 * A day covered by a job with no windows maps to an empty list (read, nothing there); an unread day is absent.
 */
export function savedWindows(db: DatabaseSync, kind: WindowJobKind, type: WindowRollupType, days: Day[]): Map<string, Window[]> {
  return savedWindowsWith(db, kind, days, (raw) => parseWindowRollup(raw, type).windows.map((window) => ({ start: Date.parse(window.start), value: window.value })));
}

/** Same day claiming as `savedWindows`, with a caller-supplied page parser (e.g. heart-rate values for presentation). */
export function savedWindowsWith<T extends { start: number }>(db: DatabaseSync, kind: WindowJobKind, days: Day[], parse: (rawJson: string) => T[]): Map<string, T[]> {
  const claimed = new Map<string, T[]>();
  const pages = db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ? ORDER BY page_number LIMIT 50');
  for (const job of db.prepare("SELECT id, range_start, range_end FROM google_read_jobs WHERE kind = ? AND state = 'complete' ORDER BY created_at DESC, id LIMIT 500").all(kind)) {
    const from = Date.parse(String(job.range_start)), to = Date.parse(String(job.range_end));
    const needed = days.filter((day) => !claimed.has(day.date) && from <= day.start && to >= day.end);
    if (needed.length === 0) continue;
    const windows: T[] = [];
    for (const page of pages.iterate(job.id)) {
      if (typeof page.raw_json !== 'string') throw new Error('invalid_page');
      windows.push(...parse(page.raw_json));
    }
    for (const day of needed) claimed.set(day.date, windows.filter((window) => window.start >= day.start && window.start < day.end));
  }
  return claimed;
}

export function warsawDays(from: string, to: string): Day[] { return dates(from, to); }

/**
 * Wear evidence per Warsaw day: share of ten-minute windows with heart rate and the split of active energy by it.
 * Derived from saved original pages; heart rate shows that a wearable measured, not that it was worn for the whole window.
 * Heart rate absent for a day means "not read", never zero windows; the split needs both reads.
 */
export function readBandShareRange(db: DatabaseSync, from: string, to: string) {
  const days = dates(from, to);
  if (days.length > 366) throw new Error('range_too_large');
  const heart = savedWindows(db, 'heart-rate-10m', 'heart-rate', days);
  const active = savedWindows(db, 'active-energy-10m', 'active-energy-burned', days);
  return days.map((day) => {
    const heartWindows = heart.get(day.date) ?? null; const activeWindows = active.get(day.date) ?? null;
    const heartStarts = new Set((heartWindows ?? []).map((window) => window.start));
    let band = 0n, other = 0n, bandWindows = 0, otherWindows = 0;
    for (const window of activeWindows ?? []) {
      if (window.value === null) continue;
      if (heartWindows && heartStarts.has(window.start)) { band += toScaled(window.value); bandWindows++; } else { other += toScaled(window.value); otherWindows++; }
    }
    return {
      date: day.date,
      totalWindows: (day.end - day.start) / (windowSeconds * 1000),
      heartRate: heartWindows ? { windows: heartStarts.size } : null,
      activeEnergy: activeWindows && heartWindows ? { bandKcal: format(band), bandWindows, otherKcal: format(other), otherWindows } : null,
      activeEnergyRead: activeWindows !== null,
    };
  });
}

export function readBandShareDay(db: DatabaseSync, date: string) {
  const { date: _date, ...day } = readBandShareRange(db, date, date)[0]!;
  return day;
}
