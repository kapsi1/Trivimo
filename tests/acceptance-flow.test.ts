import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { importTakeout, initializeTakeoutStore } from '../packages/adapters/takeout/import.ts';
import { maxRollupDays } from '../packages/adapters/google-health/daily-rollup.ts';
import { warsawDay } from '../packages/domain/warsaw-day.ts';
import { migrateCalorieJobs, migrateCanonicalDays, migrateDailyRollups, migrateGooglePages, migrateReadPolicy, migrateSourceLists, migrateCsvImports, migrateCsvNotes, migratePageWindows, migrateSourceAccounts, migrateUserNotes, migrateWindowJobs, readCanonicalDay } from '../packages/storage/canonical-days.ts';
import { projectGoogleDays, publishGoogleDays } from '../packages/storage/google-day-snapshots.ts';
import { applyReadPolicy, registerAutomaticJob } from '../packages/storage/google-read-policy.ts';
import { commitGooglePage, createGoogleReadJob, type GoogleJobKind } from '../packages/storage/google-pages.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';
import { GoogleAuth } from '../apps/server/google-auth.ts';
import { GoogleSyncService } from '../apps/server/google-sync.ts';

/**
 * Acceptance criteria of M1 on synthetic data (docs/plan/01-foundation-mvp.md): the six metrics through the whole flow
 * (saved pages → projection → published snapshot), independent of how the reads were cut, repeated or paged.
 */
const account = createHash('sha256').update('synthetic-account').digest('hex');
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const civil = (date: string) => { const [year, month, day] = date.split('-').map(Number); return { date: { year, month, day } }; };
const spread = (from: string, to: string) => { const dates: string[] = []; for (let day = from; day <= to; day = addDays(day, 1)) dates.push(day); return dates; };

