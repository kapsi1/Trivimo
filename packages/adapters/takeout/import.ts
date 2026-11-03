import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_ROWS = 200_000;
const MAX_ENTRIES = 100_000;
const MAX_DEPTH = 32;
const types: Record<string, { kind: string; value: string; file: RegExp }> = {
  'Weight': { kind: 'weight', value: 'weight grams', file: /^weight\.csv$/ },
  'Body Fat': { kind: 'body_fat', value: 'body fat percentage', file: /^body_fat_\d{4}-\d{2}-\d{2}\.csv$/ },
  'Steps': { kind: 'steps', value: 'steps', file: /^steps_\d{4}-\d{2}-\d{2}\.csv$/ },
  'Distance': { kind: 'distance', value: 'distance', file: /^distance_\d{4}-\d{2}-\d{2}\.csv$/ },
  'Calories': { kind: 'total_energy', value: 'calories', file: /^calories_\d{4}-\d{2}-\d{2}\.csv$/ },
  'Active Energy Burned': { kind: 'active_energy', value: 'Kilocalories', file: /^active_energy_burned_\d{4}-\d{2}-\d{2}\.csv$/ },
};

type PlannedFile = { path: string; kind: string; digest: string; rows: number };
export type TakeoutPlan = { root: string; files: PlannedFile[]; pendingId: string | null };
type Content = { bytes: Buffer; header: string[]; rows: string[][]; digest: string };

function within(root: string, path: string): boolean {
  const part = relative(root, path);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

function readContent(root: string, path: string, kind: string): Content {
  const full = join(root, path);
  if (!within(root, full) || lstatSync(full).isSymbolicLink() || !within(root, realpathSync(full))) throw new Error('Niedozwolona ścieżka pliku');
  const descriptor = openSync(full, 'r');
  let bytes: Buffer;
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Plik przekracza limit lub nie jest zwykłym plikiem');
    const buffer = Buffer.allocUnsafe(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > stat.size) throw new Error('Plik zmienił się podczas odczytu');
    bytes = buffer.subarray(0, length);
  } finally { closeSync(descriptor); }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (kind === 'other') return { bytes, header: [], rows: [], digest };
  let records: string[][];
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    let rowCount = 0;
    records = parse(text, { bom: true, skip_empty_lines: true, max_record_size: 65_536,
      on_record: (record: unknown) => {
        if (!Array.isArray(record) || record.length > 256 || ++rowCount > MAX_ROWS + 1) throw new Error('Limit CSV');
        return record;
      },
    }) as string[][];
  } catch { throw new Error('Nieprawidłowy plik CSV lub kodowanie'); }
  const header = records.shift();
  const spec = Object.values(types).find((type) => type.kind === kind);
  if (!spec || !header || header.length > 256 || new Set(header).size !== header.length || header.some((column) => !column.trim()) || !['timestamp', spec.value, 'data source'].every((column) => header.includes(column))) {
    throw new Error('Nieobsługiwany schemat CSV');
  }
  if (records.length > MAX_ROWS || records.some((row) => row.length !== header.length)) throw new Error('Nieprawidłowy zakres CSV');
  return { bytes, header, rows: records, digest };
}

/** Discover only supported files under the explicitly selected directory; never follow links. */
export function planTakeout(directory: string): TakeoutPlan {
  const root = realpathSync(directory);
  if (!lstatSync(root).isDirectory()) throw new Error('Nieprawidłowy katalog eksportu');
  const files: PlannedFile[] = [];
  let entries = 0;
  function visit(current: string, depth: number): void {
    if (depth > MAX_DEPTH) throw new Error('Zbyt wiele poziomów katalogów');
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (++entries > MAX_ENTRIES) throw new Error('Zbyt wiele plików eksportu');
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { visit(path, depth + 1); continue; }
      if (!entry.isFile() || !path.split(sep).includes('Google Health')) continue;
      const group = dirname(path).split(sep).at(-1) ?? '';
      const candidate = dirname(dirname(path)).split(sep).at(-1) === 'Physical Activity_GoogleData' && Object.hasOwn(types, group) ? types[group] : undefined;
      const kind = candidate && candidate.file.test(entry.name) ? candidate.kind : 'other';
      if (files.length >= MAX_FILES) throw new Error('Zbyt wiele plików eksportu');
      const filePath = relative(root, path);
      const content = readContent(root, filePath, kind);
      files.push({ path: filePath, kind, digest: content.digest, rows: content.rows.length });
    }
  }
  visit(root, 0);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!files.length) throw new Error('Nie znaleziono obsługiwanych plików eksportu');
  return { root, files, pendingId: null };
}

/** Resume the saved decisions instead of recalculating a partially executed plan. */
export function previewTakeout(directory: string, db?: DatabaseSync): TakeoutPlan {
  const root = realpathSync(directory);
  const pending = db?.prepare("SELECT id, root FROM import_sessions WHERE state = 'running' ORDER BY rowid LIMIT 1").get();
  if (!pending) return planTakeout(root);
  if (pending.root !== root || typeof pending.id !== 'string') throw new Error('Niedokończony import dotyczy innego katalogu');
  const rows = db!.prepare('SELECT path, kind, digest, row_count FROM import_files WHERE session_id = ? ORDER BY path').all(pending.id);
  const files = rows.map((row) => {
    if (typeof row.path !== 'string' || typeof row.kind !== 'string' || typeof row.digest !== 'string' || typeof row.row_count !== 'number') throw new Error('Nieprawidłowy plan importu');
    return { path: row.path, kind: row.kind, digest: row.digest, rows: row.row_count };
  });
  return { root, files, pendingId: pending.id };
}

