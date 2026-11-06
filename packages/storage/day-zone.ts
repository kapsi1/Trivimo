import type { DatabaseSync } from 'node:sqlite';
import { dayZoneRule, defaultDayZone, dayOfInstant, isDayZone, requireDayZone } from '../domain/day-zone.ts';

export interface DayZoneVersion { revision: number; zone: string; rule: string; reason: 'initial' | 'user'; createdAt: string }

function rows(db: DatabaseSync): DayZoneVersion[] {
  try {
    return db.prepare('SELECT revision, zone, rule, reason, created_at AS createdAt FROM day_zone_versions ORDER BY revision').all()
      .map((row) => ({ revision: Number(row.revision), zone: String(row.zone), rule: String(row.rule), reason: row.reason === 'user' ? 'user' as const : 'initial' as const, createdAt: String(row.createdAt) }));
  } catch { return []; } // a store older than version 14 has no setting: its days were always Warsaw days
}

/** Zone of the application's day (the newest version of the setting); Warsaw for a store that has none yet. */
export function readDayZone(db: DatabaseSync): string {
  try {
    const zone = db.prepare('SELECT zone FROM day_zone_versions ORDER BY revision DESC LIMIT 1').get()?.zone;
    return isDayZone(zone) ? zone : defaultDayZone;
  } catch { return defaultDayZone; }
}

/** Application "today" in the day zone. */
export const todayIn = (db: DatabaseSync, nowMs: number): string => dayOfInstant(nowMs, readDayZone(db));

/**
 * Zone a published snapshot's day was cut in: the one recorded in the snapshot, Warsaw for snapshots published before
 * the setting existed (they were always cut in Warsaw).
 */
export const snapshotZone = (recorded: string | undefined): string => recorded ?? defaultDayZone;

/** The setting, its history, and how many days still carry a snapshot cut in another zone than the current one. */
export function dayZoneState(db: DatabaseSync) {
  const history = rows(db), zone = readDayZone(db);
  let stale = 0, total = 0;
  try {
    const counts = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(COALESCE(json_extract(payload, '$.zone'), ?1) != ?2), 0) AS stale
      FROM daily_snapshots s WHERE revision = (SELECT MAX(revision) FROM daily_snapshots t WHERE t.day = s.day)`).get(defaultDayZone, zone);
    stale = Number(counts?.stale ?? 0); total = Number(counts?.total ?? 0);
  } catch { /* store without snapshots */ }
  return { zone, rule: dayZoneRule, revision: history.at(-1)?.revision ?? null, default: defaultDayZone, since: history.at(-1)?.createdAt ?? null, history, days: total, staleDays: stale };
}

/** Adds a version of the setting; returns false (changing nothing) when the zone is already the current one. */
export function saveDayZone(db: DatabaseSync, zone: string, nowIso: string): { changed: boolean; revision: number } {
  requireDayZone(zone);
  db.exec('BEGIN IMMEDIATE');
  try {
    const latest = db.prepare('SELECT revision, zone FROM day_zone_versions ORDER BY revision DESC LIMIT 1').get();
    if (!latest) throw new Error('migration_required');
    if (latest.zone === zone) { db.exec('COMMIT'); return { changed: false, revision: Number(latest.revision) }; }
    const revision = Number(latest.revision) + 1;
    db.prepare("INSERT INTO day_zone_versions VALUES (?, ?, ?, 'user', ?)").run(revision, zone, dayZoneRule, nowIso);
    db.exec('COMMIT');
    return { changed: true, revision };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

/** Integrity of the setting for the restore check: contiguous revisions from 1, known zones and rule. */
export function verifyDayZone(db: DatabaseSync): void {
  const history = rows(db);
  if (history.length === 0 || history.some((item, index) => item.revision !== index + 1 || !isDayZone(item.zone) || item.rule !== dayZoneRule)) throw new Error('invalid_day_zone');
}
