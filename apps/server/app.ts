import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { listDays } from '../../packages/storage/days.ts';
import { sourceKindSchema } from '../../packages/contracts/source-records.ts';
import { listSourceRecords } from '../../packages/storage/source-records.ts';
import { readCanonicalDay } from '../../packages/storage/canonical-days.ts';
import { readUserNote } from '../../packages/storage/user-notes.ts';
import { readBodySourceDay } from '../../packages/storage/body-source-day.ts';
import { unassignedSessions } from '../../packages/storage/source-accounts.ts';
import { userNoteInputSchema } from '../../packages/contracts/day-snapshot.ts';
import { z } from 'zod';
import type { TakeoutService } from './takeout-service.ts';

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > 8192) throw new Error('body_too_large');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function createApp(db: DatabaseSync, sourceDb?: DatabaseSync | (() => DatabaseSync | undefined), takeout?: TakeoutService, extraLocalOrigins: readonly string[] = []): Server {
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
    const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('trivimo_session='))?.slice('trivimo_session='.length);
    if (!cookie || !/^[0-9a-f]{64}$/.test(cookie) || !timingSafeEqual(Buffer.from(cookie), Buffer.from(session))) {
      response.writeHead(401, { 'Cache-Control': 'no-store' }).end();
      return;
    }
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (request.method === 'GET' && url.pathname === '/api/source-account') {
      try {
        const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
        const version = source?.prepare('PRAGMA user_version').get()?.user_version;
        const accounts = version === 4 ? source!.prepare('SELECT COUNT(*) AS count FROM source_accounts').get()?.count : 0;
        const unassignedImports = version === 4 ? unassignedSessions(source!).length : 0;
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ singleExistingAccount: accounts === 1, unassignedImports }));
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
    if (request.method === 'GET' && url.pathname === '/api/day') {
      const date = z.iso.date().safeParse(url.searchParams.get('date'));
      if (!date.success) { response.writeHead(400, { 'Cache-Control': 'no-store' }).end(); return; }
      try {
        const source = typeof sourceDb === 'function' ? sourceDb() : sourceDb;
        const version = source?.prepare('PRAGMA user_version').get()?.user_version;
        const result = !source || (version !== 2 && version !== 3 && version !== 4)
          ? { state: 'not_ready' } : { state: 'ready', snapshot: readCanonicalDay(source, date.data), notesAvailable: version === 3 || version === 4, userNote: version === 3 || version === 4 ? readUserNote(source, date.data) : null };
        response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(JSON.stringify(result));
      } catch { response.writeHead(500, { 'Cache-Control': 'no-store' }).end(); }
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
            result = takeout.preview(input.path, input.sameAccount ?? false);
          } else result = takeout.commit(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(body).token);
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
