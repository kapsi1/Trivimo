import './local-env.ts';
import { createApp } from './app.ts';
import { createDemoDatabase } from '../../packages/storage/days.ts';
import { DatabaseSync } from 'node:sqlite';
import { takeoutDatabasePath } from '../../packages/storage/location.ts';
import { TakeoutService } from './takeout-service.ts';
import { GoogleAuth } from './google-auth.ts';
import { GoogleReadService } from './google-read-service.ts';
import { GoogleSyncService } from './google-sync.ts';
import { CsvImportService } from './csv-import-service.ts';
import { DpapiTokenStore } from './token-store.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const sourcePath = takeoutDatabasePath();
let sourceDb: DatabaseSync | undefined;
function getSourceDb(): DatabaseSync | undefined {
  if (sourceDb || !sourcePath) return sourceDb;
  try { sourceDb = new DatabaseSync(sourcePath, { readOnly: true }); } catch { return undefined; }
  return sourceDb;
}
let googleAuth: GoogleAuth | undefined;
if (process.env.TRIVIMO_GOOGLE_CLIENT_FILE) {
  const store = process.platform === 'win32' && sourcePath ? new DpapiTokenStore(join(dirname(sourcePath), 'google-token.dpapi')) : undefined;
  try { googleAuth = GoogleAuth.fromJson(JSON.parse(readFileSync(process.env.TRIVIMO_GOOGLE_CLIENT_FILE, 'utf8')) as unknown, store); }
  catch { console.error('Nie można wczytać konfiguracji klienta Google OAuth.'); }
  await googleAuth?.restore();
}
// Automatic refresh is configured separately from opening the UI: unset or invalid means manual only.
const syncMinutes = Number(process.env.TRIVIMO_GOOGLE_SYNC_MINUTES);
const googleSync = googleAuth && sourcePath ? new GoogleSyncService(sourcePath, googleAuth, { intervalMinutes: Number.isInteger(syncMinutes) && syncMinutes >= 15 && syncMinutes <= 1440 ? syncMinutes : null }) : undefined;
createApp(createDemoDatabase(), getSourceDb, sourcePath ? new TakeoutService(sourcePath) : undefined, [], googleAuth, googleAuth && sourcePath ? new GoogleReadService(sourcePath, googleAuth) : undefined, googleSync, sourcePath ? new CsvImportService(sourcePath) : undefined).listen(3000, '127.0.0.1', () => {
  console.log('Lokalne API: http://127.0.0.1:3000');
  googleSync?.start();
});
