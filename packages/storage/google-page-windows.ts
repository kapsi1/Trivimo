import type { DatabaseSync } from 'node:sqlite';
import { parseHeartRateWindows, parseWindowRollup, type WindowRollupType } from '../adapters/google-health/window-rollup.ts';
import { windowJobKinds, type WindowJobKind } from './google-pages.ts';

/**
 * Derived layer of store version 13 (decision 2026-11-05): the parsed ten-minute windows of each saved page, so reads and
 * projections do not validate the original JSON again. The original page stays the source of truth; a derived row is
 * keyed by the page digest (SHA-256 of the saved text) and a versioned parser name. A parser whose output changes gets a
 * new version, and rows of the old version are then ignored (the read falls back to parsing the original).
 */
export type PageWindow = { start: number; value: string | null };
export type HeartWindow = { start: number; avg: number; min: number; max: number };

const window = (type: WindowRollupType) => (rawJson: string): PageWindow[] => parseWindowRollup(rawJson, type).windows.map((item) => ({ start: Date.parse(item.start), value: item.value }));
export const pageParsers = {
  'window:heart-rate@1': window('heart-rate'),
  'window:active-energy-burned@1': window('active-energy-burned'),
  'window:total-calories@1': window('total-calories'),
  'window:steps@1': window('steps'),
  'window:distance@1': window('distance'),
  'heart-rate-detail@1': (rawJson: string): HeartWindow[] => parseHeartRateWindows(rawJson).map((item) => ({ ...item, start: Date.parse(item.start) })),
} as const;
export type PageParser = keyof typeof pageParsers;
export const windowParser = (type: WindowRollupType): PageParser => `window:${type}@1`;

/** Parsers whose output is kept for pages of a job kind. */
export function parsersOfKind(kind: string): PageParser[] {
  if (!(kind in windowJobKinds)) return [];
  const own = windowParser(windowJobKinds[kind as WindowJobKind]);
  return kind === 'heart-rate-10m' ? [own, 'heart-rate-detail@1'] : [own];
}

const hasTable = (db: DatabaseSync) => !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'google_page_windows'").get();

/** Save the derived windows of one page (inside the caller's transaction). Pages of other kinds, or a store before v13, get none. */
export function derivePageWindows(db: DatabaseSync, kind: string, digest: string, rawJson: string): void {
  const parsers = parsersOfKind(kind);
  if (parsers.length === 0 || !hasTable(db)) return;
  const insert = db.prepare('INSERT OR IGNORE INTO google_page_windows (digest, parser, windows) VALUES (?, ?, ?)');
  for (const parser of parsers) insert.run(digest, parser, JSON.stringify(pageParsers[parser](rawJson)));
}

/** Kinds of the saved pages with this digest (identical text can be saved for several jobs, also of other kinds, e.g. an empty page). */
const kindsOf = (db: DatabaseSync, digest: string) => db.prepare('SELECT DISTINCT j.kind FROM google_read_pages p JOIN google_read_jobs j ON j.id = p.job_id WHERE p.digest = ?').all(digest).map((row) => String(row.kind));

/**
 * Remove derived rows no saved page needs any more (after the read policy removed pages): a row stays while a page with
 * its digest belongs to a kind that has its parser.
 */
export function removeUnusedPageWindows(db: DatabaseSync, digests: string[]): void {
  if (digests.length === 0 || !hasTable(db)) return;
  const parsers = db.prepare('SELECT parser FROM google_page_windows WHERE digest = ?');
  const remove = db.prepare('DELETE FROM google_page_windows WHERE digest = ? AND parser = ?');
  for (const digest of new Set(digests)) {
    const needed = new Set(kindsOf(db, digest).flatMap(parsersOfKind));
    for (const row of parsers.all(digest)) if (!needed.has(String(row.parser) as PageParser)) remove.run(digest, row.parser);
  }
}

/** Reader of derived windows for one parser; undefined when the store has no derived layer. */
export function derivedReader(db: DatabaseSync, parser: PageParser): ((digest: string) => unknown[] | undefined) | undefined {
  if (!hasTable(db)) return undefined;
  const select = db.prepare('SELECT windows FROM google_page_windows WHERE digest = ? AND parser = ?');
  return (digest) => { const row = select.get(digest, parser); return typeof row?.windows === 'string' ? JSON.parse(row.windows) as unknown[] : undefined; };
}

/**
 * Restore check: every derived row belongs to a saved page of a kind with its parser and equals the parser's output of
 * that page, and every saved window page has the rows of its kind's parsers.
 */
export function verifyPageWindows(db: DatabaseSync): void {
  if (!hasTable(db)) return;
  const pages = db.prepare('SELECT p.raw_json, j.kind FROM google_read_pages p JOIN google_read_jobs j ON j.id = p.job_id WHERE p.digest = ?');
  for (const row of db.prepare('SELECT digest, parser, windows FROM google_page_windows').iterate()) {
    const parser = String(row.parser) as PageParser;
    const source = pages.all(row.digest).find((page) => parsersOfKind(String(page.kind)).includes(parser));
    if (!source || typeof source.raw_json !== 'string' || !(parser in pageParsers)) throw new Error('invalid_page_windows');
    if (JSON.stringify(pageParsers[parser](source.raw_json)) !== row.windows) throw new Error('invalid_page_windows');
  }
  const has = db.prepare('SELECT 1 FROM google_page_windows WHERE digest = ? AND parser = ?');
  for (const page of db.prepare('SELECT DISTINCT p.digest, j.kind FROM google_read_pages p JOIN google_read_jobs j ON j.id = p.job_id').iterate()) {
    for (const parser of parsersOfKind(String(page.kind))) if (!has.get(page.digest, parser)) throw new Error('missing_page_windows');
  }
}

/** Fill the derived layer for every saved window page (migration to v13). */
export function fillPageWindows(db: DatabaseSync): void {
  for (const row of db.prepare('SELECT p.digest, p.raw_json, j.kind FROM google_read_pages p JOIN google_read_jobs j ON j.id = p.job_id').iterate()) {
    derivePageWindows(db, String(row.kind), String(row.digest), String(row.raw_json));
  }
}
