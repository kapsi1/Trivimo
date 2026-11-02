import { DatabaseSync } from 'node:sqlite';
import { daySchema, daysSchema, type Day } from '../contracts/day.ts';
import { migrateDatabase } from './migrations.ts';

// The P0 database contains only synthetic projections, not source health data.
export function createDemoDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrateDatabase(db);
  const insert = db.prepare('INSERT INTO days VALUES (?, ?, ?, ?, ?)');
  insert.run('2026-01-01', 72.4, 'valid', '', 1);
  insert.run('2026-01-02', null, 'missing', 'Brak pomiaru', 1);
  insert.run('2026-01-03', 0, 'valid', 'Potwierdzone zero (przykład)', 1);
  return db;
}

export function listDays(db: DatabaseSync): Day[] {
  return daysSchema.parse(db.prepare('SELECT date, value, status, note, revision FROM days ORDER BY date').all());
}

/** Atomically publish value, quality and note, rejecting updates based on an old revision. */
export function publishDay(db: DatabaseSync, input: Omit<Day, 'revision'>, expectedRevision: number | null): Day {
  const nextRevision = expectedRevision === null ? 1 : expectedRevision + 1;
  const day = daySchema.parse({ ...input, revision: nextRevision });
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT revision FROM days WHERE date = ?').get(day.date);
    if ((current?.revision ?? null) !== expectedRevision) throw new Error('Konflikt rewizji dnia');
    db.prepare(`INSERT INTO days (date, value, status, note, revision) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET value = excluded.value, status = excluded.status,
      note = excluded.note, revision = excluded.revision`)
      .run(day.date, day.value, day.status, day.note, day.revision);
    db.exec('COMMIT');
    return day;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
