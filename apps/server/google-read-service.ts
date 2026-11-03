import { DatabaseSync } from 'node:sqlite';
import { lstatSync } from 'node:fs';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { listBodyPage } from '../../packages/adapters/google-health/body-read.ts';
import { commitGooglePage, createGoogleReadJob } from '../../packages/storage/google-pages.ts';
import type { GoogleAuth } from './google-auth.ts';

const scope = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly';
const jobSchema = z.object({ account_digest: z.string().regex(/^[0-9a-f]{64}$/), kind: z.enum(['weight', 'body-fat']), range_start: z.iso.datetime(), range_end: z.iso.datetime(), cursor: z.string().nullable(), state: z.literal('running') });

async function accountDigest(token: string, send: typeof fetch): Promise<string> {
  const response = await send('https://health.googleapis.com/v4/users/me/identity', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`google_identity_http_${response.status}`);
  const text = await response.text();
  if (text.length > 16384) throw new Error('identity_response_too_large');
  const identity = z.object({ healthUserId: z.string().regex(/^[a-zA-Z0-9-]{1,63}$/) }).parse(JSON.parse(text) as unknown);
  return createHash('sha256').update(identity.healthUserId).digest('hex');
}

export async function startGoogleReadJob(db: DatabaseSync, auth: GoogleAuth, kind: 'weight' | 'body-fat', start: string, end: string, send: typeof fetch = fetch): Promise<string> {
  const digest = await auth.withAccessToken(scope, (token) => accountDigest(token, send));
  return createGoogleReadJob(db, digest, kind, start, end);
}

/** Fetch one persisted job page, commit only if the saved cursor is still current. */
export async function readGoogleJobPage(db: DatabaseSync, auth: GoogleAuth, jobId: string, send: typeof fetch = fetch) {
  const row = db.prepare('SELECT account_digest, kind, range_start, range_end, cursor, state FROM google_read_jobs WHERE id = ?').get(jobId);
  if (!row) throw new Error('job_not_found');
  const job = jobSchema.parse(row);
  const page = await auth.withAccessToken(scope, async (token) => {
    if (await accountDigest(token, send) !== job.account_digest) throw new Error('account_changed');
    return listBodyPage({ type: job.kind, start: job.range_start, end: job.range_end, ...(job.cursor ? { pageToken: job.cursor } : {}) }, token, send);
  });
  return commitGooglePage(db, jobId, job.cursor, page.rawJson);
}

export class GoogleReadService {
  constructor(private readonly path: string, private readonly auth: GoogleAuth, private readonly send: typeof fetch = fetch) {}
  private open(): DatabaseSync {
    if (!lstatSync(this.path).isFile() || lstatSync(this.path).isSymbolicLink()) throw new Error('invalid_store');
    const db = new DatabaseSync(this.path);
    if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || db.prepare('PRAGMA user_version').get()?.user_version !== 5) { db.close(); throw new Error('migration_required'); }
    return db;
  }
  list() {
    const db = this.open();
    try { return db.prepare('SELECT j.id, j.kind, j.range_start AS start, j.range_end AS end, j.state, j.created_at AS createdAt, (SELECT COUNT(*) FROM google_read_pages p WHERE p.job_id = j.id) AS pages FROM google_read_jobs j ORDER BY j.created_at DESC LIMIT 50').all(); }
    finally { db.close(); }
  }
  async start(kind: 'weight' | 'body-fat', start: string, end: string) {
    if (Date.parse(end) - Date.parse(start) > 31 * 86400000) throw new Error('range_too_large');
    const db = this.open();
    try { return { id: await startGoogleReadJob(db, this.auth, kind, start, end, this.send) }; } finally { db.close(); }
  }
  async next(jobId: string) {
    const db = this.open();
    try { return await readGoogleJobPage(db, this.auth, jobId, this.send); } finally { db.close(); }
  }
}
