import type { DatabaseSync } from 'node:sqlite';
import { windowSeconds, type WindowRollupType } from '../adapters/google-health/window-rollup.ts';
import { derivedReader, pageParsers, windowParser, type PageParser } from './google-page-windows.ts';
import { dayBounds } from '../domain/day-zone.ts';
import { readDayZone } from './day-zone.ts';
import type { WindowJobKind } from './google-pages.ts';

const scale = 1000000n;
function toScaled(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0').slice(0, 6));
}
function format(value: bigint): string {
  const cents = (value + 5000n) / 10000n;
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export interface Day { date: string; start: number; end: number }
export type Window = { start: number; value: string | null };

function dates(from: string, to: string, zone: string): Day[] {
  const days: Day[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= Date.parse(`${to}T00:00:00Z`); at += 86400000) {
    const date = new Date(at).toISOString().slice(0, 10); const bounds = dayBounds(date, zone);
    days.push({ date, start: Date.parse(bounds.start), end: Date.parse(bounds.end) });
  }
  return days;
}

/**
 * For each day (in the day zone) the windows of the newest complete saved job whose UTC range covers the whole day.
 * A day covered by a job with no windows maps to an empty list (read, nothing there); an unread day is absent.
 */
export function savedWindows(db: DatabaseSync, kind: WindowJobKind, type: WindowRollupType, days: Day[]): Map<string, Window[]> {
  return savedWindowsWith(db, kind, days, windowParser(type)) as Map<string, Window[]>;
}

/**
 * Parsed pages by parser and page digest (SHA-256 of the saved text): the result depends only on the text. A page is
 * taken from this process memory, else from the store's derived layer (v13), else parsed from the original once.
 * Bounded by the number of kept windows; the least recently used pages go first. Callers must not change the windows.
 */
const pageCache = new Map<string, readonly { start: number }[]>();
let cachedWindows = 0;
const maxCachedWindows = 400_000;
function parsedPage(key: string, compute: () => readonly { start: number }[]): readonly { start: number }[] {
  const hit = pageCache.get(key);
  if (hit) { pageCache.delete(key); pageCache.set(key, hit); return hit; }
  const windows = compute();
  pageCache.set(key, windows); cachedWindows += windows.length;
  for (const [oldest, value] of pageCache) { if (cachedWindows <= maxCachedWindows || oldest === key) break; pageCache.delete(oldest); cachedWindows -= value.length; }
  return windows;
}

/** Same day claiming as `savedWindows`, with any parser of saved pages (e.g. heart-rate values for presentation). */
export function savedWindowsWith<P extends PageParser>(db: DatabaseSync, kind: WindowJobKind, days: Day[], parser: P): Map<string, ReturnType<(typeof pageParsers)[P]>> {
  type T = ReturnType<(typeof pageParsers)[P]>[number];
  const claimed = new Map<string, T[]>();
  if (days.length === 0) return claimed as Map<string, ReturnType<(typeof pageParsers)[P]>>;
  const parse = pageParsers[parser] as (rawJson: string) => T[];
  const pages = db.prepare('SELECT page_number, digest FROM google_read_pages WHERE job_id = ? ORDER BY page_number LIMIT 50');
  const text = db.prepare('SELECT raw_json FROM google_read_pages WHERE job_id = ? AND page_number = ?');
  const derived = derivedReader(db, parser);
  // only jobs that can cover one of the days, so reads of other years never push relevant ones past the limit
  for (const job of db.prepare("SELECT id, range_start, range_end FROM google_read_jobs WHERE kind = ? AND state = 'complete' AND julianday(range_start) <= julianday(?) AND julianday(range_end) >= julianday(?) ORDER BY created_at DESC, id LIMIT 500").all(kind, new Date(days.at(-1)!.start).toISOString(), new Date(days[0]!.end).toISOString())) {
    const from = Date.parse(String(job.range_start)), to = Date.parse(String(job.range_end));
    const needed = days.filter((day) => !claimed.has(day.date) && from <= day.start && to >= day.end);
    if (needed.length === 0) continue;
    const windows: T[] = [];
    for (const page of pages.all(job.id)) {
      const original = () => { const raw = text.get(job.id, page.page_number)?.raw_json; if (typeof raw !== 'string') throw new Error('invalid_page'); return parse(raw); };
      const digest = typeof page.digest === 'string' && /^[0-9a-f]{64}$/.test(page.digest) ? page.digest : null;
      windows.push(...(digest ? parsedPage(`${parser}:${digest}`, () => (derived?.(digest) as T[] | undefined) ?? original()) as T[] : original()));
    }
    for (const day of needed) claimed.set(day.date, windows.filter((window) => window.start >= day.start && window.start < day.end));
  }
  return claimed as Map<string, ReturnType<(typeof pageParsers)[P]>>;
}

/** Days of [from, to] with their bounds in the store's day zone. */
export function storedDays(db: DatabaseSync, from: string, to: string): Day[] { return dates(from, to, readDayZone(db)); }

/**
 * Wear evidence per day: share of ten-minute windows with heart rate and the split of active energy by it.
 * Derived from saved original pages; heart rate shows that a wearable measured, not that it was worn for the whole window.
 * Heart rate absent for a day means "not read", never zero windows; the split needs both reads.
 */
export function readBandShareRange(db: DatabaseSync, from: string, to: string) {
  const days = storedDays(db, from, to);
  if (days.length > 366) throw new Error('range_too_large');
  const heart = savedWindows(db, 'heart-rate-10m', 'heart-rate', days);
  const active = savedWindows(db, 'active-energy-10m', 'active-energy-burned', days);
  return days.map((day) => {
    const heartWindows = heart.get(day.date) ?? null; const activeWindows = active.get(day.date) ?? null;
    const heartStarts = new Set((heartWindows ?? []).map((window) => window.start));
    let band = 0n, other = 0n, bandWindows = 0, otherWindows = 0;
    for (const window of activeWindows ?? []) {
      if (window.value === null) continue;
      if (heartWindows && heartStarts.has(window.start)) { band += toScaled(window.value); bandWindows++; } else { other += toScaled(window.value); otherWindows++; }
    }
    return {
      date: day.date,
      totalWindows: (day.end - day.start) / (windowSeconds * 1000),
      heartRate: heartWindows ? { windows: heartStarts.size } : null,
      activeEnergy: activeWindows && heartWindows ? { bandKcal: format(band), bandWindows, otherKcal: format(other), otherWindows } : null,
      activeEnergyRead: activeWindows !== null,
    };
  });
}

export function readBandShareDay(db: DatabaseSync, date: string) {
  const { date: _date, ...day } = readBandShareRange(db, date, date)[0]!;
  return day;
}
