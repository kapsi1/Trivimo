import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { maxRollupDays } from '../../packages/adapters/google-health/daily-rollup.ts';
import { defaultRetryPolicy, RateLimitedError, withRateLimitRetry, type RetryPolicy } from '../../packages/adapters/google-health/rate-limit.ts';
import { sourceDay } from '../../packages/domain/source-day.ts';
import { warsawDay } from '../../packages/domain/warsaw-day.ts';
import type { GoogleJobKind } from '../../packages/storage/google-pages.ts';
import { applyReadPolicy, registerAutomaticJob } from '../../packages/storage/google-read-policy.ts';
import type { GoogleAuth } from './google-auth.ts';
import { readGoogleJobPage, startGoogleReadJob } from './google-read-service.ts';

/** Kinds refreshed automatically: the six M1 metrics' raw material plus the ten-minute wear evidence. */
export const syncKinds = ['steps', 'distance', 'total-calories', 'active-energy-burned', 'heart-rate-10m', 'active-energy-10m', 'total-calories-10m', 'steps-10m', 'distance-10m'] as const;
export type SyncKind = (typeof syncKinds)[number];
export interface SyncRead { kind: SyncKind; first: string; last: string; begin: string; end: string }
export interface SyncOutcome { at: string; result: 'ok' | 'authorization_required' | 'scope_missing' | 'migration_required' | 'error'; code?: string; reads: number; retryAt?: string }

const maxCatchUpDays = 13; // keeps a ten-minute-window range within 14 days even across a 25-hour day
const windowed = (kind: SyncKind) => kind.endsWith('-10m');
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Civil days are stored as producer dates; ten-minute windows as the UTC bounds of the Warsaw days. */
function boundsFor(kind: SyncKind, first: string, last: string): { begin: string; end: string } {
  return windowed(kind) ? { begin: warsawDay(first).start, end: warsawDay(last).end } : { begin: first, end: addDays(last, 1) };
}

/** Last civil date of the newest complete saved read of this kind (that day may still have been partial when read). */
function coveredThrough(db: DatabaseSync, kind: SyncKind): string | null {
  const row = db.prepare("SELECT range_end FROM google_read_jobs WHERE kind = ? AND state = 'complete' ORDER BY range_end DESC LIMIT 1").get(kind);
  if (!row || typeof row.range_end !== 'string') return null;
  return windowed(kind) ? sourceDay(new Date(Date.parse(row.range_end) - 1).toISOString()) : addDays(row.range_end, -1);
}

/**
 * Reads to make now: today every run (unless read within `refreshAfterMs`), and once the last three completed days,
 * extended back to the last covered day after a gap (at most 14 days). Never starts the same completed range twice.
 */
export function planSync(db: DatabaseSync, today: string, nowMs: number, refreshAfterMs: number): SyncRead[] {
  const plan: SyncRead[] = [];
  const completed = db.prepare("SELECT created_at FROM google_read_jobs WHERE kind = ? AND range_start = ? AND range_end = ? AND state = 'complete' ORDER BY created_at DESC LIMIT 1");
  for (const kind of syncKinds) {
    const recentLast = addDays(today, -1);
    const covered = coveredThrough(db, kind);
    let first = addDays(today, -3);
    if (covered !== null && covered < first) first = covered;
    const earliest = addDays(recentLast, -(maxCatchUpDays - 1));
    if (first < earliest) first = earliest;
    const recent = boundsFor(kind, first, recentLast);
    if (!completed.get(kind, recent.begin, recent.end)) plan.push({ kind, first, last: recentLast, ...recent });
    const current = boundsFor(kind, today, today);
    const previous = completed.get(kind, current.begin, current.end);
    if (!previous || nowMs - Date.parse(String(previous.created_at)) >= refreshAfterMs) plan.push({ kind, first: today, last: today, ...current });
  }
  return plan;
}

/** History is read from the start of 2026 (plan M1); earlier years wait for their own audit. */
export const backfillFrom = '2026-01-01';
const chunkDays = (kind: SyncKind) => windowed(kind) ? maxCatchUpDays : maxRollupDays(kind as Exclude<SyncKind, `${string}-10m`>);
const dayEnd = (day: string) => Date.parse(warsawDay(day).end);

