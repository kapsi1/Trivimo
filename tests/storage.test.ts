import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createDemoDatabase, listDays, publishDay } from '../packages/storage/days.ts';
import { migrateDatabase } from '../packages/storage/migrations.ts';
import { backupToNewFile } from '../packages/storage/backup.ts';

test('migracja jest ponawialna, a dane i rewizja przetrwają ponowne otwarcie', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-synthetic-'));
  const path = join(directory, 'example.db');
  try {
    const db = new DatabaseSync(path);
    try {
      migrateDatabase(db);
      migrateDatabase(db);
      db.prepare('INSERT INTO days VALUES (?, ?, ?, ?, ?)').run('2026-01-01', 0, 'valid', 'Potwierdzone zero', 2);
      assert.throws(() => db.prepare('INSERT INTO days VALUES (?, ?, ?, ?, ?)').run('2026-01-02', 0, 'missing', '', 1));
    } finally { db.close(); }
    const reopened = new DatabaseSync(path);
    try {
      migrateDatabase(reopened);
      assert.deepEqual(listDays(reopened), [{ date: '2026-01-01', value: 0, status: 'valid', note: 'Potwierdzone zero', revision: 2 }]);
      assert.equal(reopened.prepare('PRAGMA user_version').get()?.user_version, 1);
    } finally { reopened.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('nieznana wersja bazy jest odrzucana bez modyfikacji', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA user_version = 999');
    assert.throws(() => migrateDatabase(db), /Nieobsługiwana wersja/);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 999);
  } finally { db.close(); }
});

test('błąd tworzenia schematu wycofuje migrację i nie zmienia wersji', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE days (original TEXT)');
    assert.throws(() => migrateDatabase(db));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 0);
    assert.deepEqual(db.prepare('PRAGMA table_info(days)').all().map((column) => column.name), ['original']);
  } finally { db.close(); }
});

test('publikacja dnia zmienia wartość i uwagę razem oraz wykrywa konflikt rewizji', () => {
  const db = createDemoDatabase();
  try {
    const input = { date: '2026-01-02', value: 12, status: 'valid' as const, note: 'Ocena zakończona' };
    assert.deepEqual(publishDay(db, input, 1), { ...input, revision: 2 });
    assert.throws(() => publishDay(db, { ...input, value: 20, note: 'Nieaktualna zmiana' }, 1), /Konflikt/);
    assert.deepEqual(listDays(db).find((day) => day.date === input.date), { ...input, revision: 2 });
    assert.throws(() => publishDay(db, { ...input, date: '2026-01-04' }, 1), /Konflikt/);
    assert.equal(publishDay(db, { ...input, date: '2026-01-04' }, null).revision, 1);
  } finally { db.close(); }
});

test('błąd zapisu nie pozostawia częściowo zmienionej projekcji', () => {
  const db = createDemoDatabase();
  try {
    db.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON days BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    const before = listDays(db);
    assert.throws(() => publishDay(db, { date: '2026-01-02', value: 5, status: 'valid', note: 'Nowa uwaga' }, 1));
    assert.deepEqual(listDays(db), before);
  } finally { db.close(); }
});

test('kopia SQLite daje się odtworzyć i nie nadpisuje istniejącego pliku', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-backup-'));
  const copyPath = join(directory, 'copy.db');
  const restoredPath = join(directory, 'restored.db');
  const db = createDemoDatabase();
  try {
    await backupToNewFile(db, copyPath);
    await assert.rejects(backupToNewFile(db, copyPath), { code: 'EEXIST' });
    const copy = new DatabaseSync(copyPath, { readOnly: true });
    try { await backupToNewFile(copy, restoredPath); } finally { copy.close(); }
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      assert.deepEqual(listDays(restored), listDays(db));
      assert.equal(restored.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    } finally { restored.close(); }
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('nieudana kopia nie pozostawia pliku ani katalogu tymczasowego', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-backup-failure-'));
  const db = createDemoDatabase();
  db.close();
  try {
    await assert.rejects(backupToNewFile(db, join(directory, 'copy.db')));
    assert.deepEqual(readdirSync(directory), []);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
