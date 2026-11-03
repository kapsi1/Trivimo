import type { DatabaseSync } from 'node:sqlite';
import { parseDailyRollup, type DailyRollupType } from '../adapters/google-health/daily-rollup.ts';
import type { DaySnapshotInput } from '../contracts/day-snapshot.ts';
import { classifyEnergyModel, type EnergyEvidence } from '../domain/energy-qualification.ts';
import { projectEnergyDay } from '../domain/project-day.ts';
import { warsawDay } from '../domain/warsaw-day.ts';
import { readBandShareRange, savedWindows, type Day } from './google-band-share-day.ts';
import { publishCanonicalDay, readCanonicalDay } from './canonical-days.ts';

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Newest complete read of a daily kind for each date of [from, to]: its value (null when read with no point) and when it was read. */
function savedDailyValues(db: DatabaseSync, kind: DailyRollupType, from: string, to: string): Map<string, { value: string | null; readAt: number }> {
  const claimed = new Map<string, { value: string | null; readAt: number }>();
  const pages = db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ? ORDER BY page_number LIMIT 50');
  for (const job of db.prepare("SELECT id, range_start, range_end, created_at FROM google_read_jobs WHERE kind = ? AND state = 'complete' AND range_start <= ? AND range_end > ? ORDER BY created_at DESC, id").iterate(kind, to, from)) {
    const first = String(job.range_start) < from ? from : String(job.range_start);
    const needed: string[] = [];
    for (let day = first; day < String(job.range_end) && day <= to; day = addDays(day, 1)) if (!claimed.has(day)) needed.push(day);
    if (needed.length === 0) continue;
    const values = new Map<string, string>();
    for (const page of pages.iterate(job.id)) {
      if (typeof page.raw_json !== 'string') throw new Error('invalid_page');
      for (const day of parseDailyRollup(page.raw_json, kind).days) values.set(day.date, day.value);
    }
    for (const day of needed) claimed.set(day, { value: values.get(day) ?? null, readAt: Date.parse(String(job.created_at)) });
  }
  return claimed;
}

/**
 * Calorie snapshots (rule google-energy-v1) for the read days of [from, to] from saved Google pages. Values are the
 * producer's daily sums; the band share marks whose estimate it is. A day never read gets no snapshot.
 */
export function projectGoogleEnergyDays(db: DatabaseSync, from: string, to: string, nowMs: number): DaySnapshotInput[] {
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) throw new Error('range_too_large');
  const days: Day[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) { const bounds = warsawDay(date); days.push({ date, start: Date.parse(bounds.start), end: Date.parse(bounds.end) }); }
  const total = savedDailyValues(db, 'total-calories', from, to);
  const active = savedDailyValues(db, 'active-energy-burned', from, to);
  const windows = savedWindows(db, 'total-calories-10m', 'total-calories', days);
  const band = new Map(readBandShareRange(db, from, to).map((day) => [day.date, day]));
  const snapshots: DaySnapshotInput[] = [];
  for (const day of days) {
    const totalRead = total.get(day.date);
    if (!totalRead) continue;
    const share = band.get(day.date)!; const activeRead = active.get(day.date);
    // without a read of the day's windows the model cannot be told, so the day is not comparable until they are read;
    // a day read in progress is compared with the windows that had passed by the read, not with the whole day
    const dayWindows = windows.get(day.date);
    const passed = Math.max(1, Math.min(share.totalWindows, Math.floor((Math.min(day.end, totalRead.readAt, nowMs) - day.start) / 600000)));
    const model = dayWindows ? classifyEnergyModel({ windowValues: dayWindows.flatMap((window) => window.value === null ? [] : [window.value]), dayWindows: passed, active: activeRead?.value == null ? 'absent' : /[1-9]/.test(activeRead.value) ? 'positive' : 'zero' }) : 'unknown';
    const heart = share.heartRate?.windows ?? null;
    const origin = heart === null ? 'unknown' : heart === 0 ? 'phone' : heart === share.totalWindows ? 'wearable' : 'mixed';
    // A day is final only when it has ended and its newest read was made afterwards; earlier reads stay provisional.
    const progress = nowMs < day.end ? 'ongoing' : totalRead.readAt < day.end ? 'read_before_end' : 'complete';
    const evidence = (kind: 'total' | 'active', read: { value: string | null } | undefined): EnergyEvidence => ({
      kind, value: read?.value ?? null, unit: 'kcal', origin, coverage: 'confirmed', day: progress, zeroConfirmed: read?.value != null,
      definition: model === 'basal_only' ? (kind === 'total' ? 'basal_only' : 'active_above_basal') : model === 'unknown' ? 'unknown' : kind === 'total' ? 'total_including_basal' : 'active_above_basal',
      ...(model === 'legacy' ? { model: 'legacy' as const } : {}),
    });
    snapshots.push(projectEnergyDay({
      date: day.date, totalEnergy: evidence('total', totalRead), activeEnergy: evidence('active', activeRead),
      energy: { rule: 'google-energy-v1', model, heartRateWindows: heart, dayWindows: share.totalWindows, activeWithHeartRateKcal: share.activeEnergy?.bandKcal ?? null, activeWithoutHeartRateKcal: share.activeEnergy?.otherKcal ?? null },
    }));
  }
  return snapshots;
}

/** Publish a new revision only for days whose projection changed; values, issues and evidence move together. */
export function publishGoogleEnergyDays(db: DatabaseSync, from: string, to: string, nowMs: number): { published: number; unchanged: number } {
  let published = 0, unchanged = 0;
  for (const snapshot of projectGoogleEnergyDays(db, from, to, nowMs)) {
    const current = readCanonicalDay(db, snapshot.date);
    if (current && JSON.stringify({ metrics: current.metrics, issues: current.issues, energy: current.energy }) === JSON.stringify({ metrics: snapshot.metrics, issues: snapshot.issues, energy: snapshot.energy })) { unchanged++; continue; }
    publishCanonicalDay(db, snapshot, current?.revision ?? null); published++;
  }
  return { published, unchanged };
}
