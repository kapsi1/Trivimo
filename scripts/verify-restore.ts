import '../apps/server/local-env.ts';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, createReadStream, mkdtempSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sourceDay } from '../packages/domain/source-day.ts';
import { readBandShareRange } from '../packages/storage/google-band-share-day.ts';
import { readDaySourcesRange } from '../packages/storage/google-day-sources.ts';
import { compareGoogleDays } from '../packages/storage/google-day-snapshots.ts';
import { verifyTakeout } from '../packages/storage/verify-takeout.ts';
import { takeoutDatabasePath } from '../packages/storage/location.ts';

let stage = 'przygotowanie';

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function main() {
  if (!process.argv[2]) throw new Error('missing_backup');
  const backup = resolve(process.argv[2]);
  const live = takeoutDatabasePath();
  if (live) {
    try { if (realpathSync(live) === realpathSync(backup)) throw new Error('live_database'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const tempRoot = mkdtempSync(join(tmpdir(), 'trivimo-restore-'));
  const restoredPath = join(tempRoot, 'restored.sqlite');
  try {
    // Input must be an existing closed backup, never a live SQLite database.
    stage = 'odczyt kopii';
    const before = await digest(backup);
    stage = 'kopiowanie';
    copyFileSync(backup, restoredPath, constants.COPYFILE_EXCL);
    stage = 'porównanie skrótów';
    if (await digest(restoredPath) !== before || await digest(backup) !== before) throw new Error('backup_changed');
    stage = 'weryfikacja bazy';
    verifyTakeout(restoredPath);
    stage = 'przebudowa projekcji';
    const db = new DatabaseSync(restoredPath, { readOnly: true });
    try {
      if (db.prepare('PRAGMA user_version').get()?.user_version === 10) {
        // the moment of the copy is the newest saved page; days are judged as they were then
        const newest = db.prepare('SELECT MAX(received_at) AS at FROM google_read_pages').get()?.at;
        if (typeof newest === 'string') {
          const nowMs = Date.parse(newest) + 1, to = sourceDay(new Date(nowMs).toISOString());
          const yearBefore = new Date(Date.parse(`${to}T00:00:00Z`) - 365 * 86400000).toISOString().slice(0, 10);
          const from = yearBefore > '2026-01-01' ? yearBefore : '2026-01-01';
          readBandShareRange(db, from, to); readDaySourcesRange(db, from, to);
          const result = compareGoogleDays(db, from, to, nowMs);
          // prints dates and counts only, never values
          console.log(`Projekcja z oryginałów ${from} – ${to}: zgodnych dób ${result.matched}, różnych ${result.differing.length}${result.differing.length ? ` (${result.differing.slice(0, 10).join(', ')})` : ''}, bez opublikowanego wyniku ${result.unpublished.length}.`);
          if (result.differing.length) throw new Error('projection_mismatch');
        }
      }
    } finally { db.close(); }
    console.log('Odtworzenie do pustego katalogu i weryfikacja zakończone powodzeniem.');
  } finally {
    try { unlinkSync(restoredPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    rmdirSync(tempRoot);
  }
}
main().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? ` (${error.code})` : '';
  console.error(`Nie udało się odtworzyć lub zweryfikować kopii: ${stage}${code}.`); process.exitCode = 1;
});