/** This isolated P0 store retains artifacts and rows, without claiming canonical metrics. */
export function initializeTakeoutStore(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON');
  const version = db.prepare('PRAGMA user_version').get()?.user_version;
  const appId = db.prepare('PRAGMA application_id').get()?.application_id;
  if ((version === 1 || version === 2 || version === 3 || (version === 4 || version === 5 || version === 6 || version === 7 || version === 8 || version === 9)) && appId === 1414682185) return;
  if (version !== 0 || appId !== 0 || Number(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get()?.count) !== 0) {
    throw new Error('Nieobsługiwana baza importu');
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE import_sessions (id TEXT PRIMARY KEY, root TEXT NOT NULL, state TEXT NOT NULL) STRICT;
      CREATE TABLE import_files (session_id TEXT NOT NULL REFERENCES import_sessions(id), path TEXT NOT NULL, kind TEXT NOT NULL, digest TEXT NOT NULL, row_count INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(session_id, path)) STRICT;
      CREATE TABLE artifacts (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, digest TEXT NOT NULL, content BLOB NOT NULL, header TEXT NOT NULL, UNIQUE(kind, digest)) STRICT;
      CREATE TABLE artifact_rows (artifact_id INTEGER NOT NULL REFERENCES artifacts(id), position INTEGER NOT NULL, fields TEXT NOT NULL, PRIMARY KEY(artifact_id, position)) STRICT;
      PRAGMA application_id = 1414682185;
      PRAGMA user_version = 1;`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function importTakeout(db: DatabaseSync, directory: string, onPreview?: (files: number, rows: number) => void, approvedPlan?: TakeoutPlan, approvedAccountId?: string | null): { files: number; rows: number } {
  const root = realpathSync(directory);
  const pending = db.prepare("SELECT id, root FROM import_sessions WHERE state = 'running' ORDER BY rowid LIMIT 1").get();
  let sessionId: string;
  if (pending) {
    if (pending.root !== root || typeof pending.id !== 'string') throw new Error('Niedokończony import dotyczy innego katalogu');
    if (approvedPlan && approvedPlan.pendingId !== pending.id) throw new Error('Plan importu zmienił się od podglądu');
    sessionId = pending.id;
  } else {
    if (approvedPlan && (approvedPlan.root !== root || approvedPlan.pendingId !== null)) throw new Error('Plan importu zmienił się od podglądu');
    const plan = approvedPlan ?? planTakeout(root);
    onPreview?.(plan.files.length, plan.files.reduce((sum, file) => sum + file.rows, 0));
    sessionId = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("INSERT INTO import_sessions VALUES (?, ?, 'running')").run(sessionId, root);
      if (approvedAccountId) {
        if (![4, 5, 6, 7, 8, 9].includes(Number(db.prepare('PRAGMA user_version').get()?.user_version))) throw new Error('Nieobsługiwana wersja konta');
        db.prepare("INSERT INTO import_account_decisions VALUES (?, 1, ?, 'user_confirmed', ?)").run(sessionId, approvedAccountId, new Date().toISOString());
      }
      const insert = db.prepare('INSERT INTO import_files (session_id, path, kind, digest, row_count) VALUES (?, ?, ?, ?, ?)');
      for (const file of plan.files) insert.run(sessionId, file.path, file.kind, file.digest, file.rows);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const files = db.prepare('SELECT path, kind, digest, row_count, done FROM import_files WHERE session_id = ? ORDER BY path').all(sessionId);
  for (const file of files) {
    if (file.done === 1) continue;
    if (typeof file.path !== 'string' || typeof file.kind !== 'string' || typeof file.digest !== 'string') throw new Error('Nieprawidłowy plan importu');
    const content = readContent(root, file.path, file.kind);
    if (content.digest !== file.digest || content.rows.length !== file.row_count) throw new Error('Plik zmienił się po utworzeniu planu');
    db.exec('BEGIN IMMEDIATE');
    try {
      const insertArtifact = db.prepare('INSERT INTO artifacts (kind, digest, content, header) VALUES (?, ?, ?, ?) ON CONFLICT(kind, digest) DO NOTHING');
      const result = insertArtifact.run(file.kind, content.digest, content.bytes, JSON.stringify(content.header));
      if (result.changes === 1) {
        const insertRow = db.prepare('INSERT INTO artifact_rows VALUES (?, ?, ?)');
        for (const [index, fields] of content.rows.entries()) insertRow.run(result.lastInsertRowid, index, JSON.stringify(fields));
      }
      db.prepare('UPDATE import_files SET done = 1 WHERE session_id = ? AND path = ?').run(sessionId, file.path);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.prepare("UPDATE import_sessions SET state = 'complete' WHERE id = ?").run(sessionId);
  return { files: files.length, rows: files.reduce((sum, file) => sum + Number(file.row_count), 0) };
}
