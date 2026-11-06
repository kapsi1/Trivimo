import { DatabaseSync } from 'node:sqlite';
import { lstatSync } from 'node:fs';
import { z } from 'zod';
import { currentStoreVersion } from '../../packages/storage/canonical-days.ts';
import { dayBounds } from '../../packages/domain/day-zone.ts';
import { readDayZone } from '../../packages/storage/day-zone.ts';
import { createHash } from 'node:crypto';
import { listBodyPage } from '../../packages/adapters/google-health/body-read.ts';
import { googleHttpError } from '../../packages/adapters/google-health/rate-limit.ts';
import { windowRollupPage } from '../../packages/adapters/google-health/window-rollup.ts';
import { dailyRollupPage, dailyRollupTypes, maxRollupDays, type DailyRollupType } from '../../packages/adapters/google-health/daily-rollup.ts';
import { dailySummaryPage, dailySummaryScope, isDailySummaryType, maxDailySummaryDays } from '../../packages/adapters/google-health/daily-summary.ts';
import { isSourceListKind, maxSourceListDays, sourceListPage } from '../../packages/adapters/google-health/source-list.ts';
import { commitGooglePage, createGoogleReadJob, googleJobKinds, isWindowKind, windowJobKinds, type GoogleJobKind } from '../../packages/storage/google-pages.ts';
import type { GoogleAuth } from './google-auth.ts';

const bodyScope = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly';
const activityScope = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
const isDaily = (kind: GoogleJobKind): kind is DailyRollupType => (dailyRollupTypes as readonly string[]).includes(kind);
const scopeFor = (kind: GoogleJobKind) => isDailySummaryType(kind) ? (dailySummaryScope(kind) === 'activity' ? activityScope : bodyScope) : kind === 'weight' || kind === 'body-fat' || kind === 'heart-rate-10m' ? bodyScope : activityScope;
const jobSchema = z.object({ account_digest: z.string().regex(/^[0-9a-f]{64}$/), kind: z.enum(googleJobKinds), range_start: z.string().max(40), range_end: z.string().max(40), cursor: z.string().nullable(), state: z.literal('running') });

/**
 * Account digest per access token. A token belongs to one account for its whole life (another account needs a new
 * authorization and so a new token), so its identity is asked once per token and then reused for every job and page
 * instead of one extra request each. Keyed by a hash of the token, never the token itself; entries expire with the
 * token's usual lifetime and the map is bounded.
 */
const identities = new Map<string, { digest: string; until: number }>();
const identityTtlMs = 50 * 60000;
export function clearIdentityCache(): void { identities.clear(); }

async function accountDigest(token: string, send: typeof fetch): Promise<string> {
  const key = createHash('sha256').update(token).digest('hex'), now = Date.now(), known = identities.get(key);
  if (known && known.until > now) return known.digest;
  const digest = await fetchAccountDigest(token, send);
  if (identities.size >= 16) identities.clear();
  identities.set(key, { digest, until: now + identityTtlMs });
  return digest;
}

async function fetchAccountDigest(token: string, send: typeof fetch): Promise<string> {
  const response = await send('https://health.googleapis.com/v4/users/me/identity', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw googleHttpError('google_identity_http', response);
  const text = await response.text();
  if (text.length > 16384) throw new Error('identity_response_too_large');
  const identity = z.object({ healthUserId: z.string().regex(/^[a-zA-Z0-9-]{1,63}$/) }).parse(JSON.parse(text) as unknown);
  return createHash('sha256').update(identity.healthUserId).digest('hex');
}

export async function startGoogleReadJob(db: DatabaseSync, auth: GoogleAuth, kind: GoogleJobKind, start: string, end: string, send: typeof fetch = fetch): Promise<string> {
  const digest = await auth.withAccessToken(scopeFor(kind), (token) => accountDigest(token, send));
  return createGoogleReadJob(db, digest, kind, start, end);
}

/** Fetch one persisted job page, commit only if the saved cursor is still current. */
export async function readGoogleJobPage(db: DatabaseSync, auth: GoogleAuth, jobId: string, send: typeof fetch = fetch) {
  const row = db.prepare('SELECT account_digest, kind, range_start, range_end, cursor, state FROM google_read_jobs WHERE id = ?').get(jobId);
  if (!row) throw new Error('job_not_found');
  const job = jobSchema.parse(row);
  const page = await auth.withAccessToken(scopeFor(job.kind), async (token) => {
    if (await accountDigest(token, send) !== job.account_digest) throw new Error('account_changed');
    if (isDailySummaryType(job.kind)) return dailySummaryPage({ type: job.kind, start: job.range_start, end: job.range_end, ...(job.cursor ? { pageToken: job.cursor } : {}) }, token, send);
    if (isSourceListKind(job.kind)) return sourceListPage({ kind: job.kind, start: job.range_start, end: job.range_end, ...(job.cursor ? { pageToken: job.cursor } : {}) }, token, send);
    if (isWindowKind(job.kind)) return windowRollupPage({ type: windowJobKinds[job.kind], start: job.range_start, end: job.range_end, ...(job.cursor ? { pageToken: job.cursor } : {}) }, token, send);
    if (isDaily(job.kind)) return dailyRollupPage({ type: job.kind, start: job.range_start, end: job.range_end, ...(job.cursor ? { pageToken: job.cursor } : {}) }, token, send);
    return listBodyPage({ type: job.kind, start: job.range_start, end: job.range_end, ...(job.cursor ? { pageToken: job.cursor } : {}) }, token, send);
  });
  return commitGooglePage(db, jobId, job.cursor, page.rawJson);
}

export class GoogleReadService {
  constructor(private readonly path: string, private readonly auth: GoogleAuth, private readonly send: typeof fetch = fetch) {}
  private open(): DatabaseSync {
    let db: DatabaseSync;
    try {
      const stat = lstatSync(this.path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_store');
      db = new DatabaseSync(this.path);
    } catch { throw new Error('store_unavailable'); }
    if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || db.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { db.close(); throw new Error('migration_required'); }
    return db;
  }
  list() {
    const db = this.open();
    try { return db.prepare('SELECT j.id, j.kind, j.range_start AS start, j.range_end AS end, j.state, j.created_at AS createdAt, (SELECT COUNT(*) FROM google_read_pages p WHERE p.job_id = j.id) AS pages FROM google_read_jobs j ORDER BY j.created_at DESC LIMIT 50').all(); }
    finally { db.close(); }
  }
  /** UTC bounds of one civil date in the store's day zone (for the jobs that hold the bounds of days). */
  dayRange(date: string): { start: string; end: string } {
    const db = this.open();
    try { return { ...dayBounds(date, readDayZone(db)) }; } finally { db.close(); }
  }
  async start(kind: GoogleJobKind, start: string, end: string) {
    if (Date.parse(end) - Date.parse(start) > (isDaily(kind) ? maxRollupDays(kind) : isDailySummaryType(kind) ? maxDailySummaryDays : isSourceListKind(kind) ? maxSourceListDays : isWindowKind(kind) ? 14 : 31) * 86400000) throw new Error('range_too_large');
    const db = this.open();
    try { return { id: await startGoogleReadJob(db, this.auth, kind, start, end, this.send) }; } finally { db.close(); }
  }
  async next(jobId: string) {
    const db = this.open();
    try { return await readGoogleJobPage(db, this.auth, jobId, this.send); } finally { db.close(); }
  }
}
