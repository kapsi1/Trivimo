import { createApp } from './app.ts';
import { createDemoDatabase } from '../../packages/storage/days.ts';
import { DatabaseSync } from 'node:sqlite';
import { takeoutDatabasePath } from '../../packages/storage/location.ts';
import { TakeoutService } from './takeout-service.ts';
import { GoogleAuth } from './google-auth.ts';
import { GoogleReadService } from './google-read-service.ts';
import { readFileSync } from 'node:fs';

const sourcePath = takeoutDatabasePath();
let sourceDb: DatabaseSync | undefined;
function getSourceDb(): DatabaseSync | undefined {
  if (sourceDb || !sourcePath) return sourceDb;
  try { sourceDb = new DatabaseSync(sourcePath, { readOnly: true }); } catch { return undefined; }
  return sourceDb;
}
let googleAuth: GoogleAuth | undefined;
if (process.env.TRIVIMO_GOOGLE_CLIENT_FILE) {
  try { googleAuth = GoogleAuth.fromJson(JSON.parse(readFileSync(process.env.TRIVIMO_GOOGLE_CLIENT_FILE, 'utf8')) as unknown); }
  catch { console.error('Nie można wczytać konfiguracji klienta Google OAuth.'); }
}
createApp(createDemoDatabase(), getSourceDb, sourcePath ? new TakeoutService(sourcePath) : undefined, [], googleAuth, googleAuth && sourcePath ? new GoogleReadService(sourcePath, googleAuth) : undefined).listen(3000, '127.0.0.1', () => {
  console.log('Lokalne API: http://127.0.0.1:3000');
});
