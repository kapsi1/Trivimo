import { createApp } from './app.ts';
import { createDemoDatabase } from '../../packages/storage/days.ts';
import { DatabaseSync } from 'node:sqlite';
import { takeoutDatabasePath } from '../../packages/storage/location.ts';
import { TakeoutService } from './takeout-service.ts';

const sourcePath = takeoutDatabasePath();
let sourceDb: DatabaseSync | undefined;
function getSourceDb(): DatabaseSync | undefined {
  if (sourceDb || !sourcePath) return sourceDb;
  try { sourceDb = new DatabaseSync(sourcePath, { readOnly: true }); } catch { return undefined; }
  return sourceDb;
}
createApp(createDemoDatabase(), getSourceDb, sourcePath ? new TakeoutService(sourcePath) : undefined).listen(3000, '127.0.0.1', () => {
  console.log('Lokalne API: http://127.0.0.1:3000');
});
