import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { parseDailyRollup, type DailyRollupType } from '../adapters/google-health/daily-rollup.ts';
import { parseSourceValue } from '../domain/source-units.ts';

/** Millimetres to kilometres by shifting the decimal point six places, without floating point. */
export function millimetresToKm(value: string): string {
  const digits = value.replace(/^0+(?=\d)/, '').padStart(7, '0');
  return `${digits.slice(0, -6).replace(/^0+(?=\d)/, '')}.${digits.slice(-6)}`;
}

/** Bounded review of saved producer-civil-day aggregates for one date; never deduplicates, qualifies or sums. */
export function readGoogleDailySourceDay(db: DatabaseSync, kind: DailyRollupType, date: string) {
  z.iso.date().parse(date);
  const jobRows = db.prepare(`SELECT id, range_start, range_end, state, created_at FROM google_read_jobs
    WHERE kind = ? AND range_start <= ? AND range_end > ? ORDER BY created_at DESC, id LIMIT 51`).all(kind, date, date);
  const jobs = jobRows.slice(0, 50).map((job) => z.object({ id: z.string(), range_start: z.string(), range_end: z.string(), state: z.enum(['running', 'complete']), created_at: z.string() }).parse(job));
  const accounts = db.prepare('SELECT COUNT(DISTINCT account_digest) AS n FROM google_read_jobs WHERE kind = ? AND range_start <= ? AND range_end > ?').get(kind, date, date)?.n;
  const rows: { originalValue: string; unit: 'steps' | 'mm' | 'kcal'; converted: { value: string; unit: 'szt.' | 'km' | 'kcal' } | null; receivedAt: string; jobStartedAt: string; state: 'running' | 'complete' }[] = [];
  const pages = db.prepare('SELECT raw_json, received_at FROM google_read_pages WHERE job_id = ? ORDER BY page_number LIMIT 51');
  let truncated = jobRows.length > 50;
  for (const job of jobs) {
    let count = 0;
    for (const page of pages.iterate(job.id)) {
      if (++count > 50) { truncated = true; break; }
      if (typeof page.raw_json !== 'string' || typeof page.received_at !== 'string') throw new Error('invalid_page');
      for (const day of parseDailyRollup(page.raw_json, kind).days) {
        if (day.date !== date) continue;
        const parsed = kind === 'steps' ? parseSourceValue('steps', day.value) : null;
        const converted = kind === 'steps' ? (parsed?.status === 'parsed' ? { value: parsed.value, unit: 'szt.' as const } : null) : kind === 'distance' ? { value: millimetresToKm(day.value), unit: 'km' as const } : { value: day.value, unit: 'kcal' as const };
        rows.push({ originalValue: day.value, unit: day.unit, converted, receivedAt: page.received_at, jobStartedAt: job.created_at, state: job.state });
      }
    }
  }
  return { rows, truncated, coverage: 'unknown' as const, multipleAccounts: Number(accounts) > 1, jobs: jobs.map((job) => ({ start: job.range_start, end: job.range_end, state: job.state })) };
}