async function store() {
  const dir = mkdtempSync(join(tmpdir(), 'trivimo-flow-')); const path = join(dir, 'db.sqlite'); const db = new DatabaseSync(path);
  initializeTakeoutStore(db);
  await migrateCanonicalDays(db, join(dir, 'v1.sqlite')); await migrateUserNotes(db, join(dir, 'v2.sqlite'));
  await migrateSourceAccounts(db, join(dir, 'v3.sqlite'), true); await migrateGooglePages(db, join(dir, 'v4.sqlite'));
  await migrateDailyRollups(db, join(dir, 'v5.sqlite')); await migrateCalorieJobs(db, join(dir, 'v6.sqlite')); await migrateWindowJobs(db, join(dir, 'v7.sqlite')); await migrateReadPolicy(db, join(dir, 'v8.sqlite')); await migrateSourceLists(db, join(dir, 'v9.sqlite')); await migrateCsvImports(db, join(dir, 'v10.sqlite')); await migrateCsvNotes(db, join(dir, 'v11.sqlite')); await migratePageWindows(db, join(dir, 'v12.sqlite'));
  return { db, path, dir, dispose: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

/** Synthetic producer data of one Warsaw day: what the six metrics' reads would return for it (day index `i` varies the values). */
function producerDay(date: string, i: number) {
  const bounds = warsawDay(date), start = Date.parse(bounds.start), count = (Date.parse(bounds.end) - start) / 600000;
  const window = (index: number, fields: object) => ({ startTime: new Date(start + index * 600000).toISOString(), endTime: new Date(start + (index + 1) * 600000).toISOString(), ...fields });
  const windows = (value: (index: number) => object | null) => Array.from({ length: count }, (_, index) => { const fields = value(index); return fields && window(index, fields); }).filter(Boolean) as object[];
  // the first and the very last ten-minute window of the day carry data: the start and the end of the range must not be lost
  const stepsIn = (index: number) => index < 12 ? 100 + i : index === count - 1 ? 7 : 0;
  const mmIn = (index: number) => index === 0 ? 845123 + i : index === count - 1 ? 5 : 0;
  const stepWindows = windows((index) => stepsIn(index) ? { steps: { countSum: String(stepsIn(index)) } } : null);
  const distanceWindows = windows((index) => mmIn(index) ? { distance: { millimetersSum: String(mmIn(index)) } } : null);
  const stepsDay = Array.from({ length: count }, (_, index) => stepsIn(index)).reduce((a, b) => a + b, 0);
  const mmDay = Array.from({ length: count }, (_, index) => mmIn(index)).reduce((a, b) => a + b, 0);
  return {
    date, count,
    stepsDaily: { civilStartTime: civil(date), civilEndTime: civil(addDays(date, 1)), steps: { countSum: String(stepsDay) } },
    distanceDaily: { civilStartTime: civil(date), civilEndTime: civil(addDays(date, 1)), distance: { millimetersSum: String(mmDay) } },
    totalDaily: { civilStartTime: civil(date), civilEndTime: civil(addDays(date, 1)), totalCalories: { kcalSum: String(2600 + i + 0.25) } },
    activeDaily: { civilStartTime: civil(date), civilEndTime: civil(addDays(date, 1)), activeEnergyBurned: { kcalSum: String(300 + i + 0.5) } },
    stepWindows, distanceWindows,
    totalWindows: windows((index) => ({ totalCalories: { kcalSum: String(10 + (index % 7)) } })),
    activeWindows: windows((index) => index < 12 ? { activeEnergyBurned: { kcalSum: '2.5' } } : null),
    heartWindows: windows((index) => index < 20 ? { heartRate: { beatsPerMinuteAvg: 80 + (index % 5) } } : null),
    // weighings at the first and at the last minutes of the Warsaw day, plus one body-fat record
    weight: [
      { name: `users/me/dataTypes/weight/dataPoints/${date}-a`, dataSource: { platform: 'FITBIT' }, weight: { sampleTime: { physicalTime: new Date(start).toISOString() }, weightGrams: String(80000 + i * 10) } },
      { name: `users/me/dataTypes/weight/dataPoints/${date}-b`, dataSource: { platform: 'FITBIT' }, weight: { sampleTime: { physicalTime: new Date(Date.parse(bounds.end) - 300000).toISOString() }, weightGrams: String(80200 + i * 10) } },
    ],
    bodyFat: [{ name: `users/me/dataTypes/body-fat/dataPoints/${date}-a`, dataSource: { platform: 'FITBIT' }, bodyFat: { sampleTime: { physicalTime: new Date(start + 3600000).toISOString() }, percentage: String(18 + (i % 5) / 10) } }],
  };
}
type Producer = ReturnType<typeof producerDay>;

const numbers = (points: unknown[]) => JSON.parse(JSON.stringify(points).replace(/"(kcalSum|weightGrams|percentage)":"([\d.]+)"/g, '"$1":$2')) as unknown[];
type Cut = { name: string; days: number; pageSize: number | null };
/** Save reads of every kind for `days`, cut into reads of `cut.days` days (capped by the producer's limit) and pages of `cut.pageSize` points. */
function load(db: DatabaseSync, days: Producer[], cut: Cut, options: { automatic?: boolean } = {}): string[] {
  const jobs: string[] = [];
  const save = (kind: GoogleJobKind, start: string, end: string, field: 'rollupDataPoints' | 'dataPoints', points: unknown[]) => {
    const id = createGoogleReadJob(db, account, kind, start, end);
    const chunks = cut.pageSize ? Array.from({ length: Math.max(1, Math.ceil(points.length / cut.pageSize)) }, (_, page) => points.slice(page * cut.pageSize!, (page + 1) * cut.pageSize!)) : [points];
    let cursor: string | null = null;
    chunks.forEach((chunk, page) => {
      const next = page < chunks.length - 1 ? `token-${id}-${page}` : undefined;
      commitGooglePage(db, id, cursor, JSON.stringify({ [field]: chunk, ...(next ? { nextPageToken: next } : {}) }));
      cursor = next ?? null;
    });
    jobs.push(id);
    if (options.automatic) registerAutomaticJob(db, id);
  };
  const daily = (kind: 'steps' | 'distance' | 'total-calories' | 'active-energy-burned', pick: (day: Producer) => object) => {
    const size = Math.min(cut.days, maxRollupDays(kind));
    for (let at = 0; at < days.length; at += size) { const part = days.slice(at, at + size); save(kind, part[0]!.date, addDays(part.at(-1)!.date, 1), 'rollupDataPoints', numbers(part.map(pick))); }
  };
  const bounded = (kind: GoogleJobKind, field: 'rollupDataPoints' | 'dataPoints', pick: (day: Producer) => object[], limit: number) => {
    const size = Math.min(cut.days, limit);
    for (let at = 0; at < days.length; at += size) { const part = days.slice(at, at + size); save(kind, warsawDay(part[0]!.date).start, warsawDay(part.at(-1)!.date).end, field, numbers(part.flatMap(pick))); }
  };
  daily('steps', (day) => day.stepsDaily); daily('distance', (day) => day.distanceDaily); daily('total-calories', (day) => day.totalDaily); daily('active-energy-burned', (day) => day.activeDaily);
  bounded('steps-10m', 'rollupDataPoints', (day) => day.stepWindows, 14); bounded('distance-10m', 'rollupDataPoints', (day) => day.distanceWindows, 14);
  bounded('total-calories-10m', 'rollupDataPoints', (day) => day.totalWindows, 14); bounded('active-energy-10m', 'rollupDataPoints', (day) => day.activeWindows, 14);
  bounded('heart-rate-10m', 'rollupDataPoints', (day) => day.heartWindows, 14);
  bounded('weight', 'dataPoints', (day) => day.weight, 30); bounded('body-fat', 'dataPoints', (day) => day.bodyFat, 30);
  return jobs;
}

const cuts: Cut[] = [{ name: 'cały zakres', days: 400, pageSize: null }, { name: 'doba po dobie', days: 1, pageSize: null }, { name: 'tydzień', days: 7, pageSize: null }, { name: 'trzy doby z wieloma stronami', days: 3, pageSize: 40 }, { name: 'najdłuższe porcje ze stronami po 150 punktów', days: 31, pageSize: 150 }];
const projectionOf = (db: DatabaseSync, from: string, to: string) => JSON.stringify(projectGoogleDays(db, from, to, Date.parse('2026-12-01T00:00:00Z')));
const ranges = { spring: ['2026-03-26', '2026-04-02'], autumn: ['2026-10-22', '2026-10-29'], plain: ['2026-06-01', '2026-06-10'] } as const;

for (const [name, [from, to]] of Object.entries(ranges)) {
  test(`kryterium: wynik sześciu metryk nie zależy od krojenia odczytów na dobę/tydzień/porcje i stron (${name}, ${from}…${to})`, async () => {
    const days = spread(from, to).map((date, i) => producerDay(date, i));
    const projections: string[] = [];
    for (const cut of cuts) {
      const { db, dispose } = await store();
      try {
        load(db, days, cut); projections.push(projectionOf(db, from, to));
        // saved reads are read back up to 50 pages per job (as the refresh reads them): the cuts stay inside, so none is dropped
        assert.ok(Number(db.prepare('SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM google_read_pages GROUP BY job_id)').get()?.n) <= 50, cut.name);
        if (cut.pageSize) assert.ok(Number(db.prepare('SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM google_read_pages GROUP BY job_id)').get()?.n) > 1, 'brak wielostronicowej listy');
      } finally { dispose(); }
    }
    cuts.forEach((cut, index) => assert.equal(projections[index], projections[0], `krojenie „${cut.name}” zmienia wynik`));
    const snapshots = JSON.parse(projections[0]!) as ReturnType<typeof projectGoogleDays>;
    assert.equal(snapshots.length, days.length);
    for (const [index, snapshot] of snapshots.entries()) {
      const expected = days[index]!;
      // the first and the last ten-minute window of the Warsaw day are inside the day: nothing is lost at either end
      assert.equal(snapshot.activity?.stepsMatchWindows, true, `${snapshot.date}: okna kroków nie sumują się do doby`);
      assert.equal(snapshot.activity?.distanceMatchWindows, true);
      assert.deepEqual([snapshot.metrics.steps.status, snapshot.metrics.distance.status, snapshot.metrics.total_energy.status, snapshot.metrics.active_energy.status, snapshot.metrics.weight.status, snapshot.metrics.body_fat.status], Array(6).fill('valid'), snapshot.date);
      assert.equal(snapshot.energy?.dayWindows, expected.count);
      assert.equal(snapshot.body?.weightRecords, 2);
      assert.deepEqual(snapshot.issues, []);
    }
  });
}

test('kryterium: doba zmiany czasu ma 23 i 25 okien godzinowych, a ostatnie okno należy do swojej doby', () => {
  const spring = producerDay('2026-03-29', 0), autumn = producerDay('2026-10-25', 0);
  assert.deepEqual([spring.count, autumn.count, producerDay('2026-06-01', 0).count], [138, 150, 144]);
  // the last window of the day starts at 23:50 local time on the day's own clock, the next day's first one begins at its end
  assert.equal(Date.parse(warsawDay('2026-03-29').end), Date.parse(warsawDay('2026-03-30').start));
  assert.equal(Date.parse((spring.stepWindows.at(-1) as { endTime: string }).endTime), Date.parse(warsawDay('2026-03-29').end));
});

test('kryterium: powtórny odczyt i odświeżenie nie zmieniają liczby oryginałów ani sum, także bez polityki odczytów', async () => {
  const days = spread('2026-06-01', '2026-06-07').map((date, i) => producerDay(date, i));
  const { db, dispose } = await store();
  try {
    const count = () => JSON.stringify(db.prepare('SELECT (SELECT COUNT(*) FROM google_read_jobs) AS jobs, (SELECT COUNT(*) FROM google_read_pages) AS pages, (SELECT COUNT(*) FROM daily_snapshots) AS revisions').get());
    const now = Date.parse('2026-12-01T00:00:00Z');
    const first = load(db, days, cuts[2]!, { automatic: true });
    for (const id of first) applyReadPolicy(db, id, now);
    assert.deepEqual(publishGoogleDays(db, '2026-06-01', '2026-06-07', now), { published: 7, unchanged: 0 });
    const published = JSON.stringify(readCanonicalDay(db, '2026-06-03')), before = count();
    const stepsOnDay = readCanonicalDay(db, '2026-06-03')!.metrics.steps.value;

    // the same refresh again: identical content is not kept (policy), nothing changes
    const again = load(db, days, cuts[2]!, { automatic: true });
    const outcomes = again.map((id) => applyReadPolicy(db, id, now).result);
    assert.ok(outcomes.every((result) => result === 'unchanged_duplicate'), outcomes.join());
    assert.equal(count(), before);
    assert.deepEqual(publishGoogleDays(db, '2026-06-01', '2026-06-07', now), { published: 0, unchanged: 7 });
    assert.equal(JSON.stringify(readCanonicalDay(db, '2026-06-03')), published);

    // even a copy the policy never saw (a manual read) is the newest read of the day, not an addition to it
    load(db, days, cuts[1]!);
    assert.deepEqual(publishGoogleDays(db, '2026-06-01', '2026-06-07', now), { published: 0, unchanged: 7 });
    assert.deepEqual(readCanonicalDay(db, '2026-06-03')!.metrics.steps.value, stepsOnDay);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS n FROM daily_snapshots').get()?.n), 7);
    verifyTakeout(join(db.prepare('PRAGMA database_list').get()?.file as string));
  } finally { dispose(); }
});

test('kryterium: późna korekta producenta zmienia dobę jedną nową rewizją, oryginał pierwszego odczytu zostaje w śladzie', async () => {
  const days = spread('2026-06-01', '2026-06-03').map((date, i) => producerDay(date, i));
  const { db, dispose } = await store();
  try {
    const now = Date.parse('2026-12-01T00:00:00Z');
    for (const id of load(db, days, cuts[0]!, { automatic: true })) applyReadPolicy(db, id, now);
    publishGoogleDays(db, '2026-06-01', '2026-06-03', now);
    const corrected = days.map((day) => ({ ...day, totalDaily: { ...day.totalDaily, totalCalories: { kcalSum: '2999.75' } } }));
    // a read later than the first one, with one corrected daily total
    db.prepare("UPDATE google_read_jobs SET created_at = '2026-11-01T00:00:00.000Z'").run();
    const ids = load(db, corrected, cuts[0]!, { automatic: true });
    for (const id of ids) applyReadPolicy(db, id, now);
    assert.deepEqual(publishGoogleDays(db, '2026-06-01', '2026-06-03', now), { published: 3, unchanged: 0 });
    const day = readCanonicalDay(db, '2026-06-02')!;
    assert.equal(day.revision, 2);
    assert.deepEqual(day.metrics.total_energy.value, { numerator: '11999', denominator: '4' });
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM google_read_supersessions WHERE kind = 'total-calories'").get()?.n), 1);
  } finally { dispose(); }
});

test('kryterium: Takeout i API nie dublują tej samej historii; ponowny import Takeout niczego nie dodaje', async () => {
  const days = spread('2026-06-01', '2026-06-05').map((date, i) => producerDay(date, i));
  const root = mkdtempSync(join(tmpdir(), 'trivimo-takeout-flow-'));
  const { db, dispose } = await store();
  try {
    const activity = join(root, 'Google Health', 'Physical Activity_GoogleData');
    mkdirSync(join(activity, 'Weight'), { recursive: true }); mkdirSync(join(activity, 'Steps'), { recursive: true });
    writeFileSync(join(activity, 'Weight', 'weight.csv'), `timestamp,weight grams,data source\n${days.map((day, i) => `${Date.parse(warsawDay(day.date).start) ? new Date(Date.parse(warsawDay(day.date).start)).toISOString() : ''},${80000 + i * 10},Example`).join('\n')}\n`);
    writeFileSync(join(activity, 'Steps', 'steps_2026-06-01.csv'), `timestamp,steps,data source\n${days.map((day, i) => `${new Date(Date.parse(warsawDay(day.date).start)).toISOString()},${100 + i},Example`).join('\n')}\n`);
    const now = Date.parse('2026-12-01T00:00:00Z');

    // Takeout alone: raw originals only, no canonical day
    importTakeout(db, root);
    const raw = () => JSON.stringify(db.prepare('SELECT (SELECT COUNT(*) FROM artifacts) AS artifacts, (SELECT COUNT(*) FROM artifact_rows) AS rows').get());
    const imported = raw();
    assert.deepEqual(publishGoogleDays(db, '2026-06-01', '2026-06-05', now), { published: 0, unchanged: 0 });

    // the same history from the API: the days come from it once, the import's rows are not added
    load(db, days, cuts[0]!);
    assert.equal(publishGoogleDays(db, '2026-06-01', '2026-06-05', now).published, 5);
    const withTakeout = JSON.stringify(projectGoogleDays(db, '2026-06-01', '2026-06-05', now));
    importTakeout(db, root);
    assert.equal(raw(), imported);
    assert.equal(JSON.stringify(projectGoogleDays(db, '2026-06-01', '2026-06-05', now)), withTakeout);
    assert.deepEqual(publishGoogleDays(db, '2026-06-01', '2026-06-05', now), { published: 0, unchanged: 5 });
    assert.equal(readCanonicalDay(db, '2026-06-02')!.metrics.weight.status, 'valid');

    // and without the import the same days come out the same
    const other = await store();
    try { load(other.db, days, cuts[0]!); assert.equal(JSON.stringify(projectGoogleDays(other.db, '2026-06-01', '2026-06-05', now)), withTakeout); } finally { other.dispose(); }
  } finally { dispose(); rmSync(root, { recursive: true, force: true }); }
});

const scopes = 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
test('kryterium: restart w trakcie odczytu wielostronicowej listy wznawia od zapisanego kursora i daje ten sam wynik co odczyt bez przerwy', async () => {
  const days = spread('2026-06-01', '2026-06-02').map((date, i) => producerDay(date, i));
  const points = days.flatMap((day) => day.stepWindows), start = warsawDay('2026-06-01').start, end = warsawDay('2026-06-02').end;
  const pages = [points.slice(0, 10), points.slice(10, 20), points.slice(20)];
  const interrupted = await store(), whole = await store();
  try {
    // process 1 saved the first page and died
    const job = createGoogleReadJob(interrupted.db, account, 'steps-10m', start, end);
    commitGooglePage(interrupted.db, job, null, JSON.stringify({ rollupDataPoints: pages[0], nextPageToken: 'p2' }));
    assert.equal(interrupted.db.prepare('SELECT state FROM google_read_jobs WHERE id = ?').get(job)?.state, 'running');
    interrupted.db.close();

    // process 2: a new service object resumes the saved job by its cursor; planned reads are stubbed out
    const requested: (string | undefined)[] = [];
    const send: typeof fetch = async (address, init) => {
      if (String(address).endsWith('/identity')) return Response.json({ healthUserId: 'synthetic-account' });
      const token = (JSON.parse(String(init?.body)) as { pageToken?: string }).pageToken; requested.push(token);
      return Response.json(token === 'p2' ? { rollupDataPoints: pages[1], nextPageToken: 'p3' } : { rollupDataPoints: pages[2] });
    };
    const auth = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, async () => Response.json({ access_token: 'private', expires_in: 3600, scope: scopes }));
    await auth.finish(new URL(auth.start()).searchParams.get('state'), 'code');
    const service = new GoogleSyncService(interrupted.path, auth, { intervalMinutes: 60, now: () => Date.parse('2026-12-01T12:00:00Z'), send, execute: async () => undefined });
    assert.equal((await service.runOnce()).result, 'ok');
    assert.deepEqual(requested, ['p2', 'p3']);

    const check = new DatabaseSync(interrupted.path);
    try {
      assert.deepEqual({ ...check.prepare('SELECT state, cursor FROM google_read_jobs WHERE id = ?').get(job) }, { state: 'complete', cursor: null });
      assert.equal(check.prepare('SELECT COUNT(*) AS n FROM google_read_pages WHERE job_id = ?').get(job)?.n, 3);
      verifyTakeout(interrupted.path);
      // an uninterrupted single-page read of the same range gives the same windows for the steps check of each day
      const single = createGoogleReadJob(whole.db, account, 'steps-10m', start, end);
      commitGooglePage(whole.db, single, null, JSON.stringify({ rollupDataPoints: points }));
      const windowsOf = (db: DatabaseSync) => JSON.stringify(db.prepare('SELECT raw_json FROM google_read_pages ORDER BY job_id, page_number').all().flatMap((row) => (JSON.parse(String(row.raw_json)) as { rollupDataPoints: object[] }).rollupDataPoints));
      assert.equal(windowsOf(check), windowsOf(whole.db));
    } finally { check.close(); }
  } finally { whole.dispose(); rmSync(interrupted.dir, { recursive: true, force: true }); }
});
