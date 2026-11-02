import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createApp } from '../apps/server/app.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';
import { daysSchema } from '../packages/contracts/day.ts';

test('SQLite → REST zachowuje brak, zero, uwagę i rewizję', async () => {
  const db = createDemoDatabase();
  const server = createApp(db);
  after(() => { server.close(); db.close(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/days`);
  assert.equal(response.status, 200);
  const days = daysSchema.parse(await response.json());
  assert.deepEqual(days.map(({ value, status }) => [value, status]), [[72.4, 'valid'], [null, 'missing'], [0, 'valid']]);
  assert.equal(days[1]?.note, 'Brak pomiaru');
  assert.equal(days[2]?.revision, 1);
});

test('kontrakt odrzuca wartość bez statusu i brak oznaczony jako zero', () => {
  assert.equal(daysSchema.safeParse([{ date: '2026-01-01', value: 0, status: 'missing', note: '', revision: 1 }]).success, false);
});
