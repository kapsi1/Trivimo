import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { listDays } from '../../packages/storage/days.ts';
import { sourceKindSchema } from '../../packages/contracts/source-records.ts';
import { listSourceRecords } from '../../packages/storage/source-records.ts';
import { currentStoreVersion, readCanonicalDay, readEarliestMetricDays, storeHas } from '../../packages/storage/canonical-days.ts';
import { readUserNote } from '../../packages/storage/user-notes.ts';
import { readBodySourceDay } from '../../packages/storage/body-source-day.ts';
import { readGoogleBodySourceDay } from '../../packages/storage/google-body-source-day.ts';
import { dailyRollupTypes } from '../../packages/adapters/google-health/daily-rollup.ts';
import { windowJobKinds, type WindowJobKind } from '../../packages/storage/google-pages.ts';
import { readDaySeries, seriesMetrics } from '../../packages/storage/google-day-series.ts';
import { readBandShareDay, readBandShareRange } from '../../packages/storage/google-band-share-day.ts';
import { readGoogleDailySourceDay } from '../../packages/storage/google-daily-source-day.ts';
import { readHeartRateDay, readHeartRateRange } from '../../packages/storage/google-heart-rate.ts';
import { readEnergyForecast } from '../../packages/storage/google-energy-forecast.ts';
import { firstSupportedYear, warsawDay } from '../../packages/domain/warsaw-day.ts';
import { unassignedSessions } from '../../packages/storage/source-accounts.ts';
import { userNoteInputSchema } from '../../packages/contracts/day-snapshot.ts';
import { z } from 'zod';
const warsawDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
const warsawDayOf = (iso: string) => warsawDayFormat.format(new Date(iso));
import type { TakeoutService } from './takeout-service.ts';
import type { GoogleAuth } from './google-auth.ts';
import type { GoogleReadService } from './google-read-service.ts';
import type { GoogleSyncService } from './google-sync.ts';
import type { CsvImportService } from './csv-import-service.ts';

