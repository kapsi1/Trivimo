import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { sourceDay } from '../domain/source-day.ts';

/**
 * Retention policy for automatic reads (decision 2026-11-03, see docs/decisions.md):
 * - a re-read with identical content is not kept; the earlier read is marked "confirmed unchanged at T";
 * - a newer read replaces older automatic reads of the same kind and account whose range it covers, except reads of
 *   the last three completed days, where distinct values are kept to see late corrections;
 * - every removal leaves an audit row; manual reads are never removed.
 */
export type PolicyOutcome = { result: 'not_automatic' | 'kept'; removed: number } | { result: 'unchanged_duplicate'; keptJob: string; removed: number };

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const isInstant = (value: string) => value.includes('T');

/** Digest of the saved page chain of a job; null when it has no pages. */
export function contentDigest(db: DatabaseSync, jobId: string): string | null {
  const digests = db.prepare('SELECT digest FROM google_read_pages WHERE job_id = ? ORDER BY page_number').all(jobId).map((row) => String(row.digest));
  return digests.length === 0 ? null : createHash('sha256').update(digests.join(',')).digest('hex');
}

/** Record the intent: this job was started by the scheduler, so the policy may later compact it. */
export function registerAutomaticJob(db: DatabaseSync, jobId: string): void {
  db.prepare("INSERT OR IGNORE INTO google_read_job_meta (job_id, origin) VALUES (?, 'automatic')").run(jobId);
}

function lastDay(rangeStart: string, rangeEnd: string): string {
  return isInstant(rangeStart) ? sourceDay(new Date(Date.parse(rangeEnd) - 1).toISOString()) : addDays(rangeEnd, -1);
}

type Row = Record<string, string | number | bigint | Uint8Array | null>;
function remove(db: DatabaseSync, old: Row, replacedBy: string, reason: string, now: string): number {
  const pages = Number(db.prepare('SELECT COUNT(*) AS n FROM google_read_pages WHERE job_id = ?').get(old.id)?.n);
  db.prepare('INSERT INTO google_read_supersessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), old.kind, old.range_start, old.range_end, old.account_digest, contentDigest(db, String(old.id)), old.created_at, replacedBy, pages, reason, now);
  db.prepare('DELETE FROM google_read_pages WHERE job_id = ?').run(old.id);
  db.prepare('DELETE FROM google_read_job_meta WHERE job_id = ?').run(old.id);
  db.prepare('DELETE FROM google_read_jobs WHERE id = ?').run(old.id);
  return pages;
}

/** Apply the policy right after an automatic job completed. Runs in one transaction; a failure changes nothing. */
export function applyReadPolicy(db: DatabaseSync, jobId: string, nowMs: number): PolicyOutcome {
  const now = new Date(nowMs).toISOString(); const today = sourceDay(now);
  db.exec('BEGIN IMMEDIATE');
  try {
    const job = db.prepare(`SELECT j.id, j.kind, j.account_digest, j.range_start, j.range_end, j.created_at, j.state, m.origin FROM google_read_jobs j
      LEFT JOIN google_read_job_meta m ON m.job_id = j.id WHERE j.id = ?`).get(jobId);
    if (!job || job.state !== 'complete' || job.origin !== 'automatic') { db.exec('COMMIT'); return { result: 'not_automatic', removed: 0 }; }
    const digest = contentDigest(db, jobId);
    db.prepare('UPDATE google_read_job_meta SET content_digest = ? WHERE job_id = ?').run(digest, jobId);
    const previous = db.prepare(`SELECT id FROM google_read_jobs WHERE kind = ? AND account_digest = ? AND range_start = ? AND range_end = ? AND state = 'complete' AND id != ?
      ORDER BY created_at DESC, id LIMIT 1`).get(job.kind, job.account_digest, job.range_start, job.range_end, jobId);
    if (previous && digest !== null && contentDigest(db, String(previous.id)) === digest) {
      db.prepare("INSERT OR IGNORE INTO google_read_job_meta (job_id, origin) VALUES (?, 'manual')").run(previous.id);
      db.prepare('UPDATE google_read_job_meta SET confirmed_at = ?, confirmations = confirmations + 1 WHERE job_id = ?').run(now, previous.id);
      const removed = remove(db, job, String(previous.id), 'unchanged_duplicate', now);
      db.exec('COMMIT'); return { result: 'unchanged_duplicate', keptJob: String(previous.id), removed };
    }
    let removed = 0;
    const from = Date.parse(String(job.range_start)), to = Date.parse(String(job.range_end));
    const candidates = db.prepare(`SELECT j.id, j.kind, j.account_digest, j.range_start, j.range_end, j.created_at FROM google_read_jobs j
      JOIN google_read_job_meta m ON m.job_id = j.id AND m.origin = 'automatic'
      WHERE j.kind = ? AND j.account_digest = ? AND j.state = 'complete' AND j.id != ? AND j.created_at < ? ORDER BY j.created_at`).all(job.kind, job.account_digest, jobId, job.created_at);
    for (const old of candidates) {
      if (Date.parse(String(old.range_start)) < from || Date.parse(String(old.range_end)) > to) continue;
      const oldLast = lastDay(String(old.range_start), String(old.range_end)); const oldCreatedDay = sourceDay(String(old.created_at));
      const intermediate = oldCreatedDay <= oldLast && oldCreatedDay === sourceDay(String(job.created_at));
      if (intermediate) removed += remove(db, old, jobId, 'intermediate_current_day', now);
      else if (oldLast < addDays(today, -3)) removed += remove(db, old, jobId, 'superseded_after_correction_window', now);
    }
    db.exec('COMMIT'); return { result: 'kept', removed };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
