import { createHash } from 'node:crypto';
import { constants, copyFileSync, createReadStream, mkdtempSync, realpathSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
