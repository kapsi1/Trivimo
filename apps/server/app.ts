import { createServer, type Server } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { listDays } from '../../packages/storage/days.ts';

export function createApp(db: DatabaseSync): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/api/days') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(listDays(db)));
      return;
    }
    response.writeHead(404).end();
  });
}
