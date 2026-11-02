import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { importTakeout, initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'trivimo-takeout-'));
  const activity = join(root, 'Google Health', 'Physical Activity_GoogleData');
  const weightDir = join(activity, 'Weight');
  const energyDir = join(activity, 'Calories');
  mkdirSync(weightDir, { recursive: true });
  mkdirSync(energyDir, { recursive: true });
  const weight = join(weightDir, 'weight.csv');
  const energy = join(energyDir, 'calories_2026-01-01.csv');
  writeFileSync(weight, 'timestamp,weight grams,data source\n2026-01-01T06:00:00Z,72500,Example\n');
  writeFileSync(energy, 'timestamp,calories,data source\n2026-01-01T00:00:00Z,0,Example\n');
  return { root, weight, energy };
}

test('import zachowuje oryginały, tekstowe pola i nie powiela identycznych plików', () => {
  const sample = fixture();
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    let preview = '';
    assert.deepEqual(importTakeout(db, sample.root, (files, rows) => { preview = `${files}/${rows}`; }), { files: 2, rows: 2 });
    assert.equal(preview, '2/2');
    const artifact = db.prepare("SELECT content, header FROM artifacts WHERE kind = 'weight'").get();
    assert.ok(artifact?.content instanceof Uint8Array);
    assert.deepEqual(Buffer.from(artifact.content), readFileSync(sample.weight));
    assert.equal(artifact.header, JSON.stringify(['timestamp', 'weight grams', 'data source']));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM artifact_rows').get()?.count, 2);
    importTakeout(db, sample.root);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM artifacts').get()?.count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM artifact_rows').get()?.count, 2);
  } finally { db.close(); rmSync(sample.root, { recursive: true, force: true }); }
});

test('wznowienie zachowuje plan i odrzuca plik zmieniony po przerwaniu', () => {
  const sample = fixture();
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    db.exec("CREATE TRIGGER stop_weight BEFORE INSERT ON artifacts WHEN NEW.kind = 'weight' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    assert.throws(() => importTakeout(db, sample.root));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM artifacts').get()?.count, 1);
    db.exec('DROP TRIGGER stop_weight');
    const original = readFileSync(sample.weight);
    writeFileSync(sample.weight, 'timestamp,weight grams,data source\nchanged,1,Example\n');
    assert.throws(() => importTakeout(db, sample.root), /zmienił/);
    writeFileSync(sample.weight, original);
    assert.deepEqual(importTakeout(db, sample.root), { files: 2, rows: 2 });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM artifacts').get()?.count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM import_sessions WHERE state = 'complete'").get()?.count, 1);
  } finally { db.close(); rmSync(sample.root, { recursive: true, force: true }); }
});

test('nieznany schemat i obca baza są odrzucane', () => {
  const sample = fixture();
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    writeFileSync(sample.weight, 'timestamp,unknown,data source\n2026-01-01,1,Example\n');
    assert.throws(() => importTakeout(db, sample.root), /schemat/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_sessions').get()?.count, 0);
    const other = new DatabaseSync(':memory:');
    try { other.exec('CREATE TABLE something (value TEXT)'); assert.throws(() => initializeTakeoutStore(other)); }
    finally { other.close(); }
  } finally { db.close(); rmSync(sample.root, { recursive: true, force: true }); }
});

test('import zachowuje cytowane pola CSV i odrzuca uszkodzone lub zbyt duże pliki', () => {
  const sample = fixture();
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    writeFileSync(sample.weight, '\uFEFFtimestamp,weight grams,data source\r\n2026-01-01T00:00:00Z,1,"Example, ""source""\nline"\r\n');
    importTakeout(db, sample.root);
    const row = db.prepare("SELECT r.fields FROM artifact_rows r JOIN artifacts a ON a.id = r.artifact_id WHERE a.kind = 'weight'").get();
    assert.deepEqual(JSON.parse(String(row?.fields)), ['2026-01-01T00:00:00Z', '1', 'Example, "source"\nline']);
    writeFileSync(sample.weight, 'timestamp,weight grams,data source\n2026-01-01,1,"unfinished');
    assert.throws(() => importTakeout(db, sample.root), /CSV/);
    truncateSync(sample.weight, 32 * 1024 * 1024 + 1);
    assert.throws(() => importTakeout(db, sample.root), /limit/);
  } finally { db.close(); rmSync(sample.root, { recursive: true, force: true }); }
});

test('pozostałe pliki Google Health są zachowane jako oryginały bez interpretacji', () => {
  const sample = fixture();
  const otherDir = join(sample.root, 'Google Health', 'Other');
  mkdirSync(otherDir, { recursive: true });
  const extra = join(otherDir, 'other.csv');
  const bytes = Buffer.from('nieznany format\n"niedomknięty', 'utf8');
  writeFileSync(extra, bytes);
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    assert.deepEqual(importTakeout(db, sample.root), { files: 3, rows: 2 });
    const raw = db.prepare("SELECT content, header FROM artifacts WHERE kind = 'other'").get();
    assert.ok(raw?.content instanceof Uint8Array);
    assert.deepEqual(Buffer.from(raw.content), bytes);
    assert.equal(raw.header, '[]');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM artifact_rows').get()?.count, 2);
  } finally { db.close(); rmSync(sample.root, { recursive: true, force: true }); }
});
