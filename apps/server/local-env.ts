import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Side-effect import for entry points: loads `.env` from the project root when present (outside git, see .env.example).
 * Variables already set in the shell win over the file. The file holds paths and settings only, never secrets.
 */
const file = join(import.meta.dirname, '..', '..', '.env');
if (existsSync(file)) process.loadEnvFile(file);
