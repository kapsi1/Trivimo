import './local-env.ts';
import { lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importTakeout, initializeTakeoutStore } from '../../packages/adapters/takeout/import.ts';
import { takeoutDatabasePath } from '../../packages/storage/location.ts';

const directory = process.argv[2];
const dbPath = takeoutDatabasePath();
if (!directory || !dbPath) {
  console.error('Podaj katalog Takeout i uruchom polecenie w środowisku Windows z LOCALAPPDATA.');
  process.exit(1);
}
const dataDir = dirname(dbPath);
try {
  mkdirSync(dataDir, { recursive: true });
  if (lstatSync(dataDir).isSymbolicLink()) throw new Error('Niedozwolony katalog danych');
  try { if (lstatSync(dbPath).isSymbolicLink()) throw new Error('Niedozwolony plik bazy'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const db = new DatabaseSync(dbPath);
  try {
    initializeTakeoutStore(db);
    const result = importTakeout(db, directory, (files, rows) => console.log(`Podgląd: ${files} plików, ${rows} wierszy. Oryginały zostaną zachowane.`));
    console.log(`Zakończono: ${result.files} plików, ${result.rows} wierszy. Wyniki dzienne nie zostały jeszcze wyliczone.`);
  } finally { db.close(); }
} catch (error) {
  // Do not expose record content or paths from unexpected I/O errors.
  const message = error instanceof Error && /^(Nieobsługiwany|Nieprawidłowy|Niedozwolona|Niedozwolony|Nie znaleziono|Zbyt wiele|Plik przekracza|Plik zmienił|Niedokończony)/.test(error.message) ? error.message : 'Błąd odczytu lub zapisu importu';
  console.error(message);
  process.exitCode = 1;
}
