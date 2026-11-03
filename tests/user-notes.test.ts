import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCanonicalDays, migrateUserNotes, publishCanonicalDay } from '../packages/storage/canonical-days.ts';
import { readUserNote, saveUserNote } from '../packages/storage/user-notes.ts';
import { TakeoutService } from '../apps/server/takeout-service.ts';
import { createApp } from '../apps/server/app.ts';
import { createDemoDatabase } from '../packages/storage/days.ts';

test('notatka ma niezależną historię i nie znika przy przeliczeniu uwag', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-notes-'));
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(directory, 'v1.sqlite'));
    await migrateUserNotes(db, join(directory, 'v2.sqlite'));
    const first = saveUserNote(db, { date: '2026-01-01', content: 'Notatka syntetyczna', expectedRevision: null });
    assert.equal(first.revision, 1);
    assert.deepEqual(saveUserNote(db, { date: first.date, content: first.content, expectedRevision: 1 }), first);
    const missing = { status: 'missing' as const, value: null };
    const input = { date: first.date, metrics: { weight: missing, body_fat: missing, steps: missing, distance: missing, total_energy: missing, active_energy: missing }, issues: [{ metric: 'total_energy' as const, code: 'basal_only' as const, state: 'active' as const }] };
    publishCanonicalDay(db, input, null);
    publishCanonicalDay(db, { ...input, issues: [] }, 1);
    assert.deepEqual(readUserNote(db, first.date), first);
    assert.throws(() => saveUserNote(db, { date: first.date, content: 'Konflikt', expectedRevision: null }), /note_conflict/);
    const cleared = saveUserNote(db, { date: first.date, content: '', expectedRevision: 1 });
    assert.equal(cleared.revision, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_note_versions').get()?.count, 2);
  } finally {
    db.close();
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});

test('zapis notatki przez API wymaga sesji i zgłasza konflikt rewizji', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-notes-api-'));
  const path = join(directory, 'source.sqlite');
  const db = new DatabaseSync(path);
  const demo = createDemoDatabase();
  let source: DatabaseSync | undefined;
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, join(directory, 'v1.sqlite'));
  await migrateUserNotes(db, join(directory, 'v2.sqlite'));
  db.close();
  const server = createApp(demo, () => source ??= new DatabaseSync(path, { readOnly: true }), new TakeoutService(path));
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    const headers = { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' };
    const body = JSON.stringify({ date: '2026-01-01', content: 'Syntetyczna notatka', expectedRevision: null });
    assert.equal((await fetch(`${base}/api/day/note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
    assert.equal((await fetch(`${base}/api/day/note`, { method: 'POST', headers, body })).status, 200);
    assert.equal((await fetch(`${base}/api/day/note`, { method: 'POST', headers, body })).status, 409);
    const response = await fetch(`${base}/api/day?date=2026-01-01`, { headers: { Cookie: cookie } });
    const data = await response.json() as { userNote: { content: string }; snapshot: null };
    assert.equal(data.userNote.content, 'Syntetyczna notatka');
    assert.equal(data.snapshot, null);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    source?.close(); demo.close();
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
