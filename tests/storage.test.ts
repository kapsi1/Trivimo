import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { listDays } from '../packages/storage/days.ts';
import { migrateDatabase } from '../packages/storage/migrations.ts';

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
