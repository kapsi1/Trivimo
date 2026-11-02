import { closeSync, linkSync, mkdtempSync, openSync, rmdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { backup, type DatabaseSync } from 'node:sqlite';

/** Copy a consistent SQLite snapshot to a new file, never replacing an existing path. */
export async function backupToNewFile(source: DatabaseSync, destination: string): Promise<void> {
  // Reserve a private staging directory on the target volume, then publish without overwrite.
  const staging = mkdtempSync(join(dirname(destination), `.${basename(destination)}-`));
  const temporary = join(staging, 'snapshot.sqlite');
  try {
    closeSync(openSync(temporary, 'wx', 0o600));
    await backup(source, temporary);
    linkSync(temporary, destination);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    rmdirSync(staging);
  }
}
