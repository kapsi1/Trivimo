import type { DatabaseSync } from 'node:sqlite';
import { parseSourceList, type DataSource, type SourceListKind } from '../adapters/google-health/source-list.ts';

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export interface SourceRecords { source: DataSource; records: number }

/**
 * Per-day source counts of one complete job. A complete job's saved pages never change, and parsing them is the cost of
 * the table (seconds), so the result is kept per open store connection and reused when the range is switched.
 */
const jobCache = new WeakMap<DatabaseSync, Map<string, Map<string, Map<string, SourceRecords>>>>();
function jobDays(db: DatabaseSync, kind: SourceListKind, jobId: unknown, pages: ReturnType<DatabaseSync['prepare']>): Map<string, Map<string, SourceRecords>> {
  const cache = jobCache.get(db) ?? new Map(); jobCache.set(db, cache);
  const cacheKey = `${kind}:${String(jobId)}`, hit = cache.get(cacheKey);
  if (hit) return hit;
  const byDay = new Map<string, Map<string, SourceRecords>>();
  for (const page of pages.iterate(jobId as string)) {
    if (typeof page.raw_json !== 'string') throw new Error('invalid_page');
    for (const entry of parseSourceList(page.raw_json, kind).days) {
      const sources = byDay.get(entry.date) ?? new Map<string, SourceRecords>(); byDay.set(entry.date, sources);
      const id = JSON.stringify(entry.source); const current = sources.get(id);
      sources.set(id, { source: entry.source, records: (current?.records ?? 0) + entry.records });
    }
  }
  cache.set(cacheKey, byDay);
  return byDay;
}

/** Per date of [from, to] the sources of the newest complete read covering it; an unread date is absent (unknown, not "no source"). */
function savedSources(db: DatabaseSync, kind: SourceListKind, from: string, to: string): Map<string, SourceRecords[]> {
  const claimed = new Map<string, SourceRecords[]>();
  const pages = db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ? ORDER BY page_number LIMIT 50');
  for (const job of db.prepare("SELECT id, range_start, range_end FROM google_read_jobs WHERE kind = ? AND state = 'complete' AND range_start <= ? AND range_end > ? ORDER BY created_at DESC, id").iterate(kind, to, from)) {
    const needed: string[] = [];
    for (let day = String(job.range_start) < from ? from : String(job.range_start); day < String(job.range_end) && day <= to; day = addDays(day, 1)) if (!claimed.has(day)) needed.push(day);
    if (needed.length === 0) continue;
    const byDay = jobDays(db, kind, job.id, pages);
    for (const day of needed) claimed.set(day, [...(byDay.get(day)?.values() ?? [])].sort((a, b) => b.records - a.records));
  }
  return claimed;
}

/** Which apps and devices supplied the steps and active-energy records of each day; record counts, never values. */
export function readDaySourcesRange(db: DatabaseSync, from: string, to: string) {
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 365) throw new Error('range_too_large');
  const steps = savedSources(db, 'steps-sources', from, to), active = savedSources(db, 'active-energy-sources', from, to);
  const days = [];
  for (let date = from; date <= to; date = addDays(date, 1)) days.push({ date, steps: steps.get(date) ?? null, activeEnergy: active.get(date) ?? null });
  return days;
}
