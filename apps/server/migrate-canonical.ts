import './local-env.ts';
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { initializeTakeoutStore } from '../../packages/adapters/takeout/import.ts';
import { migrateCanonicalDays, migrateUserNotes, migrateSourceAccounts, migrateGooglePages, migrateDailyRollups, migrateCalorieJobs, migrateWindowJobs, migrateReadPolicy, migrateSourceLists, migrateCsvImports } from '../../packages/storage/canonical-days.ts';
import { takeoutDatabasePath } from '../../packages/storage/location.ts';
import { verifyTakeout } from '../../packages/storage/verify-takeout.ts';

async function main() {
  const source = takeoutDatabasePath();
  if (!source || !process.argv[2]) throw new Error('missing_path');
  const destination = resolve(process.argv[2]);
  const workspace = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
  const parent = realpathSync(dirname(destination));
  const relativeParent = relative(workspace, parent);
  if (relativeParent === '' || (relativeParent !== '..' && !relativeParent.startsWith(`..${sep}`) && !isAbsolute(relativeParent))) throw new Error('backup_inside_workspace');
  verifyTakeout(source);
  const db = new DatabaseSync(source);
  try {
    initializeTakeoutStore(db);
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (version === 1) await migrateCanonicalDays(db, destination);
    else if (version === 2) await migrateUserNotes(db, destination);
    else if (version === 3) await migrateSourceAccounts(db, destination, process.argv[3] === 'confirm-existing-one-account');
    else if (version === 4) await migrateGooglePages(db, destination);
    else if (version === 5) await migrateDailyRollups(db, destination);
    else if (version === 6) await migrateCalorieJobs(db, destination);
    else if (version === 7) await migrateWindowJobs(db, destination);
    else if (version === 8) await migrateReadPolicy(db, destination);
    else if (version === 9) await migrateSourceLists(db, destination);
    else if (version === 10) await migrateCsvImports(db, destination);
    else throw new Error('unsupported_version');
  } finally { db.close(); }
  verifyTakeout(source);
  console.log('Migracja zakończona. Wcześniejsza wersja bazy została skopiowana i zweryfikowana.');
}
main().catch(() => { console.error('Nie udało się wykonać migracji; sprawdź stan bazy i kopii.'); process.exitCode = 1; });
