import './local-env.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { currentStoreVersion } from '../../packages/storage/canonical-days.ts';
import { dailyRollupTypes } from '../../packages/adapters/google-health/daily-rollup.ts';
import { dailySummaryTypes } from '../../packages/adapters/google-health/daily-summary.ts';
import { dayBounds } from '../../packages/domain/day-zone.ts';
import { readDayZone } from '../../packages/storage/day-zone.ts';
import { windowJobKinds, type WindowJobKind } from '../../packages/storage/google-pages.ts';
import { takeoutDatabasePath } from '../../packages/storage/location.ts';
import { GoogleAuth } from './google-auth.ts';
import { readGoogleJobPage, startGoogleReadJob } from './google-read-service.ts';
import { DpapiTokenStore } from './token-store.ts';

/** Reads one civil-day aggregate range through the same code path as the panel; prints only counts and error codes. */
async function main() {
  const [kind, first, last, flag] = process.argv.slice(2);
  const parsedKind = z.enum([...dailyRollupTypes, ...dailySummaryTypes, ...(Object.keys(windowJobKinds) as WindowJobKind[])]).safeParse(kind);
  if (!parsedKind.success || !z.iso.date().safeParse(first).success || !z.iso.date().safeParse(last).success) throw new Error('usage');
  const clientFile = process.env.TRIVIMO_GOOGLE_CLIENT_FILE; const sourcePath = takeoutDatabasePath();
  if (!clientFile || !sourcePath) throw new Error('missing_configuration');
  // Civil-day kinds keep producer dates; window kinds keep the UTC bounds of the days in the store's day zone.
  const windowed = parsedKind.data.endsWith('-10m');
  const auth = GoogleAuth.fromJson(JSON.parse(readFileSync(clientFile, 'utf8')) as unknown, new DpapiTokenStore(join(dirname(sourcePath), 'google-token.dpapi')));
  await auth.restore();
  const db = new DatabaseSync(sourcePath);
  try {
    if (db.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) throw new Error('migration_required');
    const zone = readDayZone(db);
    const end = windowed ? dayBounds(last!, zone).end : new Date(Date.parse(`${last}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const begin = windowed ? dayBounds(first!, zone).start : first!;
    if (flag !== '--again' && db.prepare("SELECT 1 FROM google_read_jobs WHERE kind = ? AND range_start = ? AND range_end = ? AND state = 'complete'").get(parsedKind.data, begin, end)) { console.log(`skipped: ${parsedKind.data} ${first}..${last} already read (use --again to repeat)`); return; }
    const id = await startGoogleReadJob(db, auth, parsedKind.data, begin, end);
    let pages = 0;
    for (;;) { const result = await readGoogleJobPage(db, auth, id); pages++; if (result.complete || pages >= 50) break; }
    console.log(`done: ${parsedKind.data} ${first}..${last} pages=${pages}`);
  } finally { db.close(); }
}
main().catch((error: unknown) => {
  // Only codes and schema paths are printed, never response values, tokens or identifiers.
  const safe = error instanceof z.ZodError ? error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}:${issue.code}`).join(',')
    : error instanceof Error && /^(usage|missing_configuration|migration_required|authorization_required|scope_missing|account_changed|job_conflict|range_too_large|invalid_range|unexpected_window|missing_field|empty_point|duplicate_day|cursor_cycle|response_too_large|token_refresh_failed|(google_|google_identity_)http_\d{3})$/.test(error.message) ? error.message : 'google_read_failed';
  console.error(`error: ${safe}`);
  process.exitCode = 1;
});
