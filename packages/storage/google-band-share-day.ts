import type { DatabaseSync } from 'node:sqlite';
import { parseWindowRollup, windowSeconds, type WindowRollupType } from '../adapters/google-health/window-rollup.ts';
import { warsawDay } from '../domain/warsaw-day.ts';

const scale = 1000000n;
function toScaled(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}
function format(value: bigint): string {
  const cents = (value + 5000n) / 10000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

/** Newest complete saved job of this kind whose UTC range covers the whole Warsaw day, with its parsed ten-minute windows. */
function savedWindows(db: DatabaseSync, kind: 'heart-rate-10m' | 'active-energy-10m', type: WindowRollupType, dayStart: number, dayEnd: number) {
  const jobs = db.prepare("SELECT id, range_start, range_end FROM google_read_jobs WHERE kind = ? AND state = 'complete' ORDER BY created_at DESC, id LIMIT 50").all(kind);
  const job = jobs.find((row) => Date.parse(String(row.range_start)) <= dayStart && Date.parse(String(row.range_end)) >= dayEnd);
  if (!job) return null;
  const windows: { start: number; value: string | null }[] = [];
  for (const page of db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ? ORDER BY page_number LIMIT 50').iterate(job.id)) {
    if (typeof page.raw_json !== 'string') throw new Error('invalid_page');
    for (const window of parseWindowRollup(page.raw_json, type).windows) {
      const start = Date.parse(window.start);
      if (start >= dayStart && start < dayEnd) windows.push({ start, value: window.value });
    }
  }
  return windows;
}

/**
 * Wear evidence for one Warsaw day: share of ten-minute windows with heart rate and the split of active energy by it.
 * Derived from saved original pages; heart rate shows that a wearable measured, not that it was worn for the whole window.
 */
export function readBandShareDay(db: DatabaseSync, date: string) {
  const day = warsawDay(date); const dayStart = Date.parse(day.start), dayEnd = Date.parse(day.end);
  const totalWindows = (dayEnd - dayStart) / (windowSeconds * 1000);
  const heart = savedWindows(db, 'heart-rate-10m', 'heart-rate', dayStart, dayEnd);
  const active = savedWindows(db, 'active-energy-10m', 'active-energy-burned', dayStart, dayEnd);
  const heartStarts = new Set((heart ?? []).map((window) => window.start));
  let band = 0n, other = 0n, bandWindows = 0, otherWindows = 0;
  for (const window of active ?? []) {
    if (window.value === null) continue;
    if (heart && heartStarts.has(window.start)) { band += toScaled(window.value); bandWindows++; } else { other += toScaled(window.value); otherWindows++; }
  }
  return {
    totalWindows,
    heartRate: heart ? { windows: heartStarts.size } : null,
    activeEnergy: active && heart ? { bandKcal: format(band), bandWindows, otherKcal: format(other), otherWindows } : null,
    activeEnergyRead: active !== null,
  };
}
