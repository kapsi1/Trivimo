import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupToNewFile } from '../../packages/storage/backup.ts';
import { takeoutDatabasePath } from '../../packages/storage/location.ts';

async function main() {
  const destination = process.argv[2];
  const sourcePath = takeoutDatabasePath();
  if (!destination || !sourcePath) throw new Error('Brak katalogu danych lub celu kopii');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try { await backupToNewFile(source, resolve(destination)); } finally { source.close(); }
  console.log('Utworzono kopię bazy. Plik nie jest szyfrowany przez aplikację.');
}

main().catch(() => { console.error('Nie udało się utworzyć kopii. Istniejący plik nie został nadpisany.'); process.exitCode = 1; });
