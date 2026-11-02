import assert from 'node:assert/strict';
import { request } from 'node:http';
import { after, test } from 'node:test';
import { createApp } from '../apps/server/app.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { daysSchema } from '../packages/contracts/day.ts';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { DatabaseSync } from 'node:sqlite';

test('SQLite → REST zachowuje brak, zero, uwagę i rewizję', async () => {
  const db = createDemoDatabase();
  const server = createApp(db);
  after(() => { server.close(); db.close(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${base}/api/days`)).status, 401);
  const session = await fetch(`${base}/api/session`);
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const response = await fetch(`${base}/api/days`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const days = daysSchema.parse(await response.json());
  assert.deepEqual(days.map(({ value, status }) => [value, status]), [[72.4, 'valid'], [null, 'missing'], [0, 'valid']]);
  assert.equal(days[1]?.note, 'Brak pomiaru');
  assert.equal(days[2]?.revision, 1);
  const badHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: address.port, path: '/api/days', headers: { Host: 'example.test' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(badHostStatus, 403);
  const badOrigin = await fetch(`http://127.0.0.1:${address.port}/api/days`, { headers: { Origin: 'https://example.test' } });
  assert.equal(badOrigin.status, 403);
  const devOrigin = await fetch(`http://127.0.0.1:${address.port}/api/days`, { headers: { Origin: 'http://127.0.0.1:5173', Cookie: cookie } });
  assert.equal(devOrigin.status, 200);
});

test('kontrakt odrzuca wartość bez statusu i brak oznaczony jako zero', () => {
  assert.equal(daysSchema.safeParse([{ date: '2026-01-01', value: 0, status: 'missing', note: '', revision: 1 }]).success, false);
});

test('serwer ponawia odczyt bazy, która pojawiła się po uruchomieniu', async () => {
  const demo = createDemoDatabase();
  const source = new DatabaseSync(':memory:');
  initializeTakeoutStore(source);
  let available = false;
  const server = createApp(demo, () => available ? source : undefined);
  after(() => { server.close(); demo.close(); source.close(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const options = { headers: { Cookie: cookie } };
  assert.equal((await fetch(`${base}/api/source-records?kind=weight`, options)).status, 503);
  available = true;
  assert.equal((await fetch(`${base}/api/source-records?kind=weight`, options)).status, 200);
});

test('uszkodzony wynik zwraca błąd bez ujawnienia treści rekordu', async () => {
  const db = createDemoDatabase();
  db.prepare('INSERT INTO days VALUES (?, ?, ?, ?, ?)').run('invalid-date', 1, 'valid', 'private content', 1);
  const server = createApp(db);
  after(() => { server.close(); db.close(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const response = await fetch(`${base}/api/days`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'internal_error' });
});

test('chroniony odczyt surowych danych pokazuje tekstowe pola bez kwalifikowania', async () => {
  const demo = createDemoDatabase();
  const source = new DatabaseSync(':memory:');
  initializeTakeoutStore(source);
  source.prepare('INSERT INTO artifacts (kind, digest, content, header) VALUES (?, ?, ?, ?)')
    .run('weight', 'synthetic', Buffer.from('example'), JSON.stringify(['timestamp', 'weight grams', 'data source']));
  source.prepare('INSERT INTO artifact_rows VALUES (?, ?, ?)').run(1, 0, JSON.stringify(['2026-01-01T00:00:00Z', '72500.00', 'Example']));
  const server = createApp(demo, source);
  after(() => { server.close(); demo.close(); source.close(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const response = await fetch(`${base}/api/source-records?kind=weight`, { headers: { Cookie: cookie } });
  assert.deepEqual(await response.json(), { rows: [{ timestamp: '2026-01-01T00:00:00Z', value: '72500.00', source: 'Example', converted: { status: 'parsed', value: '72.50000', unit: 'kg' } }], next: null });
  assert.equal((await fetch(`${base}/api/source-records?kind=weight&after=-1`, { headers: { Cookie: cookie } })).status, 400);
  const insert = source.prepare('INSERT INTO artifact_rows VALUES (?, ?, ?)');
  for (let i = 1; i <= 100; i++) insert.run(1, i, JSON.stringify(['2026-01-01T00:00:00Z', String(i), 'Example']));
  const first = await (await fetch(`${base}/api/source-records?kind=weight`, { headers: { Cookie: cookie } })).json() as { rows: unknown[]; next: number };
  assert.equal(first.rows.length, 100);
  const last = await (await fetch(`${base}/api/source-records?kind=weight&after=${first.next}`, { headers: { Cookie: cookie } })).json() as { rows: unknown[]; next: null };
  assert.equal(last.rows.length, 1);
  assert.equal(last.next, null);
  insert.run(1, 101, JSON.stringify(['2026-01-02T23:00:00-05:00', '80000', 'Example']));
  const dated = await (await fetch(`${base}/api/source-records?kind=weight&date=2026-01-02`, { headers: { Cookie: cookie } })).json() as { rows: { timestamp: string }[] };
  assert.equal(dated.rows.length, 1);
  assert.equal(dated.rows[0]?.timestamp, '2026-01-02T23:00:00-05:00');
  assert.equal((await fetch(`${base}/api/source-records?kind=weight&date=2026-02-30`, { headers: { Cookie: cookie } })).status, 400);
});
