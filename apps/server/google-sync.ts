import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { currentStoreVersion } from '../../packages/storage/canonical-days.ts';
import { maxRollupDays } from '../../packages/adapters/google-health/daily-rollup.ts';
import { defaultRetryPolicy, RateLimitedError, withRateLimitRetry, type RetryPolicy } from '../../packages/adapters/google-health/rate-limit.ts';
import { sourceDay } from '../../packages/domain/source-day.ts';
import { firstSupportedDay, warsawDay } from '../../packages/domain/warsaw-day.ts';
import type { GoogleJobKind } from '../../packages/storage/google-pages.ts';
import { publishDayRangeYielding } from '../../packages/storage/google-day-snapshots.ts';
import { applyReadPolicy, registerAutomaticJob } from '../../packages/storage/google-read-policy.ts';
import type { GoogleAuth } from './google-auth.ts';
import { readGoogleJobPage, startGoogleReadJob } from './google-read-service.ts';

/** Kinds refreshed automatically: the six M1 metrics' raw material plus the ten-minute wear evidence. */
export const syncKinds = ['steps', 'distance', 'total-calories', 'active-energy-burned', 'heart-rate-10m', 'active-energy-10m', 'total-calories-10m', 'steps-10m', 'distance-10m', 'steps-sources', 'active-energy-sources', 'weight', 'body-fat'] as const;
export type SyncKind = (typeof syncKinds)[number];
export interface SyncRead { kind: SyncKind; first: string; last: string; begin: string; end: string }
export interface SyncOutcome { at: string; result: 'ok' | 'authorization_required' | 'scope_missing' | 'migration_required' | 'error'; code?: string; reads: number; retryAt?: string; energy?: { published: number; unchanged: number } | 'failed' }

const maxCatchUpDays = 13; // keeps a ten-minute-window range within 14 days even across a 25-hour day
const windowed = (kind: SyncKind) => kind.endsWith('-10m');
/** Window and measurement (weight, body fat) jobs hold the UTC bounds of Warsaw days; the others hold civil dates. */
const instantRange = (kind: SyncKind) => windowed(kind) || kind === 'weight' || kind === 'body-fat';
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Civil days are stored as producer dates; ten-minute windows as the UTC bounds of the Warsaw days. */
function boundsFor(kind: SyncKind, first: string, last: string): { begin: string; end: string } {
  return instantRange(kind) ? { begin: warsawDay(first).start, end: warsawDay(last).end } : { begin: first, end: addDays(last, 1) };
}