async function readJson(request: IncomingMessage, limit = 8192): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > limit) throw new Error('body_too_large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function createApp(db: DatabaseSync, sourceDb?: DatabaseSync | (() => DatabaseSync | undefined), takeout?: TakeoutService, extraLocalOrigins: readonly string[] = [], googleAuth?: GoogleAuth, googleRead?: GoogleReadService, googleSync?: GoogleSyncService, csvImport?: CsvImportService): Server {
  if (extraLocalOrigins.some((origin) => !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin))) throw new Error('Nieprawidłowy lokalny Origin');
  const session = randomBytes(32).toString('hex');
  const server = createServer((request, response) => {
    const address = server.address();
    const host = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : '';
    const origin = request.headers.origin;
    const allowedOrigins = [`http://${host}`, 'http://127.0.0.1:5173', 'http://localhost:5173', ...extraLocalOrigins];
    if (request.headers.host !== host || (origin !== undefined && !allowedOrigins.includes(origin))) {
      response.writeHead(403, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/api/session') {
      response.writeHead(204, { 'Set-Cookie': `trivimo_session=${session}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' }).end();
      return;
    }
    const callbackUrl = new URL(request.url ?? '/', `http://${host}`);
    if (request.method === 'GET' && callbackUrl.pathname === '/api/google/callback') {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      if (!googleAuth) { response.writeHead(503).end('Autoryzacja jest niedostępna.'); return; }
      void googleAuth.finish(callbackUrl.searchParams.get('state'), callbackUrl.searchParams.get('code')).then((returnTo) => {
        if (returnTo) { response.writeHead(303, { Location: `${returnTo}/` }).end(); return; }
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Autoryzacja zakończona. Możesz zamknąć tę kartę i wrócić do Trivimo.');
      }).catch(() => { response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nie udało się zakończyć autoryzacji. Wróć do Trivimo i spróbuj ponownie.'); });
      return;
    }
    const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('trivimo_session='))?.slice('trivimo_session='.length);
    if (!cookie || !/^[0-9a-f]{64}$/.test(cookie) || !timingSafeEqual(Buffer.from(cookie), Buffer.from(session))) {
      response.writeHead(401, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (request.method === 'GET' && url.pathname === '/api/google/status') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(googleAuth ? { configured: true, ...googleAuth.status() } : { configured: false }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/google/start') {
      if (!origin || !allowedOrigins.includes(origin) || request.headers['x-trivimo-request'] !== '1' || request.headers['content-type'] !== 'application/json') { response.writeHead(403, { 'Cache-Control': 'no-store' }).end(); return; }
      if (!googleAuth) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ url: googleAuth.start(origin) }));
      return;
    }
    if ((request.method === 'GET' && url.pathname === '/api/google/jobs') || (request.method === 'POST' && (url.pathname === '/api/google/jobs' || url.pathname === '/api/google/jobs/next'))) {
      if (!googleRead) { response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: 'service_unavailable' })); return; }
      if (request.method === 'POST' && (!origin || !allowedOrigins.includes(origin) || request.headers['x-trivimo-request'] !== '1' || request.headers['content-type'] !== 'application/json')) { response.writeHead(403, { 'Cache-Control': 'no-store' }).end(); return; }
      void (async () => {
        try {
          let result: unknown;
          if (request.method === 'GET') result = googleRead.list();
          else {
            const body = await readJson(request);
            if (url.pathname.endsWith('/next')) result = await googleRead.next(z.object({ id: z.uuid() }).strict().parse(body).id);
            else {
              const input = z.union([
                z.object({ kind: z.enum(['weight', 'body-fat', ...(Object.keys(windowJobKinds) as WindowJobKind[])]), date: z.iso.date() }).strict(),
                z.object({ kind: z.enum(['weight', 'body-fat', ...(Object.keys(windowJobKinds) as WindowJobKind[])]), start: z.iso.datetime(), end: z.iso.datetime() }).strict(),
                z.object({ kind: z.enum(dailyRollupTypes), date: z.iso.date() }).strict(),
                z.object({ kind: z.enum(dailyRollupTypes), start: z.iso.date(), end: z.iso.date() }).strict(),
              ]).parse(body);
              const range = (dailyRollupTypes as readonly string[]).includes(input.kind) && 'date' in input ? { start: input.date, end: new Date(Date.parse(`${input.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) } : 'date' in input ? warsawDay(input.date) : input;
              result = await googleRead.start(input.kind, range.start, range.end);
            }
          }
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(result));
        } catch (error) {
          const code = error instanceof Error && ['migration_required', 'store_unavailable', 'authorization_required', 'scope_missing', 'account_changed', 'job_conflict', 'range_too_large'].includes(error.message) ? error.message : 'google_read_failed';
          // Detail carries only a code or schema paths, never response values, tokens or identifiers.
          const detail = error instanceof z.ZodError ? error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}:${issue.code}`).join(',').slice(0, 200)
            : error instanceof Error && /^(google_http_\d{3}|google_identity_http_\d{3}|unexpected_window|duplicate_day|response_too_large|invalid_response|invalid_range|cursor_cycle|token_refresh_failed|identity_response_too_large|invalid_request)$/.test(error.message) ? error.message : undefined;
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: code, ...(detail ? { detail } : {}) }));
        }
      })();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/source-account') {
      try {
        const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
        const version = source?.prepare('PRAGMA user_version').get()?.user_version;
        const accounts = storeHas(version, 4) ? source!.prepare('SELECT COUNT(*) AS count FROM source_accounts').get()?.count : 0;
        const unassignedImports = storeHas(version, 4) ? unassignedSessions(source!).length : 0;
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ singleExistingAccount: accounts === 1, unassignedImports }));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/google/sync-status') {
      if (!googleSync) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(googleSync.status()));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/google/sync') {
      if (!origin || !allowedOrigins.includes(origin) || request.headers['x-trivimo-request'] !== '1' || request.headers['content-type'] !== 'application/json') { response.writeHead(403, { 'Cache-Control': 'no-store' }).end(); return; }
      if (!googleSync) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      void readJson(request).then((body) => {
        const parsed = z.object({ reconcile: z.literal(true).optional() }).strict().safeParse(body);
        if (!parsed.success) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
        return googleSync.runOnce(parsed.data.reconcile ? { reconcile: 'force' } : {}).then((outcome) => { response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(outcome)); });
      }, () => response.writeHead(400, { 'Cache-Control': 'no-store' }).end());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/google/backfill') {
      if (!origin || !allowedOrigins.includes(origin) || request.headers['x-trivimo-request'] !== '1' || request.headers['content-type'] !== 'application/json') { response.writeHead(403, { 'Cache-Control': 'no-store' }).end(); return; }
      if (!googleSync) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      void readJson(request).then((body) => {
        const parsed = z.object({ action: z.enum(['start', 'stop']), from: z.iso.date().optional() }).strict().safeParse(body);
        if (!parsed.success || (parsed.data.action === 'stop' && parsed.data.from)) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
        let status;
        try { status = parsed.data.action === 'start' ? googleSync.startBackfill(parsed.data.from) : googleSync.stopBackfill(); } catch { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(status));
      }, () => response.writeHead(400, { 'Cache-Control': 'no-store' }).end());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/google/day-series') {
      const date = z.iso.date().safeParse(url.searchParams.get('date'));
      const metric = z.enum(Object.keys(seriesMetrics) as [keyof typeof seriesMetrics, ...(keyof typeof seriesMetrics)[]]).safeParse(url.searchParams.get('metric'));
      if (!date.success || !metric.success || Number(date.data.slice(0, 4)) < firstSupportedYear || Number(date.data.slice(0, 4)) > 9998) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
      if (!source || source.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(readDaySeries(source, metric.data, date.data)));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/google/band-share-range') {
      const from = z.iso.date().safeParse(url.searchParams.get('from')), to = z.iso.date().safeParse(url.searchParams.get('to'));
      if (!from.success || !to.success || from.data > to.data || (Date.parse(to.data) - Date.parse(from.data)) / 86400000 > 365 || Number(from.data.slice(0, 4)) < firstSupportedYear || Number(to.data.slice(0, 4)) > 9998) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
      if (!source || source.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(readBandShareRange(source, from.data, to.data)));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/google/coverage') {
      if (!googleSync) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      const yearText = url.searchParams.get('year');
      if (yearText !== null && (!/^\d{4}$/.test(yearText) || Number(yearText) < firstSupportedYear || Number(yearText) > 9998)) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      const coverage = yearText === null ? googleSync.coverage() : googleSync.coverage(Number(yearText));
      if (!coverage) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(coverage));
      return;
    }
    if (request.method === 'GET' && (url.pathname === '/api/google/heart-rate' || url.pathname === '/api/google/energy-forecast')) {
      const date = z.iso.date().safeParse(url.searchParams.get('date'));
      if (!date.success || Number(date.data.slice(0, 4)) < firstSupportedYear || Number(date.data.slice(0, 4)) > 9998) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
      if (!source || source.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        const result = url.pathname.endsWith('/heart-rate') ? readHeartRateDay(source, date.data) : readEnergyForecast(source, date.data, Date.now());
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(result));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/google/heart-rate-range') {
      const from = z.iso.date().safeParse(url.searchParams.get('from')), to = z.iso.date().safeParse(url.searchParams.get('to'));
      if (!from.success || !to.success || from.data > to.data || (Date.parse(to.data) - Date.parse(from.data)) / 86400000 > 365 || Number(from.data.slice(0, 4)) < firstSupportedYear || Number(to.data.slice(0, 4)) > 9998) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
      if (!source || source.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(readHeartRateRange(source, from.data, to.data)));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/google/band-share') {
      const date = z.iso.date().safeParse(url.searchParams.get('date'));
      if (!date.success || Number(date.data.slice(0, 4)) < firstSupportedYear || Number(date.data.slice(0, 4)) > 9998) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
      if (!source || source.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(readBandShareDay(source, date.data)));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/google/daily-candidates') {
      const date = z.iso.date().safeParse(url.searchParams.get('date'));
      const kind = z.enum(dailyRollupTypes).safeParse(url.searchParams.get('kind'));
      if (!date.success || !kind.success || Number(date.data.slice(0, 4)) < firstSupportedYear || Number(date.data.slice(0, 4)) > 9998) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
      if (!source || source.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(readGoogleDailySourceDay(source, kind.data, date.data)));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/google/body-candidates') {
      const date = z.iso.date().safeParse(url.searchParams.get('date'));
      const kind = z.enum(['weight', 'body_fat']).safeParse(url.searchParams.get('kind'));
      if (!date.success || !kind.success || Number(date.data.slice(0, 4)) < firstSupportedYear || Number(date.data.slice(0, 4)) > 9998) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
      if (!source || !storeHas(source.prepare('PRAGMA user_version').get()?.user_version, 5)) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        const review = readGoogleBodySourceDay(source, kind.data, date.data);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(review));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/body-candidates') {
      const date = z.iso.date().safeParse(url.searchParams.get('date'));
      const kind = z.enum(['weight', 'body_fat']).safeParse(url.searchParams.get('kind'));
      if (!date.success || !kind.success) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
      if (!source) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        const review = readBodySourceDay(source, kind.data, date.data);
        const result = { ...review, rows: review.rows.map(({ timestamp, origin, originalValue, converted, identity }) => ({ timestamp, origin, originalValue, converted, identity: identity.status })) };
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(JSON.stringify(result));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/day-range') {
      const from = z.iso.date().safeParse(url.searchParams.get('from'));
      const to = z.iso.date().safeParse(url.searchParams.get('to'));
      if (!from.success || !to.success || from.data > to.data || (Date.parse(to.data) - Date.parse(from.data)) / 86400000 > 365) {
        response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return;
      }
      try {
        const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
        const version = source?.prepare('PRAGMA user_version').get()?.user_version;
        const result = !source || !storeHas(version, 2) ? { state: 'not_ready' } : {
          state: 'ready', days: Array.from({ length: (Date.parse(to.data) - Date.parse(from.data)) / 86400000 + 1 }, (_, index) => {
            const date = new Date(Date.parse(from.data) + index * 86400000).toISOString().slice(0, 10);
            return { date, snapshot: readCanonicalDay(source, date), userNote: storeHas(version, 3) ? readUserNote(source, date) : null };
          }),
        };
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(JSON.stringify(result));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/earliest-days') {
      try {
        const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
        const version = source?.prepare('PRAGMA user_version').get()?.user_version;
        let result: object = { state: 'not_ready' };
        if (source && storeHas(version, 2)) {
          // heart rate has no daily snapshot: the earliest completed read of its windows (when reads began, not the first measurement)
          const read = storeHas(version, 4) ? source.prepare("SELECT MIN(range_start) AS start FROM google_read_jobs WHERE kind = 'heart-rate-10m' AND state = 'complete'").get()?.start : null;
          result = { state: 'ready', metrics: readEarliestMetricDays(source), heartRateRead: typeof read === 'string' ? warsawDayOf(read) : null };
        }
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(result));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/day') {
      const date = z.iso.date().safeParse(url.searchParams.get('date'));
      if (!date.success) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
        const version = source?.prepare('PRAGMA user_version').get()?.user_version;
        const result = !source || !storeHas(version, 2)
          ? { state: 'not_ready' } : { state: 'ready', snapshot: readCanonicalDay(source, date.data), notesAvailable: storeHas(version, 3), userNote: storeHas(version, 3) ? readUserNote(source, date.data) : null };
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(JSON.stringify(result));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
      return;
    }
    if (request.method === 'POST' && (url.pathname === '/api/takeout/upload' || url.pathname === '/api/takeout/zip-preview')) {
      const upload = url.pathname.endsWith('/upload');
      if (!origin || !allowedOrigins.includes(origin) || request.headers['x-trivimo-request'] !== '1' || request.headers['content-type'] !== (upload ? 'application/zip' : 'application/json')) { response.writeHead(403, { 'Cache-Control': 'no-store' }).end(); return; }
      if (!takeout) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      void (async () => {
        try {
          const result = upload ? await takeout.saveUpload(request)
            : await (async () => { const input = z.object({ uploads: z.array(z.uuid()).min(1).max(20), sameAccount: z.boolean().optional() }).strict().parse(await readJson(request)); return takeout.previewZip(input.uploads, input.sameAccount ?? false); })();
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const code = /^zip_[a-z_]+$/.test(message) || ['upload_too_large', 'upload_missing', 'no_google_health'].includes(message) ? message
            : message.startsWith('Niedokończony import') ? 'pending_other' : message.startsWith('Nie znaleziono') ? 'no_files' : message.startsWith('Nieobsługiwany schemat') ? 'unsupported_schema'
              : message.startsWith('Nieprawidłowy plik CSV') ? 'invalid_csv' : message === 'pending_account_locked' || message === 'account_unavailable' ? message : 'import_failed';
          if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' }).end(JSON.stringify({ error: code }));
        }
      })();
      return;
    }
    if (request.method === 'POST' && (url.pathname === '/api/takeout/preview' || url.pathname === '/api/takeout/import' || url.pathname === '/api/day/note' || url.pathname === '/api/source-account/preview' || url.pathname === '/api/source-account/assign')) {
      if (!origin || !allowedOrigins.includes(origin) || request.headers['x-trivimo-request'] !== '1' || request.headers['content-type'] !== 'application/json') {
        response.writeHead(403, { 'Cache-Control': 'no-store' }).end();
        return;
      }
      if (!takeout) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      void (async () => {
        try {
          const body = await readJson(request);
          let result: unknown;
          if (url.pathname === '/api/day/note') result = takeout.saveNote(userNoteInputSchema.parse(body));
          else if (url.pathname === '/api/source-account/preview') { z.object({}).strict().parse(body); result = takeout.previewAccountAssignment(); }
          else if (url.pathname === '/api/source-account/assign') result = takeout.commitAccountAssignment(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(body).token);
          else if (url.pathname.endsWith('/preview')) {
            const input = z.object({ path: z.string().min(1).max(4096), sameAccount: z.boolean().optional() }).strict().parse(body);
            result = await takeout.preview(input.path, input.sameAccount ?? false);
          } else result = await takeout.commit(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(body).token);
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          response.end(JSON.stringify(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const code = message === 'note_conflict' ? 'note_conflict' : message === 'account_plan_changed' ? 'account_plan_changed' : message === 'pending_account_locked' ? 'pending_account_locked' : message === 'account_unavailable' ? 'account_unavailable' : message === 'preview_expired' ? 'preview_expired' : message === 'invalid_directory' ? 'invalid_directory'
            : message.startsWith('Niedokończony import') ? 'pending_other' : message.startsWith('Plik zmienił') || message.startsWith('Plan importu zmienił') ? 'plan_changed'
              : message.startsWith('Nie znaleziono') ? 'no_files' : message.startsWith('Nieobsługiwany schemat') ? 'unsupported_schema'
                : message.startsWith('Nieprawidłowy plik CSV') ? 'invalid_csv' : 'import_failed';
          response.writeHead(code === 'note_conflict' ? 409 : 400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ error: code }));
        }
      })();
      return;
    }
    if ((request.method === 'GET' && (url.pathname === '/api/csv/imports' || url.pathname === '/api/csv/day')) || (request.method === 'POST' && ['/api/csv/inspect', '/api/csv/preview', '/api/csv/import', '/api/csv/decision'].includes(url.pathname))) {
      if (request.method === 'POST' && (!origin || !allowedOrigins.includes(origin) || request.headers['x-trivimo-request'] !== '1' || request.headers['content-type'] !== 'application/json')) { response.writeHead(403, { 'Cache-Control': 'no-store' }).end(); return; }
      if (!csvImport) { response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: 'service_unavailable' })); return; }
      void (async () => {
        try {
          let result: unknown;
          if (request.method === 'GET' && url.pathname === '/api/csv/day') result = csvImport.day(z.iso.date().parse(url.searchParams.get('date')));
          else if (request.method === 'GET') result = csvImport.list();
          else {
            // the file text travels in the body (at most 8 MiB of text, JSON-escaped)
            const body = await readJson(request, 20 * 1024 * 1024);
            const file = z.object({ name: z.string().min(1).max(255), content: z.string().min(1).max(8 * 1024 * 1024) });
            if (url.pathname === '/api/csv/inspect') result = csvImport.inspect(file.strict().parse(body).content);
            else if (url.pathname === '/api/csv/preview') { const input = file.extend({ mapping: z.unknown() }).strict().parse(body); result = csvImport.preview(input.name, input.content, input.mapping); }
            else if (url.pathname === '/api/csv/import') { const input = file.extend({ mapping: z.unknown(), token: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(body); result = await csvImport.commit(input.name, input.content, input.mapping, input.token); }
            else { const input = z.object({ id: z.uuid(), state: z.enum(['included', 'excluded']) }).strict().parse(body); result = await csvImport.decide(input.id, input.state); }
          }
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const code = error instanceof z.ZodError ? 'invalid_request' : ['invalid_csv', 'empty_csv', 'too_many_rows', 'too_many_columns', 'plan_changed', 'migration_required', 'store_unavailable', 'not_found', 'body_too_large'].includes(message) ? message : 'csv_import_failed';
          response.writeHead(code === 'not_found' ? 404 : 400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: code }));
        }
      })();
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/source-records') {
      const kind = sourceKindSchema.safeParse(url.searchParams.get('kind'));
      const cursorText = url.searchParams.get('after') ?? '0';
      const cursor = Number(cursorText);
      const sourceDate = url.searchParams.get('date');
      if (!kind.success || !/^\d+$/.test(cursorText) || !Number.isSafeInteger(cursor) || cursor < 0 || (sourceDate !== null && !z.iso.date().safeParse(sourceDate).success)) {
        response.writeHead(400, { 'Cache-Control': 'no-store' }).end();
        return;
      }
      const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
      if (!source) { response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: 'source_unavailable' })); return; }
      try {
        const page = listSourceRecords(source, kind.data, cursor, sourceDate);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(JSON.stringify(page));
      } catch {
        response.writeHead(500, { 'Cache-Control': 'no-store' }).end();
      }
      return;
    }
    if (request.method === 'GET' && request.url === '/api/days') {
      try {
        const days = listDays(db);
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(JSON.stringify(days));
      } catch {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(JSON.stringify({ error: 'internal_error' }));
      }
      return;
    }
    response.writeHead(404).end();
  });
  return server;
}
