import { createServer, type IncomingMessage, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { listDays } from '../../packages/storage/days.ts';
import { sourceKindSchema } from '../../packages/contracts/source-records.ts';
import { listSourceRecords } from '../../packages/storage/source-records.ts';
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

export function createApp(db: DatabaseSync, sourceDb?: DatabaseSync | (() => DatabaseSync | undefined), takeout?: TakeoutService): Server {
  const session = randomBytes(32).toString('hex');
  const server = createServer((request, response) => {
    const address = server.address();
    const host = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : '';
    const origin = request.headers.origin;
    const allowedOrigins = [`http://${host}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];
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
    if (request.method === 'POST' && (url.pathname === '/api/takeout/preview' || url.pathname === '/api/takeout/import')) {
      if (!origin || !allowedOrigins.includes(origin) || request.headers['x-trivimo-request'] !== '1' || request.headers['content-type'] !== 'application/json') {
        response.writeHead(403, { 'Cache-Control': 'no-store' }).end();
        return;
      }
      if (!takeout) { response.writeHead(503, { 'Cache-Control': 'no-store' }).end(); return; }
      void (async () => {
        try {
          const body = await readJson(request);
          const result = url.pathname.endsWith('/preview')
            ? takeout.preview(z.object({ path: z.string().min(1).max(4096) }).strict().parse(body).path)
            : takeout.commit(z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(body).token);
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          response.end(JSON.stringify(result));
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const code = message === 'preview_expired' ? 'preview_expired' : message === 'invalid_directory' ? 'invalid_directory'
            : message.startsWith('Niedokończony import') ? 'pending_other' : message.startsWith('Plik zmienił') || message.startsWith('Plan importu zmienił') ? 'plan_changed'
              : message.startsWith('Nie znaleziono') ? 'no_files' : message.startsWith('Nieobsługiwany schemat') ? 'unsupported_schema'
                : message.startsWith('Nieprawidłowy plik CSV') ? 'invalid_csv' : 'import_failed';
          response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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