/** Last civil date of the newest complete saved read of this kind (that day may still have been partial when read). */
function coveredThrough(db: DatabaseSync, kind: SyncKind): string | null {
  const row = db.prepare("SELECT range_end FROM google_read_jobs WHERE kind = ? AND state = 'complete' ORDER BY range_end DESC LIMIT 1").get(kind);
  if (!row || typeof row.range_end !== 'string') return null;
  return instantRange(kind) ? sourceDay(new Date(Date.parse(row.range_end) - 1).toISOString()) : addDays(row.range_end, -1);
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

/**
 * Default start of the history read automatically (plan M1). Earlier days (from `firstSupportedDay`) are read only
 * when the user starts the backfill from an earlier date (decision 2026-11-04); the automatic gap check stays at 2026.
 */
export const backfillFrom = '2026-01-01';
// source lists hold every record (about 200 bytes each), so a week keeps a page well under the 1 MB response limit
// measurements are a few records a day, so a month fits in one page; the read service allows ranges up to 31 days
const chunkDays = (kind: SyncKind) => windowed(kind) ? maxCatchUpDays : kind.endsWith('-sources') ? 7 : kind === 'weight' || kind === 'body-fat' ? 30 : maxRollupDays(kind as Exclude<SyncKind, `${string}-10m` | `${string}-sources` | 'weight' | 'body-fat'>);
const dayEnd = (day: string) => Date.parse(warsawDay(day).end);

/**
 * Inputs of the projection as id → "version, range start, range end": complete jobs, and CSV imports with their latest
 * decision over the days of their values. The days a refresh projection must redo follow from their changes.
 */
function projectionInputs(db: DatabaseSync): Map<string, string> {
  const inputs = new Map(db.prepare("SELECT id, kind, range_start, range_end FROM google_read_jobs WHERE state = 'complete'").all().map((row) => [`job:${String(row.id)}`, `${String(row.kind)}	${String(row.range_start)}	${String(row.range_end)}`]));
  for (const row of db.prepare('SELECT i.id, (SELECT MAX(revision) FROM csv_import_decisions d WHERE d.import_id = i.id) AS revision, MIN(v.day) AS first, MAX(v.day) AS last FROM csv_imports i JOIN csv_import_values v ON v.import_id = i.id GROUP BY i.id').all()) {
    inputs.set(`csv:${String(row.id)}`, `csv-${String(row.revision)}	${String(row.first)}	${addDays(String(row.last), 1)}`);
  }
  return inputs;
}
/** First and last day an input's range touches (instants as Warsaw days, civil ranges end-exclusive). */
function jobSpan(job: string): [string, string] {
  const [, start = '', end = ''] = job.split('	');
  return start.includes('T') ? [sourceDay(start), sourceDay(new Date(Date.parse(end) - 1).toISOString())] : [start, addDays(end, -1)];
}

/**
 * Days of [from, today] whose projection may differ from the last one: days of every job added, completed or removed
 * since then (a day takes the newest read covering it, so other days keep their inputs), and the days from the last
 * projection's day to today (a day in progress, or one that has ended since, changes with time alone). Consecutive ranges.
 */
export function changedDays(before: Map<string, string>, after: Map<string, string>, lastDay: string, from: string, today: string): [string, string][] {
  const days = new Set<string>();
  const add = (first: string, last: string) => { for (let day = first < from ? from : first; day <= last && day <= today; day = addDays(day, 1)) days.add(day); };
  for (const [id, job] of before) if (after.get(id) !== job) add(...jobSpan(job));
  for (const [id, job] of after) if (before.get(id) !== job) add(...jobSpan(job));
  add(lastDay, today);
  const ranges: [string, string][] = [];
  for (const day of [...days].sort()) { const current = ranges.at(-1); if (current && addDays(current[1], 1) === day) current[1] = day; else ranges.push([day, day]); }
  return ranges;
}

/**
 * Days of [from, through] that a complete read of this kind (manual, automatic or backfill) covered in full after the day
 * had ended. A day read while still in progress is not covered; a read with no data points covers its days (absence, not 0).
 */
export function coveredDays(db: DatabaseSync, kind: SyncKind, from: string, through: string): Set<string> {
  const covered = new Set<string>();
  for (const job of db.prepare("SELECT range_start, range_end, created_at FROM google_read_jobs WHERE kind = ? AND state = 'complete'").iterate(kind)) {
    const begin = String(job.range_start), end = String(job.range_end), created = Date.parse(String(job.created_at));
    let day = instantRange(kind) ? sourceDay(begin) : begin;
    if (day < from) day = from;
    for (; day <= through; day = addDays(day, 1)) {
      const bounds = boundsFor(kind, day, day);
      if (instantRange(kind) ? Date.parse(bounds.end) > Date.parse(end) : bounds.end > end) break;
      if ((instantRange(kind) ? Date.parse(bounds.begin) >= Date.parse(begin) : bounds.begin >= begin) && created >= dayEnd(day)) covered.add(day);
    }
  }
  return covered;
}

/** Source of `coveredDays` results; the service passes a cached one (the sets are read, never changed). */
export type CoveredDays = (db: DatabaseSync, kind: SyncKind, from: string, through: string) => ReadonlySet<string>;

/** Per day of [from, through] how many of `syncKinds` a complete read covered after the day ended (calendar of history coverage). */
export function coverageCalendar(db: DatabaseSync, from: string, through: string, covered: CoveredDays = coveredDays): { date: string; covered: number }[] {
  const sets = syncKinds.map((kind) => covered(db, kind, from, through));
  const days: { date: string; covered: number }[] = [];
  for (let day = from; day <= through; day = addDays(day, 1)) days.push({ date: day, covered: sets.filter((set) => set.has(day)).length });
  return days;
}

/**
 * Uncovered days of [from, through], grouped per kind into consecutive chunks within the producer limit, newest
 * period first (all kinds of a period before an older one, `syncKinds` order within it). A run stopped part-way
 * then leaves recent days with every kind read, so their snapshots are qualified, instead of all days half read.
 */
export function planBackfill(db: DatabaseSync, from: string, through: string, coveredBy: CoveredDays = coveredDays): SyncRead[] {
  const plan: SyncRead[] = [];
  for (const kind of syncKinds) {
    const covered = coveredBy(db, kind, from, through);
    let first: string | null = null; let size = 0;
    const flush = (last: string) => { if (first) plan.push({ kind, first, last, ...boundsFor(kind, first, last) }); first = null; size = 0; };
    for (let day = from, previous = from; day <= through; previous = day, day = addDays(day, 1)) {
      if (covered.has(day)) { if (first) flush(previous); continue; }
      if (first && size === chunkDays(kind)) flush(previous);
      first ??= day; size++;
    }
    if (first) flush(through);
  }
  return plan.map((read, index) => ({ read, index })).sort((a, b) => a.read.last < b.read.last ? 1 : a.read.last > b.read.last ? -1 : a.index - b.index).map(({ read }) => read);
}

export interface BackfillStatus {
  state: 'idle' | 'running' | 'stopping' | 'stopped' | 'done' | 'error';
  from: string; through: string; startedAt: string | null; finishedAt: string | null;
  current: { kind: SyncKind; first: string; last: string } | null; readsThisRun: number; code?: string; retryAt?: string;
  /** Automatic repeat after a transient error (server error, timeout, network): which attempt and when it runs. */
  retrying?: { attempt: number; of: number; at: string; code: string };
  kinds: { kind: SyncKind; covered: number; total: number }[];
  /** Chunks still to read for the range (each is one producer read); null when the store is unavailable. */
  remainingReads: number | null;
}

type Execute = (db: DatabaseSync, read: SyncRead) => Promise<void>;
/**
 * Backfill repeats of a chunk after a transient failure: producer 5xx, a timeout or a network error (`google_read_failed`
 * covers those). Reads change nothing and a page is committed only after success, so a repeat resumes the saved cursor.
 * Authorization, scope, store and response-shape errors are not repeated.
 */
export const backfillRetryDelaysMs = [15000, 30000, 60000, 120000, 300000];
const transientFailure = (code: string | undefined) => !!code && (/^google_(identity_)?http_5\d\d$/.test(code) || code === 'google_read_failed');
const safeCodes = /^(authorization_required|scope_missing|account_changed|job_conflict|range_too_large|invalid_range|unexpected_window|duplicate_day|duplicate_window|cursor_cycle|response_too_large|token_refresh_failed|(google_|google_identity_)http_\d{3})$/;

export class GoogleSyncService {
  private running = false;
  private last: SyncOutcome | null = null;
  private timer?: NodeJS.Timeout;
  /** After repeated 429 no run sends requests before this time (kept in memory; a server restart starts afresh). */
  private pausedUntil: number | null = null;
  /** The backfill run of this server process; its progress itself is derived from the store, so it survives restarts. */
  private backfill: Omit<BackfillStatus, 'kinds' | 'remainingReads'> | null = null;
  private stopRequested = false;
  /**
   * Coverage is derived from complete jobs only and costs seconds for long ranges, while the UI polls the status every
   * few seconds. Results are kept per kind and range under a fingerprint of that kind's complete jobs (count, newest
   * and summed creation time, summed rowid), so any added, completed or removed job of the kind recomputes it.
   */
  private coverageCache = new Map<string, { fingerprint: string; days: ReadonlySet<string> }>();
  private progressCache?: { key: string; kinds: BackfillStatus['kinds']; remainingReads: number };
  private fingerprints(db: DatabaseSync): Map<string, string> {
    const rows = db.prepare("SELECT kind, COUNT(*) AS n, MAX(created_at) AS newest, TOTAL(julianday(created_at)) AS created, TOTAL(rowid) AS rows FROM google_read_jobs WHERE state = 'complete' GROUP BY kind").all();
    return new Map(rows.map((row) => [String(row.kind), `${String(row.n)}|${String(row.newest)}|${String(row.created)}|${String(row.rows)}`]));
  }
  private cachedCoverage(fingerprints: Map<string, string>): CoveredDays {
    return (db, kind, from, through) => {
      const key = `${kind}|${from}|${through}`, fingerprint = fingerprints.get(kind) ?? 'none', hit = this.coverageCache.get(key);
      if (hit && hit.fingerprint === fingerprint) return hit.days;
      const days = coveredDays(db, kind, from, through);
      if (this.coverageCache.size >= 128) this.coverageCache.clear();
      this.coverageCache.set(key, { fingerprint, days });
      return days;
    };
  }
  /** `planBackfill` with the cached coverage of the store's current jobs. */
  private plan(db: DatabaseSync, from: string, through: string): SyncRead[] { return planBackfill(db, from, through, this.cachedCoverage(this.fingerprints(db))); }
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
    try { const stat = lstatSync(this.path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_store'); db = new DatabaseSync(this.path, { timeout: 5000 }); } catch { throw new Error('store_unavailable'); }
    if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || db.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { db.close(); throw new Error('migration_required'); }
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
    void this.scheduledRun();
    this.timer = setInterval(() => void this.scheduledRun(), minutes * 60000);
    this.timer.unref();
  }
  /**
   * One automatic run; when completed days since `backfillFrom` are still uncovered (a pause longer than the 13-day
   * catch-up, or a kind added later), the backfill is started to fill them. A stopped or failed backfill is not restarted
   * by the timer until the next run finds the gap again.
   */
  async scheduledRun(): Promise<SyncOutcome> {
    const outcome = await this.runOnce();
    if (outcome.result === 'ok' && this.backfill?.state !== 'running' && this.backfill?.state !== 'stopping' && this.backfill?.state !== 'stopped' && this.hasGaps()) this.startBackfill();
    return outcome;
  }
  private hasGaps(): boolean {
    try {
      const db = this.open();
      try { return this.plan(db, backfillFrom, addDays(sourceDay(new Date(this.now()).toISOString()), -1)).length > 0; } finally { db.close(); }
    } catch { return false; }
  }
  /** Wait before a repeat, waking early when the backfill is stopped. */
  private async sleepUnlessStopped(ms: number): Promise<void> {
    for (let left = ms; left > 0 && !this.stopRequested; left -= 1000) await this.sleep(Math.min(1000, left));
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
      const energy = await this.projectEnergy(db);
      const outcome = finish('ok'); outcome.energy = energy;
      return outcome;
    } catch (error) {
      const failure = this.failure(error);
      return finish(failure.result, failure.code, failure.retryAt);
    } finally { db?.close(); this.running = false; }
  }
  /** Local recompute of day snapshots (steps, distance, calories) from saved pages (no requests); a failure leaves earlier snapshots and reads intact. */
  /** Projection inputs at the last successful refresh projection of this process and its time; the first run projects the whole window. */
  private projected?: { jobs: Map<string, string>; at: number };
  private async projectEnergy(db: DatabaseSync): Promise<{ published: number; unchanged: number } | 'failed'> {
    const now = this.now(), today = sourceDay(new Date(now).toISOString()), from = this.projectionFrom();
    try {
      const jobs = projectionInputs(db);
      const ranges = this.projected ? changedDays(this.projected.jobs, jobs, sourceDay(new Date(this.projected.at).toISOString()), from, today) : [[from, today] as [string, string]];
      const total = { published: 0, unchanged: 0 };
      for (const [first, last] of ranges) { const part = await publishDayRangeYielding(db, first, last, now); total.published += part.published; total.unchanged += part.unchanged; }
      // after a failure the next run diffs against the last success again, so no change is skipped
      this.projected = { jobs, at: now };
      return total;
    } catch { return 'failed'; }
  }
  /** First day the refresh re-projects: a year back, not before the automatic history start. */
  private projectionFrom(): string {
    const yearBack = addDays(sourceDay(new Date(this.now()).toISOString()), -365);
    return yearBack > backfillFrom ? yearBack : backfillFrom;
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
  startBackfill(from: string = backfillFrom): BackfillStatus {
    if (this.backfill?.state !== 'running' && this.backfill?.state !== 'stopping') {
      const now = new Date(this.now()).toISOString(), through = addDays(sourceDay(now), -1);
      if (!z.iso.date().safeParse(from).success || from < firstSupportedDay || from > through) throw new Error('invalid_range');
      this.stopRequested = false;
      this.backfill = { state: 'running', from, through, startedAt: now, finishedAt: null, current: null, readsThisRun: 0 };
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
    const end = (state: BackfillStatus['state'], code?: string) => { run.state = state; run.current = null; delete run.retrying; run.finishedAt = new Date(this.now()).toISOString(); if (code) run.code = code; };
    // days before the refresh's projection window (the last year, from 2026) get their snapshots from the run's own range
    const projectRun = async (db: DatabaseSync) => {
      const window = this.projectionFrom(), last = addDays(window, -1) < run.through ? addDays(window, -1) : run.through;
      if (run.from <= last) { try { await publishDayRangeYielding(db, run.from, last, this.now()); } catch { /* reads stay saved; the next run projects again */ } }
    };
    let previous = '', failures = 0;
    while (true) {
      if (this.stopRequested) { await this.withStore(projectRun); return end('stopped'); }
      if (this.pausedUntil !== null && this.now() < this.pausedUntil) { run.code = 'rate_limited'; run.retryAt = new Date(this.pausedUntil).toISOString(); await this.sleep(Math.min(this.pausedUntil - this.now(), 60000)); continue; }
      if (this.running) { await this.sleep(1000); continue; }
      this.running = true; let db: DatabaseSync | undefined;
      try {
        delete run.code; delete run.retryAt;
        db = this.open();
        run.readsThisRun += await this.resumeRunning(db);
        const next = this.plan(db, run.from, run.through)[0];
        if (!next) { await this.projectEnergy(db); await projectRun(db); return end('done'); }
        const key = `${next.kind}:${next.first}:${next.last}`;
        // a chunk planned again right after its complete read would repeat forever; stop and report instead
        if (key === previous) return end('error', 'no_progress');
        previous = key; run.current = { kind: next.kind, first: next.first, last: next.last };
        await this.execute(db, next); run.readsThisRun++; failures = 0; delete run.retrying;
      } catch (error) {
        const failure = this.failure(error);
        if (failure.code === 'google_http_429' || failure.code === 'google_identity_http_429') { previous = ''; continue; }
        if (transientFailure(failure.code) && failures < backfillRetryDelaysMs.length) {
          const wait = backfillRetryDelaysMs[failures++]!;
          run.retrying = { attempt: failures, of: backfillRetryDelaysMs.length, at: new Date(this.now() + wait).toISOString(), code: failure.code! };
          previous = '';
          db?.close(); db = undefined; this.running = false;
          await this.sleepUnlessStopped(wait);
          continue;
        }
        delete run.retrying;
        return end('error', failure.code ?? failure.result);
      } finally { db?.close(); this.running = false; }
    }
  }
  /** Run a local store action under the run lock (a refresh does not start while it yields between steps). */
  private async withStore(action: (db: DatabaseSync) => Promise<void>): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { const db = this.open(); try { await action(db); } finally { db.close(); } } catch { /* store unavailable: nothing to project now */ } finally { this.running = false; }
  }
  backfillStatus(): BackfillStatus {
    const through = this.backfill?.through ?? addDays(sourceDay(new Date(this.now()).toISOString()), -1);
    const from = this.backfill?.from ?? backfillFrom;
    const total = Math.max(0, Math.round((Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
    let kinds: BackfillStatus['kinds'] = []; let remainingReads: number | null = null;
    try {
      const db = this.open();
      try {
        const fingerprints = this.fingerprints(db), key = `${from}|${through}|${syncKinds.map((kind) => fingerprints.get(kind) ?? 'none').join(',')}`;
        if (this.progressCache?.key !== key) {
          const covered = this.cachedCoverage(fingerprints);
          this.progressCache = { key, kinds: syncKinds.map((kind) => ({ kind, covered: covered(db, kind, from, through).size, total })), remainingReads: planBackfill(db, from, through, covered).length };
        }
        kinds = this.progressCache.kinds.map((item) => ({ ...item })); remainingReads = this.progressCache.remainingReads;
      } finally { db.close(); }
    } catch { /* store unavailable: progress unknown, not zero */ }
    return { ...(this.backfill ?? { state: 'idle', from, through, startedAt: null, finishedAt: null, current: null, readsThisRun: 0 }), kinds, remainingReads };
  }
  /** Coverage calendar of one year (default: the year of the automatic history start) up to yesterday; null when the store is unavailable (unknown, not uncovered). */
  coverage(year: number = Number(backfillFrom.slice(0, 4))): { from: string; through: string; kinds: number; days: { date: string; covered: number }[] } | null {
    const yesterday = addDays(sourceDay(new Date(this.now()).toISOString()), -1);
    const from = `${String(year).padStart(4, '0')}-01-01`, through = `${String(year).padStart(4, '0')}-12-31` < yesterday ? `${String(year).padStart(4, '0')}-12-31` : yesterday;
    if (from < firstSupportedDay) return null;
    try {
      const db = this.open();
      try { return { from, through, kinds: syncKinds.length, days: through < from ? [] : coverageCalendar(db, from, through, this.cachedCoverage(this.fingerprints(db))) }; } finally { db.close(); }
    } catch { return null; }
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
