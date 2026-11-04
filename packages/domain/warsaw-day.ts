const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function localParts(instant: number): number[] {
  const parts = formatter.formatToParts(instant);
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map((name) => {
    const value = parts.find((part) => part.type === name)?.value;
    if (value === undefined) throw new Error('Nie można wyznaczyć dnia aplikacji');
    return Number(value);
  });
}

function midnightUtc(year: number, month: number, day: number): number {
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  // Convert Warsaw midnight to UTC, using the timezone data of this runtime.
  for (let attempt = 0; attempt < 4; attempt++) {
    const [y, m, d, h, min, sec] = localParts(guess);
    const correction = target - Date.UTC(y!, m! - 1, d!, h!, min!, sec!);
    if (correction === 0) return guess;
    guess += correction;
  }
  throw new Error('Niejednoznaczny początek dnia aplikacji');
}

/**
 * Earliest year of application days. History before 2026 is read and qualified by the same versioned rules
 * (user decision 2026-11-04); its separate audit stays open in the plan.
 */
export const firstSupportedYear = 2000;
export const firstSupportedDay = `${firstSupportedYear}-01-01`;

/** Warsaw civil day as [start, end), using the runtime's timezone database. */
export function warsawDay(date: string): { start: string; end: string } {
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
    start: new Date(midnightUtc(year, month, day)).toISOString(),
    end: new Date(midnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())).toISOString(),
  };
}