/**
 * Days of [from, through] that a complete read of this kind (manual, automatic or backfill) covered in full after the day
 * had ended. A day read while still in progress is not covered; a read with no data points covers its days (absence, not 0).
 */
export function coveredDays(db: DatabaseSync, kind: SyncKind, from: string, through: string): Set<string> {
  const covered = new Set<string>();
  for (const job of db.prepare("SELECT range_start, range_end, created_at FROM google_read_jobs WHERE kind = ? AND state = 'complete'").iterate(kind)) {
    const begin = String(job.range_start), end = String(job.range_end), created = Date.parse(String(job.created_at));
    let day = windowed(kind) ? sourceDay(begin) : begin;
    if (day < from) day = from;
    for (; day <= through; day = addDays(day, 1)) {
      const bounds = boundsFor(kind, day, day);
      if (windowed(kind) ? Date.parse(bounds.end) > Date.parse(end) : bounds.end > end) break;
      if ((windowed(kind) ? Date.parse(bounds.begin) >= Date.parse(begin) : bounds.begin >= begin) && created >= dayEnd(day)) covered.add(day);
    }
  }
  return covered;
}

/** Uncovered days of [from, through], per kind in `syncKinds` order, grouped into consecutive chunks within the producer limit. */
export function planBackfill(db: DatabaseSync, from: string, through: string): SyncRead[] {
  const plan: SyncRead[] = [];
  for (const kind of syncKinds) {
    const covered = coveredDays(db, kind, from, through);
    let first: string | null = null; let size = 0;
    const flush = (last: string) => { if (first) plan.push({ kind, first, last, ...boundsFor(kind, first, last) }); first = null; size = 0; };
    for (let day = from, previous = from; day <= through; previous = day, day = addDays(day, 1)) {
      if (covered.has(day)) { if (first) flush(previous); continue; }
      if (first && size === chunkDays(kind)) flush(previous);
      first ??= day; size++;
    }
    if (first) flush(through);
  }
  return plan;
}

export interface BackfillStatus {
  state: 'idle' | 'running' | 'stopping' | 'stopped' | 'done' | 'error';
  from: string; through: string; startedAt: string | null; finishedAt: string | null;
  current: { kind: SyncKind; first: string; last: string } | null; readsThisRun: number; code?: string; retryAt?: string;
  kinds: { kind: SyncKind; covered: number; total: number }[];
}

type Execute = (db: DatabaseSync, read: SyncRead) => Promise<void>;
const safeCodes = /^(authorization_required|scope_missing|account_changed|job_conflict|range_too_large|invalid_range|unexpected_window|duplicate_day|duplicate_window|cursor_cycle|response_too_large|token_refresh_failed|(google_|google_identity_)http_\d{3})$/;

