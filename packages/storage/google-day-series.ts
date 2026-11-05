import type { DatabaseSync } from 'node:sqlite';
import { windowSeconds } from '../adapters/google-health/window-rollup.ts';
import { warsawDay } from '../domain/warsaw-day.ts';
import { savedWindows } from './google-band-share-day.ts';

export const seriesMetrics = {
  steps: { kind: 'steps-10m', type: 'steps', unit: 'steps' },
  distance: { kind: 'distance-10m', type: 'distance', unit: 'mm' },
  'total-calories': { kind: 'total-calories-10m', type: 'total-calories', unit: 'kcal' },
  'active-energy-burned': { kind: 'active-energy-10m', type: 'active-energy-burned', unit: 'kcal' },
} as const;
export type SeriesMetric = keyof typeof seriesMetrics;

const scale = 1000000n;
function toScaled(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}
function format(value: bigint): string {
  const fraction = (value % scale).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${value / scale}.${fraction}` : `${value / scale}`;
}

/**
 * Hourly series of one Warsaw day from the saved ten-minute windows (exact sums of the source text).
 * An hour without any window has no value: absence of a reading is not zero. Null when the day was not read completely.
 */
export function readDaySeries(db: DatabaseSync, metric: SeriesMetric, date: string) {
  const day = warsawDay(date); const start = Date.parse(day.start), end = Date.parse(day.end);
  const definition = seriesMetrics[metric];
  const windows = savedWindows(db, definition.kind, definition.type, [{ date, start, end }]).get(date);
  if (!windows) return null;
  const hours = Math.round((end - start) / 3600000);
  const sums: (bigint | null)[] = Array.from({ length: hours }, () => null);
  // the same windows one by one (10 minutes each), index = window number from the day's start; no window or no value is null, never zero
  const slots: (string | null)[] = Array.from({ length: hours * 3600 / windowSeconds }, () => null);
  for (const window of windows) {
    if (window.value === null) continue;
    const index = Math.floor((window.start - start) / 3600000);
    sums[index] = (sums[index] ?? 0n) + toScaled(window.value);
    const slot = Math.floor((window.start - start) / (windowSeconds * 1000));
    if (slot >= 0 && slot < slots.length) slots[slot] = format((slots[slot] === null ? 0n : toScaled(slots[slot]!)) + toScaled(window.value));
  }
  const total = sums.reduce<bigint>((sum, value) => sum + (value ?? 0n), 0n);
  return {
    unit: definition.unit, windowsPerDay: (end - start) / (windowSeconds * 1000), windows: windows.length,
    hours: sums.map((value, index) => ({ start: new Date(start + index * 3600000).toISOString(), value: value === null ? null : format(value) })),
    slots,
    total: format(total),
  };
}
