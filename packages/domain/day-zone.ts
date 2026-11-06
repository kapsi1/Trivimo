/**
 * Day zone: the IANA time zone whose civil day is the application's day (rule `day-zone-v1`).
 * A day is the half-open interval [start, end) between two local midnights; its length follows the zone
 * (23, 24 or 25 hours, or other lengths where a zone shifted its offset), never an assumed 86 400 s.
 */
export const defaultDayZone = 'Europe/Warsaw';
export const dayZoneRule = 'day-zone-v1';

/**
 * Earliest year of application days. History before 2026 is read and qualified by the same versioned rules
 * (user decision 2026-11-04); its separate audit stays open in the plan.
 */
export const firstSupportedYear = 2000;
export const firstSupportedDay = `${firstSupportedYear}-01-01`;

/** Names the runtime lists for its time zones (ICU may list an older spelling, e.g. Asia/Calcutta for Asia/Kolkata). */
let listed: ReadonlyMap<string, string> | undefined;
/** Common current names that older ICU data lists under another spelling; accepted when the runtime knows them. */
const currentNames = ['Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Ho_Chi_Minh', 'Asia/Yangon', 'Europe/Kyiv', 'America/Argentina/Buenos_Aires'];
const shape = /^[A-Z][a-z]+(\/[A-Z][a-z0-9]*([_-][A-Za-z][a-z0-9]*)*)+$/;
/** Whether `zone` is an IANA name in its exact spelling that this runtime knows (offsets, lower case and old aliases are not accepted). */
export function isDayZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || zone.length === 0 || zone.length > 64) return false;
  listed ??= new Map([...Intl.supportedValuesOf('timeZone'), 'UTC'].map((name) => [name.toLowerCase(), name]));
  const known = listed.get(zone.toLowerCase());
  if (known !== undefined) return known === zone;
  if (!shape.test(zone)) return false;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }); return true; } catch { return false; }
}

/** Zones to offer: the runtime's list plus the current spellings it knows under older names. */
export function listDayZones(): string[] {
  return [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', ...currentNames.filter(isDayZone)])].sort();
}

/** The zone, or an error: a day zone never falls back silently to another one. */
export function requireDayZone(zone: string): string {
  if (!isDayZone(zone)) throw new Error('Nieobsługiwana strefa doby');
  return zone;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterOf(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: requireDayZone(zone), year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

function localParts(instant: number, zone: string): number[] {
  const parts = formatterOf(zone).formatToParts(instant);
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map((name) => {
    const value = parts.find((part) => part.type === name)?.value;
    if (value === undefined) throw new Error('Nie można wyznaczyć dnia aplikacji');
    return Number(value);
  });
}

const dayKey = (parts: number[]) => parts[0]! * 10000 + parts[1]! * 100 + parts[2]!;

/** Civil date (YYYY-MM-DD) of an instant in the zone. */
export function dayOfInstant(instant: number, zone: string): string {
  if (!Number.isFinite(instant)) throw new Error('Nieprawidłowy czas źródła');
  const [year, month, day] = localParts(instant, zone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Local wall-clock minutes since midnight of an instant in the zone. */
export function minutesOfDay(instant: number, zone: string): number {
  const parts = localParts(instant, zone);
  return parts[3]! * 60 + parts[4]!;
}

/** First instant whose local civil date is not before the target: the start of the day, also when midnight does not exist. */
function dayStart(year: number, month: number, day: number, zone: string): number {
  const targetKey = year * 10000 + month * 100 + day, target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = localParts(guess, zone);
    const correction = target - Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!, parts[5]!);
    if (correction === 0) break;
    guess += correction;
  }
  if (dayKey(localParts(guess, zone)) === targetKey && dayKey(localParts(guess - 1, zone)) < targetKey) return guess;
  // midnight skipped or repeated by a transition: search the first instant of the date (local dates do not go back)
  let low = target - 40 * 3600000, high = target + 40 * 3600000;
  if (dayKey(localParts(low, zone)) >= targetKey || dayKey(localParts(high, zone)) < targetKey) throw new Error('Niejednoznaczny początek dnia aplikacji');
  while (high - low > 1) {
    const middle = low + Math.floor((high - low) / 2);
    if (dayKey(localParts(middle, zone)) >= targetKey) high = middle; else low = middle;
  }
  return high;
}

/**
 * Bounds of days already computed (a call costs several `Intl` formats, and coverage and projection loops ask for the
 * same days many times). Only valid dates are kept; the timezone database does not change while the process runs.
 */
const dayCache = new Map<string, Readonly<{ start: string; end: string }>>();

/** Civil day of the zone as [start, end), using the runtime's timezone database. The result is frozen and shared. */
export function dayBounds(date: string, zone: string): Readonly<{ start: string; end: string }> {
  const key = `${zone}|${date}`;
  const hit = dayCache.get(key);
  if (hit) return hit;
  const bounds = Object.freeze(computeDay(date, zone));
  if (dayCache.size >= 50000) dayCache.clear();
  dayCache.set(key, bounds);
  return bounds;
}

function computeDay(date: string, zone: string): { start: string; end: string } {
  requireDayZone(zone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('Nieprawidłowa data');
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  if (year < firstSupportedYear || year > 9998) throw new Error('Data poza zakresem kontraktu');
  const civil = new Date(Date.UTC(year, month - 1, day));
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() + 1 !== month || civil.getUTCDate() !== day) {
    throw new Error('Nieprawidłowa data');
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: new Date(dayStart(year, month, day, zone)).toISOString(),
    end: new Date(dayStart(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), zone)).toISOString(),
  };
}
