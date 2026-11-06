import { lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dayOfInstant, firstSupportedDay, isDayZone, listDayZones } from '../../packages/domain/day-zone.ts';
import { currentStoreVersion } from '../../packages/storage/canonical-days.ts';
import { dayZoneState, readDayZone, saveDayZone } from '../../packages/storage/day-zone.ts';
import { publishDayRangeYielding } from '../../packages/storage/google-day-snapshots.ts';

/**
 * The day zone setting (rule day-zone-v1). Changing it adds a version of the setting and then recomputes the day
 * snapshots from the saved originals as new revisions (history of the days is kept; nothing is deleted). A day that
 * has no complete reading in the new zone gets an empty revision until its windows are read again by the history
 * backfill, never a zero. A recomputation interrupted by a restart is resumed by repeating the same request.
 */
export class DayZoneService {
  constructor(private readonly path: string, private readonly busy: () => boolean = () => false, private readonly now: () => number = Date.now) {}
  private open(readOnly: boolean): DatabaseSync {
    let db: DatabaseSync;
    try { const stat = lstatSync(this.path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid_store'); db = new DatabaseSync(this.path, { readOnly, timeout: 5000 }); } catch { throw new Error('store_unavailable'); }
    if (db.prepare('PRAGMA application_id').get()?.application_id !== 1414682185 || db.prepare('PRAGMA user_version').get()?.user_version !== currentStoreVersion) { db.close(); throw new Error('migration_required'); }
    return db;
  }

  state() { const db = this.open(true); try { return { ...dayZoneState(db), zones: listDayZones() }; } finally { db.close(); } }

  async change(zone: string) {
    if (!isDayZone(zone)) throw new Error('invalid_zone');
    if (this.busy()) throw new Error('sync_running');
    const db = this.open(false);
    try {
      const saved = saveDayZone(db, zone, new Date(this.now()).toISOString());
      const { first, last } = db.prepare('SELECT MIN(day) AS first, MAX(day) AS last FROM daily_snapshots').get() ?? {};
      let result = { published: 0, unchanged: 0 };
      if (typeof first === 'string' && typeof last === 'string') {
        const today = dayOfInstant(this.now(), readDayZone(db));
        result = await publishDayRangeYielding(db, first < firstSupportedDay ? firstSupportedDay : first, last > today ? last : today, this.now());
      }
      return { changed: saved.changed, ...result, ...dayZoneState(db) };
    } finally { db.close(); }
  }
}
