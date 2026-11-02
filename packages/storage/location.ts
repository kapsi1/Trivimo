import { join } from 'node:path';

/** The desktop sandbox redirects LOCALAPPDATA; imported data belongs to the user's profile. */
export function takeoutDatabasePath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.TRIVIMO_DATA_DIR) return join(env.TRIVIMO_DATA_DIR, 'takeout-raw.sqlite');
  const local = env.LOCALAPPDATA;
  if (!local) return null;
  if (/[/\\]Packages[/\\]sandbox\.\{[^}]+\}[/\\]AC[/\\]?$/i.test(local) && env.USERPROFILE) {
    return join(env.USERPROFILE, 'AppData', 'Local', 'Trivimo', 'takeout-raw.sqlite');
  }
  return join(local, 'Trivimo', 'takeout-raw.sqlite');
}
