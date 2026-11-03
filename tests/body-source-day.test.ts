import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { readBodySourceDay } from '../packages/storage/body-source-day.ts';

test('źródłowe ważenia trafiają do dnia Warszawy bez zgadywania tożsamości lub kompletności', () => {
  const db = new DatabaseSync(':memory:');
  try {
    initializeTakeoutStore(db);
    const header = ['timestamp', 'weight grams', 'data source'];
    db.prepare('INSERT INTO artifacts (kind, digest, content, header) VALUES (?, ?, ?, ?)').run('weight', 'synthetic', Buffer.from('synthetic'), JSON.stringify(header));
    const insert = db.prepare('INSERT INTO artifact_rows VALUES (?, ?, ?)');
    insert.run(1, 0, JSON.stringify(['2026-03-28T23:00:00Z', '70250', 'Example']));
    insert.run(1, 1, JSON.stringify(['2026-03-29T22:00:00Z', '71000', 'Example']));
    insert.run(1, 2, JSON.stringify(['invalid', '72000', 'Example']));
    const result = readBodySourceDay(db, 'weight', '2026-03-29');
    assert.equal(result.rows.length, 1);
    assert.equal(result.matched, 1);
    assert.equal(result.truncated, false);
    assert.equal(result.unassigned, 1);
    assert.equal(result.coverage, 'unknown');
    assert.deepEqual(result.rows[0]?.converted, { status: 'parsed', value: '70.250', unit: 'kg' });
    assert.deepEqual(result.rows[0]?.identity, { status: 'unresolved', reason: 'missing_source' });
  } finally { db.close(); }
});
