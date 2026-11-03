import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { dailyRollupTypes, maxRollupDays, parseDailyRollup, type DailyRollupType } from '../adapters/google-health/daily-rollup.ts';
import { maxWindowRangeDays, parseWindowRollup, windowSeconds } from '../adapters/google-health/window-rollup.ts';

export const windowJobKinds = { 'heart-rate-10m': 'heart-rate', 'active-energy-10m': 'active-energy-burned', 'total-calories-10m': 'total-calories', 'steps-10m': 'steps', 'distance-10m': 'distance' } as const;
export type WindowJobKind = keyof typeof windowJobKinds;
export const isWindowKind = (kind: string): kind is WindowJobKind => kind in windowJobKinds;
export type GoogleJobKind = 'weight' | 'body-fat' | DailyRollupType | WindowJobKind;
const kinds = z.enum(['weight', 'body-fat', ...dailyRollupTypes, ...(Object.keys(windowJobKinds) as WindowJobKind[])]);
const isDaily = (kind: string): kind is DailyRollupType => (dailyRollupTypes as readonly string[]).includes(kind);
/** Body jobs hold UTC instants; daily aggregate jobs hold half-open producer civil dates. */
function validRange(kind: string, start: string, end: string): boolean {
  if (isDaily(kind)) { if (!z.iso.date().safeParse(start).success || !z.iso.date().safeParse(end).success) return false; const days = (Date.parse(end) - Date.parse(start)) / 86400000; return days >= 1 && days <= maxRollupDays(kind); }
  if (!z.iso.datetime().safeParse(start).success || !z.iso.datetime().safeParse(end).success || Date.parse(start) >= Date.parse(end)) return false;
  if (isWindowKind(kind)) return (Date.parse(end) - Date.parse(start)) <= maxWindowRangeDays * 86400000 && (Date.parse(start) / 1000) % windowSeconds === 0 && (Date.parse(end) / 1000) % windowSeconds === 0;
  return true;
}

const pageSchema = z.object({ dataPoints: z.array(z.unknown()).max(100).optional(), rollupDataPoints: z.array(z.unknown()).max(10000).optional(), nextPageToken: z.string().max(8192).optional() }).passthrough();
export function createGoogleReadJob(db: DatabaseSync, accountDigest: string, kind: GoogleJobKind, start: string, end: string): string {
  z.string().regex(/^[0-9a-f]{64}$/).parse(accountDigest); kinds.parse(kind);
  if (!validRange(kind, start, end)) throw new Error('invalid_range');
  const id = randomUUID();
  db.prepare("INSERT INTO google_read_jobs VALUES (?, ?, ?, ?, ?, NULL, 'running', ?)").run(id, accountDigest, kind, start, end, new Date().toISOString());
  return id;
}

/** Commit original JSON and cursor in one transaction; a failed page never advances the job. */
export function commitGooglePage(db: DatabaseSync, jobId: string, expectedCursor: string | null, rawJson: string): { complete: boolean; pageNumber: number } {
  if (Buffer.byteLength(rawJson, 'utf8') > 1048576) throw new Error('response_too_large');
  const parsed = pageSchema.parse(JSON.parse(rawJson) as unknown); const nextCursor = parsed.nextPageToken || null;
  db.exec('BEGIN IMMEDIATE');
  try {
    const job = db.prepare('SELECT kind, cursor, state FROM google_read_jobs WHERE id = ?').get(jobId);
    if (!job || job.state !== 'running' || job.cursor !== expectedCursor) throw new Error('job_conflict');
    if (typeof job.kind === 'string' && isDaily(job.kind)) parseDailyRollup(rawJson, job.kind);
    if (typeof job.kind === 'string' && isWindowKind(job.kind)) parseWindowRollup(rawJson, windowJobKinds[job.kind]);
    if (nextCursor && (nextCursor === expectedCursor || db.prepare('SELECT 1 FROM google_read_pages WHERE job_id = ? AND request_cursor = ?').get(jobId, nextCursor))) throw new Error('cursor_cycle');
    const pageNumber = Number(db.prepare('SELECT COALESCE(MAX(page_number), 0) + 1 AS n FROM google_read_pages WHERE job_id = ?').get(jobId)?.n);
    const digest = createHash('sha256').update(rawJson, 'utf8').digest('hex');
    db.prepare('INSERT INTO google_read_pages VALUES (?, ?, ?, ?, ?, ?, ?)').run(jobId, pageNumber, expectedCursor, nextCursor, rawJson, digest, new Date().toISOString());
    db.prepare('UPDATE google_read_jobs SET cursor = ?, state = ? WHERE id = ?').run(nextCursor, nextCursor ? 'running' : 'complete', jobId);
    db.exec('COMMIT'); return { complete: nextCursor === null, pageNumber };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Check stored page chain and checksums without emitting data or identifiers. */
export function verifyGooglePages(db: DatabaseSync): void {
  const pages = db.prepare('SELECT page_number, request_cursor, next_cursor, raw_json, digest FROM google_read_pages WHERE job_id = ? ORDER BY page_number');
  for (const job of db.prepare('SELECT id, account_digest, kind, range_start, range_end, cursor, state, created_at FROM google_read_jobs').iterate()) {
    z.string().regex(/^[0-9a-f]{64}$/).parse(job.account_digest);
    kinds.parse(job.kind); z.iso.datetime().parse(job.created_at);
    if (typeof job.id !== 'string' || typeof job.range_start !== 'string' || typeof job.range_end !== 'string' || !validRange(String(job.kind), job.range_start, job.range_end)) throw new Error('invalid_google_job');
    let cursor: string | null = null; let number = 0; const seen = new Set<string>();
    for (const page of pages.iterate(job.id)) {
      if (number > 0 && cursor === null) throw new Error('invalid_google_cursor');
      if (page.page_number !== ++number || page.request_cursor !== cursor || typeof page.raw_json !== 'string' || Buffer.byteLength(page.raw_json) > 1048576 || createHash('sha256').update(page.raw_json).digest('hex') !== page.digest) throw new Error('invalid_google_page');
      const parsed = pageSchema.parse(JSON.parse(page.raw_json) as unknown); const next = parsed.nextPageToken || null;
      if (page.next_cursor !== next || (next !== null && seen.has(next))) throw new Error('invalid_google_cursor');
      if (next !== null) seen.add(next);
      cursor = next;
      if (cursor === null && number > 0 && job.state !== 'complete') throw new Error('invalid_google_cursor');
    }
    if (job.cursor !== cursor || (job.state === 'complete' && (number === 0 || cursor !== null)) || (job.state === 'running' && number > 0 && cursor === null)) throw new Error('invalid_google_job');
  }
}
