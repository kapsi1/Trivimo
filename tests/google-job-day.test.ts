import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../apps/server/app.ts';
import type { GoogleReadService } from '../apps/server/google-read-service.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { warsawDay } from './helpers/warsaw-day.ts';

test('REST tworzy zadanie dla doby w strefie magazynu i zachowuje wcześniejszy format zakresu', async () => {
  const calls: string[][] = [];
  const service = { dayRange: (date: string) => ({ ...warsawDay(date) }), start: async (...args: string[]) => { calls.push(args); return { id: 'synthetic' }; } } as unknown as GoogleReadService;
  const db = createDemoDatabase(); const server = createApp(db, undefined, undefined, [], undefined, service);
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    const headers = { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' };
    const post = (body: object) => fetch(`${base}/api/google/jobs`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await post({ kind: 'weight', date: '2026-03-29' })).status, 200);
    assert.equal((await post({ kind: 'body-fat', date: '2026-10-25' })).status, 200);
    assert.equal((await post({ kind: 'weight', start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' })).status, 200);
    assert.equal((await post({ kind: 'weight', date: '1999-12-31' })).status, 400);
    assert.deepEqual(calls, [
      ['weight', '2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'],
      ['body-fat', '2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'],
      ['weight', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'],
    ]);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); db.close(); }
});

test('lista zadań rozróżnia brak magazynu, migrację i nieznany błąd bez ujawniania szczegółów', async () => {
  let failure = 'store_unavailable';
  const service = { list: () => { throw new Error(failure); } } as unknown as GoogleReadService;
  const db = createDemoDatabase(); const server = createApp(db, undefined, undefined, [], undefined, service);
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    for (const [input, expected] of [['store_unavailable', 'store_unavailable'], ['migration_required', 'migration_required'], ['private path', 'google_read_failed']]) {
      failure = input!;
      const response: Response = await fetch(`${base}/api/google/jobs`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: expected });
    }
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); db.close(); }
});
