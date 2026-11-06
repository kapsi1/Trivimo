import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { inspectCsv, parseDay, parseMappedCsv, ungroupDigits } from '../packages/adapters/csv/mapped-csv.ts';
import { guessDecimal } from '../packages/adapters/csv/decimal.ts';
import { initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import type { CsvMapping } from '../packages/contracts/csv-import.ts';
import { warsawDay } from './helpers/warsaw-day.ts';
import { toText } from '../packages/domain/rational.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateCsvImports, migrateCsvNotes, migratePageWindows, migrateDailySummaries, migrateDayZone, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceAccounts, migrateSourceLists, migrateUserNotes, migrateWindowJobs, readCanonicalDay } from '../packages/storage/canonical-days.ts';
import { csvDayOrigin, csvDayValues, decideCsvImport, saveCsvImport } from '../packages/storage/csv-imports.ts';
import { readUserNote, saveUserNote } from '../packages/storage/user-notes.ts';
import { compareGoogleDays, publishGoogleDays } from '../packages/storage/google-day-snapshots.ts';
import { commitGooglePage, createGoogleReadJob } from '../packages/storage/google-pages.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';
import { CsvImportService } from '../apps/server/csv-import-service.ts';
import { createApp } from '../apps/server/app.ts';

const base: CsvMapping = { delimiter: ',', header: true, decimal: '.', date: { column: 0, format: 'YYYY-MM-DD' }, time: null, dailyRows: 'single', metrics: {} };
const today = '2026-11-04';
const text = (value: ReturnType<typeof toText>) => `${value.numerator}/${value.denominator}`;

test('CSV: formaty daty, strefa ISO przypisana do doby warszawskiej, odrzucenie nieistniejącej daty', () => {
  assert.deepEqual(parseDay('2024-03-05', 'YYYY-MM-DD', 'Europe/Warsaw'), { day: '2024-03-05', time: null });
  assert.deepEqual(parseDay('5.3.2024', 'DD.MM.YYYY', 'Europe/Warsaw'), { day: '2024-03-05', time: null });
  assert.deepEqual(parseDay('03/05/2024', 'MM/DD/YYYY', 'Europe/Warsaw'), { day: '2024-03-05', time: null });
  assert.deepEqual(parseDay('03/05/2024', 'DD/MM/YYYY', 'Europe/Warsaw'), { day: '2024-05-03', time: null });
  assert.equal(parseDay('2024-02-30', 'YYYY-MM-DD', 'Europe/Warsaw'), null);
  // 23:30 UTC on the last day of March (summer time) is already 1 April in Warsaw; without an offset the written date counts
  assert.equal(parseDay('2024-03-31T23:30:00Z', 'ISO_DATETIME', 'Europe/Warsaw')?.day, '2024-04-01');
  assert.equal(parseDay('2024-03-31 23:30', 'ISO_DATETIME', 'Europe/Warsaw')?.day, '2024-03-31');
  assert.equal(parseDay('2024-10-27T00:30:00+0200', 'ISO_DATETIME', 'Europe/Warsaw')?.day, '2024-10-27');
});

test('CSV: wykrycie separatora, BOM, cudzysłowy i przecinek dziesiętny; jednostki przeliczone dokładnie, pusta komórka to brak', () => {
  const file = '﻿Data;Waga [lb];Kroki;Dystans mi;Energia kJ;Tłuszcz\n2024-01-01;"176,5";8000;"1,5";8368;0,2\n2024-01-02;;0;;;1,2\n2024-01-03;abc;12,5;1;1;0,1\n2027-01-01;80;1;1;1;0,1\n';
  const info = inspectCsv(file);
  assert.equal(info.delimiter, ';'); assert.equal(info.columns, 6); assert.equal(info.rows, 5); assert.equal(info.head[0]?.[0], 'Data');
  const mapping: CsvMapping = { ...base, delimiter: ';', decimal: ',', metrics: { weight: { column: 1, unit: 'lb' }, steps: { column: 2, unit: 'count' }, distance: { column: 3, unit: 'mi' }, total_energy: { column: 4, unit: 'kJ' }, body_fat: { column: 5, unit: 'fraction' } } };
  const parsed = parseMappedCsv(file, mapping, today, 'Europe/Warsaw');
  const first = parsed.values.filter((value) => value.row === 2);
  const of = (metric: string) => text(toText(first.find((value) => value.metric === metric)!.value));
  assert.equal(of('weight'), '16011810661/200000000'); // 176.5 lb × 0.45359237 = 80.059053305 kg (exact)
  assert.equal(of('distance'), '37719/15625'); // 1.5 mi = 2.414016 km
  assert.equal(of('total_energy'), '2000/1'); // 8368 kJ / 4.184
  assert.equal(of('body_fat'), '20/1');
  // an explicit 0 stays a value; empty cells are absence (counted, never 0)
  assert.equal(text(toText(parsed.values.find((value) => value.row === 3 && value.metric === 'steps')!.value)), '0/1');
  assert.equal(parsed.empty, 3);
  assert.deepEqual(parsed.rejected.map((item) => [item.row, item.metric, item.reason]), [
    [3, 'body_fat', 'out_of_range'], [4, 'weight', 'invalid_number'], [4, 'steps', 'not_integer'], [5, null, 'date_out_of_range'],
  ]);
  assert.throws(() => parseMappedCsv('a,"b\n', base, today, 'Europe/Warsaw'), /invalid_csv/);
});

async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-csv-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
  await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
  await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite'));
  await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite')); await migrateCsvNotes(db, join(dir, 'v11.sqlite')); await migratePageWindows(db, join(dir, 'v12.sqlite')); await migrateDayZone(db, join(dir, 'v13.sqlite')); await migrateDailySummaries(db, join(dir, 'v14.sqlite'));
  return { dir, path, db, dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const save = (db: DatabaseSync, content: string, mapping: CsvMapping) => saveCsvImport(db, { fileName: 'syntetyczny.csv', content, mapping, parsed: parseMappedCsv(content, mapping, today, 'Europe/Warsaw'), now: '2026-11-04T10:00:00.000Z' });

test('CSV w magazynie: idempotentny zapis, średnia unikalnych ważeń, konflikt sum dobowych, suma z wyboru i wykluczenie importu', async () => {
  const env = await store();
  try {
    const weights: CsvMapping = { ...base, time: 1, metrics: { weight: { column: 2, unit: 'kg' } } };
    const file = 'date,time,kg\n2025-05-01,07:00,80.0\n2025-05-01,07:00,80.0\n2025-05-01,19:00,81.0\n';
    const first = save(env.db, file, weights);
    assert.deepEqual(save(env.db, file, weights), { id: first.id, created: false, notes: 0 });
    // the copy from another file (same day, time and value) counts once; mean of 80.0 and 81.0
    save(env.db, 'date,time,kg\n2025-05-01,07:00,80\n', weights);
    const steps: CsvMapping = { ...base, metrics: { steps: { column: 1, unit: 'count' } } };
    save(env.db, 'date,steps\n2025-05-01,5000\n2025-05-02,100\n2025-05-02,200\n', steps);
    const summed = save(env.db, 'date,steps\n2025-05-03,100\n2025-05-03,200\n', { ...steps, dailyRows: 'sum' });
    const days = csvDayValues(env.db, '2025-05-01', '2025-05-31');
    const weight = days.get('2025-05-01')?.weight;
    assert.equal(weight?.status, 'valid'); assert.equal(weight && weight.value && text(toText(weight.value)), '161/2');
    assert.equal(days.get('2025-05-02')?.steps?.status, 'conflict');
    assert.equal(days.get('2025-05-03')?.steps?.value && text(toText(days.get('2025-05-03')!.steps!.value!)), '300/1');
    // two files that disagree on one day's total are a conflict, not a sum or the newer file
    save(env.db, 'date,steps\n2025-05-01,5200\n', steps);
    assert.equal(csvDayValues(env.db, '2025-05-01', '2025-05-01').get('2025-05-01')?.steps?.status, 'conflict');
    assert.deepEqual(decideCsvImport(env.db, summed.id, 'excluded', '2026-11-04T11:00:00.000Z'), { first: '2025-05-03', last: '2025-05-03', notes: 0 });
    assert.equal(csvDayValues(env.db, '2025-05-03', '2025-05-03').size, 0);
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM csv_import_decisions WHERE import_id = ?').get(summed.id)?.n, 2);
    verifyTakeout(env.path);
  } finally { env.dispose(); }
});

const digest = createHash('sha256').update('synthetic-account').digest('hex');
const civil = (date: string) => { const [year, month, day] = date.split('-').map(Number); return { date: { year, month, day } }; };
const next = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

test('CSV uzupełnia tylko braki Google: wartość Google zostaje, brak jest wypełniony, doba tylko z CSV powstaje, wykluczenie czyści', async () => {
  const env = await store();
  try {
    // Google: steps of 2025-06-01 read with a value; weight of that day read with no measurement (missing)
    const steps = createGoogleReadJob(env.db, digest, 'steps', '2025-06-01', '2025-06-02');
    commitGooglePage(env.db, steps, null, JSON.stringify({ rollupDataPoints: [{ civilStartTime: civil('2025-06-01'), civilEndTime: civil(next('2025-06-01')), steps: { countSum: '7000' } }] }));
    const weight = createGoogleReadJob(env.db, digest, 'weight', warsawDay('2025-06-01').start, warsawDay('2025-06-01').end);
    commitGooglePage(env.db, weight, null, '{}');
    const nowMs = Date.parse('2026-11-04T10:00:00Z');
    const mapping: CsvMapping = { ...base, metrics: { steps: { column: 1, unit: 'count' }, weight: { column: 2, unit: 'kg' } } };
    const imported = save(env.db, 'date,steps,kg\n2025-06-01,9999,80.5\n2025-06-02,1234,\n', mapping);
    publishGoogleDays(env.db, '2025-06-01', '2025-06-02', nowMs);
    const mixed = readCanonicalDay(env.db, '2025-06-01')!;
    // the Google steps without a read of the day's windows are incomparable: still a Google value, so CSV does not replace it
    assert.equal(mixed.metrics.steps.status, 'incomparable');
    assert.deepEqual(mixed.metrics.weight, { status: 'valid', value: { numerator: '161', denominator: '2' } });
    assert.deepEqual(mixed.csv, { rule: 'csv-fill-v1', metrics: ['weight'], imports: [imported.id] });
    const only = readCanonicalDay(env.db, '2025-06-02')!;
    assert.deepEqual([only.metrics.steps.status, only.metrics.weight.status, only.csv?.metrics], ['valid', 'missing', ['steps']]);
    // republishing changes nothing; the restore check rebuilds the same projection
    assert.deepEqual(publishGoogleDays(env.db, '2025-06-01', '2025-06-02', nowMs), { published: 0, unchanged: 2 });
    assert.deepEqual(compareGoogleDays(env.db, '2025-06-01', '2025-06-02', nowMs), { matched: 2, differing: [], unpublished: [] });
    // excluding the import: Google's day loses the filled weight, the CSV-only day gets an empty revision (history kept)
    decideCsvImport(env.db, imported.id, 'excluded', '2026-11-04T11:00:00.000Z');
    publishGoogleDays(env.db, '2025-06-01', '2025-06-02', nowMs);
    assert.deepEqual([readCanonicalDay(env.db, '2025-06-01')!.metrics.weight.status, readCanonicalDay(env.db, '2025-06-01')!.csv], ['missing', undefined]);
    const cleared = readCanonicalDay(env.db, '2025-06-02')!;
    assert.deepEqual([cleared.revision, cleared.metrics.steps.status, cleared.csv], [2, 'missing', undefined]);
  } finally { env.dispose(); }
});

test('serwis i REST CSV: podgląd wiąże plik i mapowanie, zmiana wymaga nowego podglądu, zapis publikuje doby', async () => {
  const env = await store();
  const server = createApp(new DatabaseSync(':memory:'), () => env.db, undefined, [], undefined, undefined, undefined, new CsvImportService(env.path, () => Date.parse('2026-11-04T10:00:00Z')));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    const origin = `http://127.0.0.1:${address.port}`;
    const cookie = (await fetch(`${origin}/api/session`)).headers.get('set-cookie')!.split(';')[0]!;
    const post = (path: string, body: object, headers: Record<string, string> = { 'X-Trivimo-Request': '1' }) => fetch(`${origin}${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const file = { name: 'syntetyczny.csv', content: 'date,kcal\n2025-07-01,2100\n2025-07-02,x\n' };
    assert.equal((await post('/api/csv/inspect', file, {})).status, 403);
    assert.equal(((await (await post('/api/csv/inspect', file)).json()) as { columns: number }).columns, 2);
    const mapping: CsvMapping = { ...base, metrics: { total_energy: { column: 1, unit: 'kcal' } } };
    const preview = await (await post('/api/csv/preview', { ...file, mapping })).json() as { token: string; values: number; rejected: number; perMetric: Record<string, { fills: number }> };
    assert.deepEqual([preview.values, preview.rejected, preview.perMetric.total_energy?.fills], [1, 1, 1]);
    const changed = await post('/api/csv/import', { ...file, mapping: { ...mapping, metrics: { active_energy: { column: 1, unit: 'kcal' } } }, token: preview.token });
    assert.deepEqual([changed.status, await changed.json()], [400, { error: 'plan_changed' }]);
    const saved = await (await post('/api/csv/import', { ...file, mapping, token: preview.token })).json() as { created: boolean; published: number };
    assert.deepEqual([saved.created, saved.published], [true, 1]);
    assert.equal(readCanonicalDay(env.db, '2025-07-01')?.metrics.total_energy.status, 'valid');
    const list = await (await fetch(`${origin}/api/csv/imports`, { headers: { Cookie: cookie } })).json() as { state: string; values: number }[];
    assert.deepEqual(list.map((item) => [item.state, item.values]), [['included', 1]]);
    assert.equal((await post('/api/csv/decision', { id: '00000000-0000-4000-8000-000000000000', state: 'excluded' })).status, 404);
  } finally { server.close(); env.dispose(); }
});

test('CSV: procent ze znakiem „%” jest liczbą tylko dla jednostki %, uwagi są tekstem doby', () => {
  const file = 'Data;Tłuszcz;Uwagi\n2025-03-01;20,90%;spacer\n2025-03-02;21,5 %;\n2025-03-03;0,2%;  basen  \n';
  const parsed = parseMappedCsv(file, { ...base, delimiter: ';', decimal: ',', note: 2, metrics: { body_fat: { column: 1, unit: '%' } } }, today, 'Europe/Warsaw');
  assert.deepEqual(parsed.values.map((value) => [value.day, text(toText(value.value)), value.sourceText]), [['2025-03-01', '209/10', '20,90%'], ['2025-03-02', '43/2', '21,5 %'], ['2025-03-03', '1/5', '0,2%']]);
  assert.deepEqual(parsed.notes, [{ row: 2, day: '2025-03-01', text: 'spacer' }, { row: 4, day: '2025-03-03', text: 'basen' }]);
  // with a fraction unit the sign is not part of a number
  const fraction = parseMappedCsv(file, { ...base, delimiter: ';', decimal: ',', metrics: { body_fat: { column: 1, unit: 'fraction' } } }, today, 'Europe/Warsaw');
  assert.deepEqual(fraction.rejected.map((item) => item.reason), ['invalid_number', 'invalid_number', 'invalid_number']);
  assert.deepEqual(parseMappedCsv(`date,n\n2025-03-01,${'x'.repeat(10001)}\n`, { ...base, note: 1 }, today, 'Europe/Warsaw').rejected, [{ row: 2, metric: 'note', reason: 'note_too_long' }]);
});

test('uwagi z CSV są zapisywane jako notatki dni: nowa notatka, dopisanie do istniejącej, ponowny import bez zmian, historia rewizji', async () => {
  const env = await store();
  try {
    const notes: CsvMapping = { ...base, note: 1, metrics: {} };
    saveUserNote(env.db, { date: '2025-08-02', expectedRevision: null, content: 'własna' });
    saveUserNote(env.db, { date: '2025-08-03', expectedRevision: null, content: 'basen rano' });
    const file = 'date,uwagi\n2025-08-01,rower\n2025-08-01,basen\n2025-08-01,rower\n2025-08-02,choroba\n2025-08-03,basen rano\n';
    // the preview tells what each day gets; nothing is written yet
    const preview = new CsvImportService(env.path, () => Date.parse('2026-11-04T10:00:00Z')).preview('u.csv', file, notes);
    assert.deepEqual(preview.notes, { values: 5, days: 3, create: 1, append: 1, unchanged: 1, tooLong: 0 });
    assert.equal(readUserNote(env.db, '2025-08-01'), null);
    const saved = save(env.db, file, notes);
    assert.equal(saved.notes, 2);
    // the notes are ordinary day notes: a new one, and the remark appended on a new line (the earlier revision kept)
    assert.deepEqual([readUserNote(env.db, '2025-08-01')?.content, readUserNote(env.db, '2025-08-01')?.revision], ['rower\nbasen', 1]);
    assert.deepEqual([readUserNote(env.db, '2025-08-02')?.content, readUserNote(env.db, '2025-08-02')?.revision], ['własna\nchoroba', 2]);
    assert.equal(readUserNote(env.db, '2025-08-03')?.revision, 1);
    // the same file again: nothing saved; another file with a remark the note already has: no new revision
    assert.deepEqual(save(env.db, file, notes), { id: saved.id, created: false, notes: 0 });
    assert.equal(save(env.db, 'date,uwagi\n2025-08-01,basen\n', notes).notes, 0);
    assert.equal(readUserNote(env.db, '2025-08-01')?.revision, 1);
    // editing in the application continues the same history (a revision without an import mark)
    saveUserNote(env.db, { date: '2025-08-01', expectedRevision: 1, content: 'rower\nbasen\nmój dopisek' });
    const note = (day: string) => [readUserNote(env.db, day)?.content, readUserNote(env.db, day)?.revision];
    // withdrawing takes back the lines the import added, also from an edited note, and keeps the rest
    assert.deepEqual(decideCsvImport(env.db, saved.id, 'excluded', '2026-11-04T11:00:00.000Z'), { first: null, last: null, notes: 2 });
    assert.deepEqual([note('2025-08-01'), note('2025-08-02'), note('2025-08-03')], [['mój dopisek', 3], ['własna', 3], ['basen rano', 1]]);
    assert.deepEqual(env.db.prepare('SELECT day, revision, action, text FROM user_note_sources WHERE import_id = ? ORDER BY day, revision').all(saved.id).map((row) => ({ ...row })),
      [{ day: '2025-08-01', revision: 1, action: 'apply', text: 'rower\nbasen' }, { day: '2025-08-01', revision: 3, action: 'withdraw', text: 'rower\nbasen' }, { day: '2025-08-02', revision: 2, action: 'apply', text: 'choroba' }, { day: '2025-08-02', revision: 3, action: 'withdraw', text: 'choroba' }]);
    // restoring writes the remarks again; a line the user removed in the meantime is not removed a second time
    assert.equal(decideCsvImport(env.db, saved.id, 'included', '2026-11-04T12:00:00.000Z').notes, 2);
    assert.deepEqual([note('2025-08-01'), note('2025-08-02')], [['mój dopisek\nrower\nbasen', 4], ['własna\nchoroba', 4]]);
    saveUserNote(env.db, { date: '2025-08-02', expectedRevision: 4, content: 'własna' });
    assert.equal(decideCsvImport(env.db, saved.id, 'excluded', '2026-11-04T13:00:00.000Z').notes, 1);
    assert.deepEqual([note('2025-08-01'), note('2025-08-02')], [['mój dopisek', 5], ['własna', 5]]);
    // the provenance of a day lists the import and its latest note action
    assert.deepEqual(csvDayOrigin(env.db, '2025-08-01').filter((item) => item.id === saved.id).map((item) => [item.state, item.note]), [['excluded', { action: 'withdraw', revision: 5 }]]);
    // a note that would exceed the limit is not written
    saveUserNote(env.db, { date: '2025-08-04', expectedRevision: null, content: 'x'.repeat(9995) });
    assert.equal(save(env.db, 'date,uwagi\n2025-08-04,123456\n', notes).notes, 0);
    verifyTakeout(env.path);
  } finally { env.dispose(); }
});

test('CSV: grupy cyfr ze spacją, NBSP, wąską NBSP lub cienką spacją („12 345”) są liczbą; nieregularne grupy są odrzucane', () => {
  assert.deepEqual(['12 345', '1 234 567', '12 345', '12 345', '12 345', '1 234,5', ' 9 999 ', '12345', '1 23', '12 3456', '1  234', ' '].map(ungroupDigits),
    ['12345', '1234567', '12345', '12345', '12345', '1234,5', '9999', '12345', '1 23', '12 3456', '1  234', '']);
  const file = 'Data;Kroki;Kalorie;Tłuszcz\n2025-04-01;12 345;2 150,5;20,90 %\n2025-04-02;1 23;;\n';
  const parsed = parseMappedCsv(file, { ...base, delimiter: ';', decimal: ',', metrics: { steps: { column: 1, unit: 'count' }, total_energy: { column: 2, unit: 'kcal' }, body_fat: { column: 3, unit: '%' } } }, today, 'Europe/Warsaw');
  assert.deepEqual(parsed.values.map((value) => [value.metric, text(toText(value.value)), value.sourceText]), [['body_fat', '209/10', '20,90 %'], ['steps', '12345/1', '12 345'], ['total_energy', '4301/2', '2 150,5']]);
  assert.deepEqual(parsed.rejected.map((item) => [item.row, item.metric, item.reason]), [[3, 'steps', 'invalid_number']]);
});

test('CSV: przecinek dziesiętny w cudzysłowach („88,9”) w pliku z przecinkiem jako separatorem jest wykrywany i czytany', () => {
  const file = 'Data,Waga,Kroki,Tłuszcz\n2025-04-01,"88,9","12 345","20,90%"\n2025-04-02,"89,15",9000,\n';
  const info = inspectCsv(file);
  assert.equal(info.delimiter, ',');
  // the sample cells come unquoted from the parser; comma decimals outnumber dot decimals
  assert.equal(guessDecimal(info.head.slice(1).map((row) => row.slice(1)), info.delimiter), ',');
  assert.equal(guessDecimal([['80.5', '1,5', '2.25']], ','), '.');
  assert.equal(guessDecimal([['9000']], ';'), ',');
  assert.equal(guessDecimal([['9000']], ','), '.');
  const parsed = parseMappedCsv(file, { ...base, decimal: ',', metrics: { weight: { column: 1, unit: 'kg' }, steps: { column: 2, unit: 'count' }, body_fat: { column: 3, unit: '%' } } }, today, 'Europe/Warsaw');
  assert.deepEqual(parsed.values.map((value) => [value.day, value.metric, text(toText(value.value))]), [['2025-04-01', 'weight', '889/10'], ['2025-04-01', 'body_fat', '209/10'], ['2025-04-01', 'steps', '12345/1'], ['2025-04-02', 'weight', '1783/20'], ['2025-04-02', 'steps', '9000/1']]);
  assert.equal(parsed.rejected.length, 0);
});

test('migracja v12: uwagi importów zapisanych wcześniej dostają pochodzenie i dają się wycofać', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-v12-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  try {
    initializeTakeoutStore(db);
    await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
    await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
    await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite'));
    await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite'));
    // a v11 store as the earlier code left it: the import row and note revisions written at the import's moment, no origin
    const at = '2026-11-05T10:00:00.000Z', content = 'date,uwagi\n2025-09-01,rower\n2025-09-02,basen\n';
    db.prepare("INSERT INTO csv_imports VALUES ('00000000-0000-4000-8000-000000000001', 'u.csv', ?, ?, ?, ?, 'csv-mapped-v3', 2, 0, ?)").run('a'.repeat(64), content, JSON.stringify({ ...base, note: 1 }), 'b'.repeat(64), at);
    db.prepare("INSERT INTO csv_import_decisions VALUES ('00000000-0000-4000-8000-000000000001', 1, 'included', ?)").run(at);
    db.prepare("INSERT INTO user_note_versions VALUES ('2025-09-01', 1, 'rower', ?)").run(at);
    db.prepare("INSERT INTO user_note_versions VALUES ('2025-09-02', 1, 'własna', '2026-11-01T08:00:00.000Z'), ('2025-09-02', 2, ?, ?)").run('własna\nbasen', at);
    await migrateCsvNotes(db, join(dir, 'v11.sqlite'));
    assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 12);
    assert.deepEqual(db.prepare('SELECT day, revision, action, text FROM user_note_sources ORDER BY day').all().map((row) => ({ ...row })), [{ day: '2025-09-01', revision: 1, action: 'apply', text: 'rower' }, { day: '2025-09-02', revision: 2, action: 'apply', text: 'basen' }]);
    assert.equal(decideCsvImport(db, '00000000-0000-4000-8000-000000000001', 'excluded', '2026-11-05T11:00:00.000Z').notes, 2);
    assert.deepEqual([readUserNote(db, '2025-09-01')?.content, readUserNote(db, '2025-09-02')?.content], ['', 'własna']);
    verifyTakeout(path);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
