import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCanonicalDays, migrateUserNotes, migrateSourceAccounts, migrateGooglePages, migrateDailyRollups, migrateCalorieJobs, migrateWindowJobs } from '../packages/storage/canonical-days.ts';
import { createGoogleReadJob, commitGooglePage } from '../packages/storage/google-pages.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';
import { GoogleAuth } from '../apps/server/google-auth.ts';
import { GoogleReadService, readGoogleJobPage } from '../apps/server/google-read-service.ts';

test('strona i kursor są atomowe, a wznowienie zachowuje oryginalny JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-google-pages-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
    await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite')); await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite'));
    initializeTakeoutStore(db);
    const job = createGoogleReadJob(db, 'a'.repeat(64), 'weight', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    const raw = '{"dataPoints":[{"value":9007199254740993}],"nextPageToken":"next"}';
    assert.deepEqual(commitGooglePage(db, job, null, raw), { complete: false, pageNumber: 1 });
    assert.equal(db.prepare('SELECT raw_json FROM google_read_pages').get()?.raw_json, raw);
    assert.throws(() => commitGooglePage(db, job, null, '{}'), /job_conflict/);
    assert.throws(() => commitGooglePage(db, job, 'next', '{"nextPageToken":"next"}'), /cursor_cycle/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM google_read_pages').get()?.n, 1);
    assert.deepEqual(commitGooglePage(db, job, 'next', '{}'), { complete: true, pageNumber: 2 });
    assert.throws(() => commitGooglePage(db, job, null, '{}'), /job_conflict/);
    const { createHash } = await import('node:crypto');
    const second = createGoogleReadJob(db, createHash('sha256').update('synthetic-account').digest('hex'), 'body-fat', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    const auth = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, async () => Response.json({ access_token: 'private', expires_in: 3600, scope: 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly' }));
    const url = new URL(auth.start()); await auth.finish(url.searchParams.get('state'), 'code');
    await assert.rejects(readGoogleJobPage(db, auth, second, async (address) => String(address).endsWith('/identity') ? Response.json({ healthUserId: 'synthetic-account' }) : new Response('', { status: 503 })), /google_http_503/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM google_read_pages WHERE job_id = ?').get(second)?.n, 0);
    await assert.rejects(readGoogleJobPage(db, auth, second, async () => Response.json({ healthUserId: 'different-account' })), /account_changed/);
    assert.deepEqual(await readGoogleJobPage(db, auth, second, async (address) => String(address).endsWith('/identity') ? Response.json({ healthUserId: 'synthetic-account' }) : new Response('{"dataPoints":[]}')), { complete: true, pageNumber: 1 });
    const { createApp } = await import('../apps/server/app.ts'); const { createDemoDatabase } = await import('../packages/storage/days.ts');
    const mock: typeof fetch = async (address) => String(address).endsWith('/identity') ? Response.json({ healthUserId: 'synthetic-account' }) : Response.json({ dataPoints: [{ value: 'private-synthetic' }] });
    const demo = createDemoDatabase(); const server = createApp(demo, db, undefined, [], auth, new GoogleReadService(path, auth, mock));
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`; const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
      const headers = { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' };
      const input = JSON.stringify({ kind: 'weight', start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' });
      assert.equal((await fetch(`${base}/api/google/jobs`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: input })).status, 403);
      const created = await fetch(`${base}/api/google/jobs`, { method: 'POST', headers, body: input }); assert.equal(created.status, 200);
      const range = await fetch(`${base}/api/google/jobs`, { method: 'POST', headers, body: JSON.stringify({ kind: 'total-calories', start: '2026-03-01', end: '2026-03-15' }) }); assert.equal(range.status, 200);
      assert.equal((await fetch(`${base}/api/google/jobs`, { method: 'POST', headers, body: JSON.stringify({ kind: 'total-calories', start: '2026-03-01', end: '2026-03-16' }) })).status, 400);
      assert.equal((await fetch(`${base}/api/google/jobs`, { method: 'POST', headers, body: JSON.stringify({ kind: 'steps', start: '2026-03-01T00:00:00Z', end: '2026-03-02T00:00:00Z' }) })).status, 400);
      const { id } = await created.json() as { id: string }; const saved = await fetch(`${base}/api/google/jobs/next`, { method: 'POST', headers, body: JSON.stringify({ id }) });
      assert.equal(saved.status, 200); assert.doesNotMatch(await saved.text(), /private-synthetic/);
      const list = await fetch(`${base}/api/google/jobs`, { headers: { Cookie: cookie } }); assert.doesNotMatch(await list.text(), /private-synthetic|account_digest/);
      const share = await fetch(`${base}/api/google/band-share-range?from=2026-03-01&to=2026-03-03`, { headers: { Cookie: cookie } }); assert.equal(share.status, 200); assert.equal(((await share.json()) as unknown[]).length, 3);
      assert.equal((await fetch(`${base}/api/google/band-share-range?from=2026-01-01&to=2027-06-01`, { headers: { Cookie: cookie } })).status, 400);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); demo.close(); }
    verifyTakeout(path);
    db.prepare("UPDATE google_read_pages SET raw_json = '{}' WHERE job_id = ? AND page_number = 1").run(job);
    assert.throws(() => verifyTakeout(path), /invalid_google_page/);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
