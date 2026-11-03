import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { userNoteInputSchema, userNoteSchema, type UserNoteInput } from '../contracts/day-snapshot.ts';

export class NoteConflictError extends Error {
  constructor() { super('note_conflict'); }
}

export function readUserNote(db: DatabaseSync, date: string) {
  const day = z.iso.date().parse(date);
  const row = db.prepare('SELECT day AS date, revision, content, created_at AS createdAt FROM user_note_versions WHERE day = ? ORDER BY revision DESC LIMIT 1').get(day);
  return row ? userNoteSchema.parse(row) : null;
}

export function saveUserNote(db: DatabaseSync, input: UserNoteInput) {
  const parsed = userNoteInputSchema.parse(input);
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = readUserNote(db, parsed.date);
    if ((current?.revision ?? null) !== parsed.expectedRevision) throw new NoteConflictError();
    if (current && current.content === parsed.content) { db.exec('COMMIT'); return current; }
    const note = { date: parsed.date, revision: (current?.revision ?? 0) + 1, content: parsed.content, createdAt: new Date().toISOString() };
    db.prepare('INSERT INTO user_note_versions VALUES (?, ?, ?, ?)').run(note.date, note.revision, note.content, note.createdAt);
    db.exec('COMMIT');
    return note;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
