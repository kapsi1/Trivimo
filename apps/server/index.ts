import { createApp } from './app.ts';
import { createDemoDatabase } from '../../packages/storage/days.ts';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const sourcePath = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Trivimo', 'takeout-raw.sqlite') : null;
const sourceDb = sourcePath && existsSync(sourcePath) ? new DatabaseSync(sourcePath, { readOnly: true }) : undefined;
createApp(createDemoDatabase(), sourceDb).listen(3000, '127.0.0.1', () => {
  console.log('Lokalne API: http://127.0.0.1:3000');
});
