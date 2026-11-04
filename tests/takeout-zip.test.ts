import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { extractZip, isGoogleHealthEntry, listZip } from '../packages/adapters/takeout/zip.ts';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { TakeoutService } from '../apps/server/takeout-service.ts';

/** Minimal synthetic ZIP writer (deflate or stored, optional symlink mode or wrong CRC) for the reader's tests. */
function zip(entries: { name: string; data: string | Buffer; store?: boolean; symlink?: boolean; badCrc?: boolean }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.data), body = entry.store ? data : deflateRawSync(data), name = Buffer.from(entry.name, 'utf8');
    const crc = (crc32(data) + (entry.badCrc ? 1 : 0)) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(entry.store ? 0 : 8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(entry.store ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body); centrals.push(central, name); offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const steps = 'Takeout/Google Health/Physical Activity_GoogleData/Steps/steps_2026-01-01.csv';
const csv = 'timestamp,steps,data source\n2026-01-01T08:00:00Z,120,Example\n';

test('ZIP: lista i rozpakowanie tylko folderu Google Health, z kontrolą CRC i odrzuceniem niebezpiecznych wpisów', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-zip-'));
  try {
    const good = join(dir, 'good.zip');
    writeFileSync(good, zip([{ name: steps, data: csv }, { name: 'Takeout/Google Health/README.txt', data: 'x', store: true }, { name: 'Takeout/Mail/inbox.mbox', data: 'private' }]));
    assert.deepEqual(listZip(good).map((entry) => entry.name), [steps, 'Takeout/Google Health/README.txt', 'Takeout/Mail/inbox.mbox']);
    assert.deepEqual(await extractZip(good, join(dir, 'out'), isGoogleHealthEntry), { files: 2, bytes: csv.length + 1 });
    assert.equal(readFileSync(join(dir, 'out', ...steps.split('/')), 'utf8'), csv);
    assert.equal(existsSync(join(dir, 'out', 'Takeout', 'Mail')), false);
    // extracting again into the same folder never overwrites an existing file
    await assert.rejects(extractZip(good, join(dir, 'out'), isGoogleHealthEntry), /EEXIST/);
    const cases: [string, Parameters<typeof zip>[0], RegExp][] = [
      ['traversal', [{ name: 'Google Health/../../evil.csv', data: 'x' }], /zip_unsafe_path/],
      ['absolute', [{ name: 'C:/Google Health/a.csv', data: 'x' }], /zip_unsafe_path/],
      ['symlink', [{ name: 'Google Health/link', data: '/etc/passwd', store: true, symlink: true }], /zip_symlink/],
      ['crc', [{ name: 'Google Health/a.csv', data: 'abc', badCrc: true }], /zip_checksum/],
      ['bomb', [{ name: 'Google Health/a.csv', data: Buffer.alloc(30 * 1024 * 1024) }], /zip_ratio/],
    ];
    for (const [label, entries, error] of cases) {
      const file = join(dir, `${label}.zip`); writeFileSync(file, zip(entries));
      await assert.rejects(extractZip(file, join(dir, label), isGoogleHealthEntry), error, label);
    }
    writeFileSync(join(dir, 'not.zip'), 'not a zip');
    assert.throws(() => listZip(join(dir, 'not.zip')), /zip_invalid/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('import z archiwum: wysłanie, rozpakowanie, podgląd, zapis i usunięcie plików tymczasowych', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-zip-import-')), path = join(dir, 'takeout-raw.sqlite');
  try {
    const db = new DatabaseSync(path); initializeTakeoutStore(db); db.close();
    const service = new TakeoutService(path);
    await assert.rejects(service.saveUpload(Readable.from([zip([{ name: 'Takeout/Mail/a.mbox', data: 'x' }])])), /no_google_health/);
    const upload = await service.saveUpload(Readable.from([zip([{ name: steps, data: csv }])]));
    assert.equal(upload.entries, 1);
    const preview = await service.previewZip([upload.id]);
    assert.deepEqual([preview.files, preview.rows], [1, 1]);
    // the uploaded archive is gone after extraction; the extracted folder stays until the import succeeds
    assert.deepEqual(readdirSync(join(dir, 'takeout-work', 'uploads')), []);
    assert.equal(readdirSync(join(dir, 'takeout-work', 'extracted')).length, 2);
    assert.deepEqual(service.commit(preview.token), { files: 1, rows: 1 });
    assert.deepEqual(readdirSync(join(dir, 'takeout-work', 'extracted')), []);
    const check = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(check.prepare("SELECT COUNT(*) AS n FROM import_sessions WHERE state = 'complete'").get()?.n, 1); } finally { check.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
