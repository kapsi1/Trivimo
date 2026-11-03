import './local-env.ts';
import { resolve } from 'node:path';
import { takeoutDatabasePath } from '../../packages/storage/location.ts';
import { verifyTakeout } from '../../packages/storage/verify-takeout.ts';

try {
  const path = process.argv[2] ? resolve(process.argv[2]) : takeoutDatabasePath();
  if (!path) throw new Error('missing_path');
  verifyTakeout(path);
  console.log('Weryfikacja bazy importu: integralność, skróty oryginałów, liczby wierszy i odczyt typów poprawne.');
} catch {
  console.error('Weryfikacja bazy importu nie powiodła się.');
  process.exitCode = 1;
}
