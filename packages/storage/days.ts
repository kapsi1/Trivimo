import { DatabaseSync } from 'node:sqlite';
import { daysSchema, type Day } from '../contracts/day.ts';

// The P0 database contains only synthetic projections, not source health data.
export function createDemoDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE days (
    date TEXT PRIMARY KEY, value REAL, status TEXT NOT NULL,
    note TEXT NOT NULL, revision INTEGER NOT NULL
  ) STRICT`);
  const insert = db.prepare('INSERT INTO days VALUES (?, ?, ?, ?, ?)');
  insert.run('2026-01-01', 72.4, 'valid', '', 1);
  insert.run('2026-01-02', null, 'missing', 'Brak pomiaru', 1);
  insert.run('2026-01-03', 0, 'valid', 'Potwierdzone zero (przykład)', 1);
  return db;
}

export function listDays(db: DatabaseSync): Day[] {
  return daysSchema.parse(db.prepare('SELECT date, value, status, note, revision FROM days ORDER BY date').all());
}
