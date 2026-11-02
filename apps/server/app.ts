import { createServer, type Server } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { listDays } from '../../packages/storage/days.ts';
import { sourceKindSchema } from '../../packages/contracts/source-records.ts';
import { listSourceRecords } from '../../packages/storage/source-records.ts';
import { z } from 'zod';

export function createApp(db: DatabaseSync, sourceDb?: DatabaseSync | (() => DatabaseSync | undefined)): Server {
  const session = randomBytes(32).toString('hex');
  const server = createServer((request, response) => {
    const address = server.address();
    const host = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : '';
    const origin = request.headers.origin;
    if (request.headers.host !== host || (origin !== undefined && origin !== `http://${host}` && origin !== 'http://127.0.0.1:5173')) {
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
