import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { migrateCanonicalDays, migrateSourceAccounts, migrateUserNotes } from '../packages/storage/canonical-days.ts';
import { resolveArtifactAccount } from '../packages/storage/source-accounts.ts';
import { readBodySourceDay } from '../packages/storage/body-source-day.ts';
import { TakeoutService } from '../apps/server/takeout-service.ts';

test('konto jest przypisywane tylko po potwierdzeniu, a nieprzypisany import nie jest utożsamiany', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-accounts-'));
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    const content = Buffer.from('synthetic');
    const digest = createHash('sha256').update(content).digest('hex');
    db.prepare('INSERT INTO artifacts (kind, digest, content, header) VALUES (?, ?, ?, ?)').run('weight', digest, content, JSON.stringify(['timestamp', 'weight grams', 'data source']));
    db.prepare('INSERT INTO artifact_rows VALUES (?, ?, ?)').run(1, 0, JSON.stringify(['2026-01-01T00:00:00Z', '70000', 'Example']));
    const session = db.prepare("INSERT INTO import_sessions VALUES (?, ?, 'complete')");
    const file = db.prepare('INSERT INTO import_files (session_id, path, kind, digest, row_count, done) VALUES (?, ?, ?, ?, ?, 1)');
    session.run('first', 'synthetic-a'); file.run('first', 'weight.csv', 'weight', digest, 1);
    session.run('second', 'synthetic-b'); file.run('second', 'weight.csv', 'weight', digest, 1);
    await migrateCanonicalDays(db, join(directory, 'v1.sqlite'));
    await migrateUserNotes(db, join(directory, 'v2.sqlite'));
    await assert.rejects(migrateSourceAccounts(db, join(directory, 'denied.sqlite'), false));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 3);
    await migrateSourceAccounts(db, join(directory, 'v3.sqlite'), true);
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 4);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM source_accounts').get()?.count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_account_decisions').get()?.count, 2);
    assert.ok(resolveArtifactAccount(db, 1));
    assert.equal(readBodySourceDay(db, 'weight', '2026-01-01').rows[0]?.identity.status, 'candidate');
    session.run('unassigned', 'synthetic-c'); file.run('unassigned', 'weight.csv', 'weight', digest, 1);
    assert.equal(resolveArtifactAccount(db, 1), null);
    assert.equal(readBodySourceDay(db, 'weight', '2026-01-01').rows[0]?.identity.status, 'unresolved');
  } finally {
    db.close();
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});

test('nowy import dostaje konto wyłącznie po jawnym wyborze i zachowuje decyzję przy wznowieniu', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivimo-account-import-'));
  const exportRoot = join(directory, 'Google Health');
  const weight = join(exportRoot, 'Physical Activity_GoogleData', 'Weight');
  const path = join(directory, 'source.sqlite');
  mkdirSync(weight, { recursive: true });
  const file = join(weight, 'weight.csv');
  const content = 'timestamp,weight grams,data source\n2026-01-01T00:00:00Z,70000,Example\n';
  writeFileSync(file, content);
  const db = new DatabaseSync(path);
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(directory, 'v1.sqlite'));
    await migrateUserNotes(db, join(directory, 'v2.sqlite'));
    await migrateSourceAccounts(db, join(directory, 'v3.sqlite'), true);
    const service = new TakeoutService(path);
    const preview = await service.preview(exportRoot, true);
    assert.equal(preview.accountLinked, true);
    writeFileSync(file, content.replace('70000', '71000'));
    await assert.rejects(service.commit(preview.token), /zmienił/);
    writeFileSync(file, content);
    const resumed = await service.preview(exportRoot);
    assert.equal(resumed.resuming, true);
    assert.equal(resumed.accountLinked, true);
    await service.commit(resumed.token);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_account_decisions').get()?.count, 1);
    const unassigned = await service.preview(exportRoot);
    assert.equal(unassigned.accountLinked, false);
    await service.commit(unassigned.token);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_sessions').get()?.count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_account_decisions').get()?.count, 1);
    assert.equal(resolveArtifactAccount(db, 1), null);
    const assignment = service.previewAccountAssignment();
    assert.equal(assignment.count, 1);
    assert.ok(assignment.token);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM import_account_decisions').get()?.count, 1);
    const later = await service.preview(exportRoot);
    await service.commit(later.token);
    assert.deepEqual(service.commitAccountAssignment(assignment.token), { assigned: 1 });
    assert.throws(() => service.commitAccountAssignment(assignment.token!), /preview_expired/);
    assert.equal(service.previewAccountAssignment().count, 1);
    const conflict = service.previewAccountAssignment();
    db.prepare("INSERT INTO import_account_decisions SELECT id, 1, (SELECT id FROM source_accounts LIMIT 1), 'user_confirmed', '2026-01-01T00:00:00Z' FROM import_sessions WHERE id NOT IN (SELECT session_id FROM import_account_decisions)").run();
    assert.throws(() => service.commitAccountAssignment(conflict.token!), /account_plan_changed/);
  } finally {
    db.close();
    unlinkSync(file); rmdirSync(weight); rmdirSync(join(exportRoot, 'Physical Activity_GoogleData')); rmdirSync(exportRoot);
    for (const fileName of readdirSync(directory)) unlinkSync(join(directory, fileName));
    rmdirSync(directory);
  }
});