export class GoogleSyncService {
  private running = false;
  private last: SyncOutcome | null = null;
  private timer?: NodeJS.Timeout;
  /** After repeated 429 no run sends requests before this time (kept in memory; a server restart starts afresh). */
  private pausedUntil: number | null = null;
  /** The backfill run of this server process; its progress itself is derived from the store, so it survives restarts. */
  private backfill: Omit<BackfillStatus, 'kinds'> | null = null;
  private stopRequested = false;
  constructor(
    private readonly path: string, private readonly auth: GoogleAuth,
    private readonly options: { intervalMinutes: number | null; now?: () => number; send?: typeof fetch; execute?: Execute; retry?: RetryPolicy; sleep?: (ms: number) => Promise<void>; random?: () => number } = { intervalMinutes: null },
  ) {}
  private now() { return (this.options.now ?? Date.now)(); }
  private sleep(ms: number) { return (this.options.sleep ?? ((wait: number) => delay(wait)))(ms); }
  private retry<T>(call: () => Promise<T>): Promise<T> {
    return withRateLimitRetry(call, { now: () => this.now(), sleep: (ms) => this.sleep(ms), ...(this.options.retry ? { policy: this.options.retry } : {}), ...(this.options.random ? { random: this.options.random } : {}) });
  }
  private open(): DatabaseSync {
    let db: DatabaseSync;
    try { const stat = lstatSync(this.path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_store'); db = new DatabaseSync(this.path); } catch { throw new Error('store_unavailable'); }
    if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || db.prepare('PRAGMA user_version').get()?.user_version !== 9) { db.close(); throw new Error('migration_required'); }
    return db;
  }
  private execute: Execute = async (db, read) => {
    if (this.options.execute) return this.options.execute(db, read);
    const id = await this.retry(() => startGoogleReadJob(db, this.auth, read.kind as GoogleJobKind, read.begin, read.end, this.options.send));
    registerAutomaticJob(db, id);
    for (let page = 0; page < 50; page++) if ((await this.retry(() => readGoogleJobPage(db, this.auth, id, this.options.send))).complete) { applyReadPolicy(db, id, this.now()); return; }
  };
  /** Start the background loop: one catch-up run now, then every interval. Does nothing when no interval is configured. */
  start(): void {
    const minutes = this.options.intervalMinutes;
    if (!minutes || this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), minutes * 60000);
    this.timer.unref();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  /**
   * One run: resume jobs left running, then the planned reads. Only 429 is repeated, per request and with backoff;
   * any other error, or 429 that persists, stops the run. After a persisting 429 runs wait until the producer's delay.
   */
  async runOnce(): Promise<SyncOutcome> {
    if (this.running) return this.last ?? { at: new Date(this.now()).toISOString(), result: 'error', code: 'already_running', reads: 0 };
    this.running = true; let reads = 0;
    const finish = (result: SyncOutcome['result'], code?: string, retryAt?: number): SyncOutcome => (this.last = { at: new Date(this.now()).toISOString(), result, ...(code ? { code } : {}), reads, ...(retryAt !== undefined ? { retryAt: new Date(retryAt).toISOString() } : {}) });
    let db: DatabaseSync | undefined;
    try {
      if (this.pausedUntil !== null && this.now() < this.pausedUntil) return finish('error', 'rate_limited', this.pausedUntil);
      this.pausedUntil = null;
      db = this.open();
      reads += await this.resumeRunning(db);
      const interval = (this.options.intervalMinutes ?? 60) * 60000;
      for (const read of planSync(db, sourceDay(new Date(this.now()).toISOString()), this.now(), interval / 2)) { await this.execute(db, read); reads++; }
      return finish('ok');
    } catch (error) {
      const failure = this.failure(error);
      return finish(failure.result, failure.code, failure.retryAt);
    } finally { db?.close(); this.running = false; }
  }
  /** Finish pages of jobs left running (by an interrupted run, backfill or restart); returns how many were completed. */
  private async resumeRunning(db: DatabaseSync): Promise<number> {
    let reads = 0;
    const kinds = syncKinds.map((kind) => `'${kind}'`).join(',');
    for (const job of db.prepare(`SELECT id FROM google_read_jobs WHERE state = 'running' AND kind IN (${kinds}) ORDER BY created_at`).all()) {
      for (let page = 0; page < 50; page++) { if ((await this.retry(() => readGoogleJobPage(db, this.auth, String(job.id), this.options.send))).complete) { applyReadPolicy(db, String(job.id), this.now()); break; } }
      reads++;
    }
    return reads;
  }
  /** Safe outcome code of a failed run; a persisting 429 also pauses every later request until the producer's delay. */
  private failure(error: unknown): { result: SyncOutcome['result']; code?: string; retryAt?: number } {
    const message = error instanceof z.ZodError ? 'invalid_response_shape' : error instanceof Error ? error.message : '';
    if (message === 'authorization_required' || message === 'scope_missing' || message === 'migration_required') return { result: message };
    if (/^google_(identity_)?http_429$/.test(message)) {
      this.pausedUntil = error instanceof RateLimitedError ? error.retryAt : this.now() + (this.options.retry ?? defaultRetryPolicy).maxWaitMs;
      return { result: 'error', code: message, retryAt: this.pausedUntil };
    }
    return { result: 'error', code: safeCodes.test(message) || message === 'store_unavailable' ? message : 'google_read_failed' };
  }
  /**
   * Read the uncovered completed days since `backfillFrom` in the background, one chunk at a time, sharing the lock,
   * retry and 429 pause with the refresh. Starting again continues from what the store already covers.
   */
  startBackfill(): BackfillStatus {
    if (this.backfill?.state !== 'running' && this.backfill?.state !== 'stopping') {
      const now = new Date(this.now()).toISOString();
      this.stopRequested = false;
      this.backfill = { state: 'running', from: backfillFrom, through: addDays(sourceDay(now), -1), startedAt: now, finishedAt: null, current: null, readsThisRun: 0 };
      this.backfillDone = this.backfillLoop();
    }
    return this.backfillStatus();
  }
  /** Settles when the current backfill loop has ended (for tests and orderly shutdown). */
  backfillDone: Promise<void> = Promise.resolve();
  /** Stop after the chunk in progress; saved pages stay, nothing is rolled back. */
  stopBackfill(): BackfillStatus {
    if (this.backfill?.state === 'running') { this.stopRequested = true; this.backfill.state = 'stopping'; }
    return this.backfillStatus();
  }
  private async backfillLoop(): Promise<void> {
    const run = this.backfill!;
    const end = (state: BackfillStatus['state'], code?: string) => { run.state = state; run.current = null; run.finishedAt = new Date(this.now()).toISOString(); if (code) run.code = code; };
    let previous = '';
    while (true) {
      if (this.stopRequested) return end('stopped');
      if (this.pausedUntil !== null && this.now() < this.pausedUntil) { run.code = 'rate_limited'; run.retryAt = new Date(this.pausedUntil).toISOString(); await this.sleep(Math.min(this.pausedUntil - this.now(), 60000)); continue; }
      if (this.running) { await this.sleep(1000); continue; }
      this.running = true; let db: DatabaseSync | undefined;
      try {
        delete run.code; delete run.retryAt;
        db = this.open();
        run.readsThisRun += await this.resumeRunning(db);
        const next = planBackfill(db, run.from, run.through)[0];
        if (!next) return end('done');
        const key = `${next.kind}:${next.first}:${next.last}`;
        // a chunk planned again right after its complete read would repeat forever; stop and report instead
        if (key === previous) return end('error', 'no_progress');
        previous = key; run.current = { kind: next.kind, first: next.first, last: next.last };
        await this.execute(db, next); run.readsThisRun++;
      } catch (error) {
        const failure = this.failure(error);
        if (failure.code === 'google_http_429' || failure.code === 'google_identity_http_429') { previous = ''; continue; }
        return end('error', failure.code ?? failure.result);
      } finally { db?.close(); this.running = false; }
    }
  }
  backfillStatus(): BackfillStatus {
    const through = this.backfill?.through ?? addDays(sourceDay(new Date(this.now()).toISOString()), -1);
    const from = this.backfill?.from ?? backfillFrom;
    const total = Math.max(0, Math.round((Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
    let kinds: BackfillStatus['kinds'] = [];
    try {
      const db = this.open();
      try { kinds = syncKinds.map((kind) => ({ kind, covered: coveredDays(db, kind, from, through).size, total })); } finally { db.close(); }
    } catch { /* store unavailable: progress unknown, not zero */ }
    return { ...(this.backfill ?? { state: 'idle', from, through, startedAt: null, finishedAt: null, current: null, readsThisRun: 0 }), kinds };
  }
  status() {
    let kinds: { kind: SyncKind; lastReadAt: string | null; coveredThrough: string | null }[] = [];
    let running = 0;
    try {
      const db = this.open();
      try {
        const latest = db.prepare("SELECT MAX(created_at) AS at FROM google_read_jobs WHERE kind = ? AND state = 'complete'");
        kinds = syncKinds.map((kind) => ({ kind, lastReadAt: typeof latest.get(kind)?.at === 'string' ? String(latest.get(kind)?.at) : null, coveredThrough: coveredThrough(db, kind) }));
        running = Number(db.prepare(`SELECT COUNT(*) AS n FROM google_read_jobs WHERE state = 'running' AND kind IN (${syncKinds.map((kind) => `'${kind}'`).join(',')})`).get()?.n);
      } finally { db.close(); }
    } catch { /* the store is unavailable or needs migration; the last outcome says so */ }
    return { automatic: this.options.intervalMinutes, running: this.running, unfinishedJobs: running, pausedUntil: this.pausedUntil === null ? null : new Date(this.pausedUntil).toISOString(), last: this.last, kinds, backfill: this.backfillStatus() };
  }
}
