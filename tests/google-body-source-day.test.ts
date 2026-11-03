import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { readGoogleBodySourceDay } from '../packages/storage/google-body-source-day.ts';

test('przegląd wybiera tylko nakładające się strony, dzień Warszawy i dokładny oryginał', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE google_read_jobs(id TEXT, account_digest TEXT, kind TEXT, range_start TEXT, range_end TEXT, created_at TEXT); CREATE TABLE google_read_pages(job_id TEXT, page_number INTEGER, raw_json TEXT);`);
    const job = db.prepare('INSERT INTO google_read_jobs VALUES (?, ?, ?, ?, ?, ?)');
    const page = db.prepare('INSERT INTO google_read_pages VALUES (?, ?, ?)');
    job.run('one', 'a', 'weight', '2026-03-28T00:00:00Z', '2026-03-30T00:00:00Z', '2026-04-01T00:00:00Z');
    page.run('one', 1, '{"dataPoints":[{"name":"users/synthetic/dataTypes/weight/dataPoints/1","dataSource":{"platform":"SYNTHETIC"},"weight":{"sampleTime":{"physicalTime":"2026-03-28T23:00:00Z"},"weightGrams":9007199254740993}},{"weight":{"sampleTime":{"physicalTime":"2026-03-29T22:00:00Z"},"weightGrams":70000}}]}');
    job.run('unrelated', 'b', 'weight', '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z', '2026-04-02T00:00:00Z');
    page.run('unrelated', 1, 'invalid JSON must not be read');
    const result = readGoogleBodySourceDay(db, 'weight', '2026-03-29');
    assert.equal(result.matched, 1); assert.equal(result.unassigned, 0); assert.equal(result.multipleAccounts, false);
    assert.equal(result.rows[0]?.originalValue, '9007199254740993');
    assert.deepEqual(result.rows[0]?.converted, { status: 'parsed', value: '9007199254740.993', unit: 'kg' });
    assert.equal(result.rows[0]?.identity, 'identified');
    assert.equal(JSON.stringify(result).includes('users/synthetic'), false);
  } finally { db.close(); }
});

test('tłuszcz, błędna wartość i nierozstrzygnięta tożsamość pozostają jawne', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE google_read_jobs(id TEXT, account_digest TEXT, kind TEXT, range_start TEXT, range_end TEXT, created_at TEXT); CREATE TABLE google_read_pages(job_id TEXT, page_number INTEGER, raw_json TEXT);`);
    db.prepare('INSERT INTO google_read_jobs VALUES (?, ?, ?, ?, ?, ?)').run('one', 'a', 'body-fat', '2026-01-01T00:00:00Z', '2026-01-03T00:00:00Z', '2026-01-04T00:00:00Z');
    db.prepare('INSERT INTO google_read_pages VALUES (?, ?, ?)').run('one', 1, '{"dataPoints":[{"bodyFat":{"sampleTime":{"physicalTime":"2026-01-01T12:00:00Z"},"percentage":0}},{"bodyFat":{"sampleTime":{"physicalTime":"invalid"},"percentage":10}}]}');
    const result = readGoogleBodySourceDay(db, 'body_fat', '2026-01-01');
    assert.deepEqual(result.rows[0]?.converted, { status: 'parsed', value: '0', unit: '%' });
    assert.equal(result.rows[0]?.identity, 'unresolved'); assert.equal(result.unassigned, 1); assert.equal(result.coverage, 'unknown');
  } finally { db.close(); }
});

test('REST nie ujawnia identyfikatorów konta ani źródłowego rekordu', async () => {
  const { createApp } = await import('../apps/server/app.ts'); const { createDemoDatabase } = await import('../packages/storage/days.ts');
  const db = new DatabaseSync(':memory:'); const demo = createDemoDatabase();
  db.exec(`CREATE TABLE google_read_jobs(id TEXT, account_digest TEXT, kind TEXT, range_start TEXT, range_end TEXT, created_at TEXT); CREATE TABLE google_read_pages(job_id TEXT, page_number INTEGER, raw_json TEXT); PRAGMA user_version = 5;`);
  db.prepare('INSERT INTO google_read_jobs VALUES (?, ?, ?, ?, ?, ?)').run('job-private', 'account-private', 'weight', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z');
  db.prepare('INSERT INTO google_read_pages VALUES (?, ?, ?)').run('job-private', 1, '{"dataPoints":[{"name":"record-private","weight":{"sampleTime":{"physicalTime":"2026-01-01T12:00:00Z"},"weightGrams":70000}}]}');
  const server = createApp(demo, db);
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`; const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    assert.equal((await fetch(`${base}/api/google/body-candidates?kind=weight&date=2026-01-01`)).status, 401);
    const response = await fetch(`${base}/api/google/body-candidates?kind=weight&date=2026-01-01`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200); const body = await response.text();
    assert.doesNotMatch(body, /record-private|account-private|job-private/);
    assert.equal((JSON.parse(body) as { matched: number }).matched, 1);
    assert.equal((await fetch(`${base}/api/google/body-candidates?kind=weight&date=2025-12-31`, { headers: { Cookie: cookie } })).status, 400);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); db.close(); demo.close(); }
});
