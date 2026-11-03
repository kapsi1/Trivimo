import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { warsawDay } from '../domain/warsaw-day.ts';
import { sourceDay } from '../domain/source-day.ts';
import { parseSourceValue } from '../domain/source-units.ts';

const pointSchema = z.object({
  name: z.string().optional(), dataSource: z.object({ platform: z.string().optional(), recordingMethod: z.string().optional(), device: z.object({ manufacturer: z.string().optional(), displayName: z.string().optional() }).passthrough().optional() }).passthrough().optional(),
  weight: z.object({ sampleTime: z.object({ physicalTime: z.string().optional() }).passthrough().optional(), weightGrams: z.object({ numericLiteral: z.string() }).optional() }).passthrough().optional(),
  bodyFat: z.object({ sampleTime: z.object({ physicalTime: z.string().optional() }).passthrough().optional(), percentage: z.object({ numericLiteral: z.string() }).optional() }).passthrough().optional(),
}).passthrough();
const rawSchema = z.object({ dataPoints: z.array(z.unknown()).max(100).optional() }).passthrough();

/** Bounded review of saved pages overlapping the Warsaw day; never deduplicates or qualifies. */
export function readGoogleBodySourceDay(db: DatabaseSync, kind: 'weight' | 'body_fat', date: string) {
  const day = warsawDay(date); const apiKind = kind === 'weight' ? 'weight' : 'body-fat';
  const jobRows = db.prepare(`SELECT range_start, range_end, state FROM google_read_jobs
    WHERE kind = ? AND julianday(range_start) < julianday(?) AND julianday(range_end) > julianday(?)
    ORDER BY created_at DESC, id LIMIT 51`).all(apiKind, day.end, day.start);
  const jobs = jobRows.slice(0, 50).map((job) => z.object({ range_start: z.string(), range_end: z.string(), state: z.enum(['running', 'complete']) }).parse(job));
  const rows: { timestamp: string; origin: string; originalValue: string; converted: ReturnType<typeof parseSourceValue>; identity: 'identified' | 'unresolved' }[] = [];
  let matched = 0, unassigned = 0, pages = 0, rowLimitReached = false; const accounts = new Set<string>();
  const query = db.prepare(`SELECT p.raw_json, j.account_digest FROM google_read_jobs j JOIN google_read_pages p ON p.job_id = j.id
    WHERE j.kind = ? AND julianday(j.range_start) < julianday(?) AND julianday(j.range_end) > julianday(?)
    ORDER BY j.created_at DESC, p.page_number LIMIT 51`);
  pageLoop: for (const page of query.iterate(apiKind, day.end, day.start)) {
    pages++;
    if (pages > 50) break;
    if (typeof page.raw_json !== 'string' || typeof page.account_digest !== 'string') throw new Error('invalid_page');
    accounts.add(page.account_digest);
    const decoded: unknown = JSON.parse(page.raw_json, function (key: string, value: unknown, context?: { source?: string }) {
      return (key === 'weightGrams' || key === 'percentage') && typeof value === 'number' ? { numericLiteral: context?.source ?? '' } : value;
    });
    const raw = rawSchema.parse(decoded);
    for (const point of raw.dataPoints ?? []) {
      const parsed = pointSchema.safeParse(point);
      if (!parsed.success) { unassigned++; continue; }
      const item = parsed.data, measurement = kind === 'weight' ? item.weight : item.bodyFat;
      const timestamp = measurement?.sampleTime?.physicalTime;
      if (!timestamp) { unassigned++; continue; }
      let assigned: string;
      try { assigned = sourceDay(timestamp); } catch { unassigned++; continue; }
      if (assigned !== date) continue;
      matched++;
      if (rows.length >= 200) { rowLimitReached = true; break pageLoop; }
      const originalValue = kind === 'weight' ? item.weight?.weightGrams?.numericLiteral ?? '' : item.bodyFat?.percentage?.numericLiteral ?? '';
      const source = item.dataSource;
      const origin = [source?.platform, source?.device?.manufacturer, source?.device?.displayName, source?.recordingMethod].filter(Boolean).join(' · ');
      rows.push({ timestamp, origin, originalValue, converted: parseSourceValue(kind, originalValue), identity: item.name?.trim() ? 'identified' : 'unresolved' });
    }
  }
  return { rows, matched, truncated: pages > 50 || rowLimitReached, unassigned, coverage: 'unknown' as const, multipleAccounts: accounts.size > 1,
    jobs: jobs.map((job) => ({ start: job.range_start, end: job.range_end, state: job.state })), jobsTruncated: jobRows.length > 50 };
}
