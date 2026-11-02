import { planTakeout } from '../../packages/adapters/takeout/import.ts';

try {
  if (!process.argv[2]) throw new Error('Podaj katalog eksportu');
  const plan = planTakeout(process.argv[2]);
  console.log(`Podgląd: ${plan.files.length} plików, ${plan.files.reduce((sum, file) => sum + file.rows, 0)} wierszy.`);
} catch {
  // Input can contain private data, including filenames and field values.
  console.error('Nie można przygotować podglądu eksportu.');
  process.exitCode = 1;
}
