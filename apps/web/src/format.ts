/** Presentation helpers: Polish dates and numbers. Values are stored exactly; rounding happens only here. */
export const MON = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MONG = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const WD = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
export const WDS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const diffDays = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const mondayOf = (date: string) => addDays(date, -((dow(date) + 6) % 7));
export const fmtD = (date: string) => `${Number(date.slice(8))} ${MON[Number(date.slice(5, 7)) - 1]}`;
export const fmtDL = (date: string) => `${WD[dow(date)]}, ${Number(date.slice(8))} ${MONG[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
export const fmtRange = (from: string, to: string) => from.slice(0, 4) === to.slice(0, 4) ? `${fmtD(from)} – ${fmtD(to)} ${to.slice(0, 4)}` : `${fmtD(from)} ${from.slice(0, 4)} – ${fmtD(to)} ${to.slice(0, 4)}`;
export const maxDate = (a: string, b: string) => a > b ? a : b;
export function isoWeek(date: string): number {
  const d = new Date(`${date}T00:00:00Z`); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
export const nf = (value: number, decimals = 0) => value.toLocaleString('pl-PL', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function warsawToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
const hm = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hourOnly = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', hourCycle: 'h23' });
const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Warsaw wall-clock time of an instant. */
export const timeOf = (iso: string | number) => hm.format(new Date(iso));
export const hourOf = (iso: string | number) => hourOnly.format(new Date(iso));
/** "dziś 13:30", "3 lis 21:04": a read or save time relative to today, in Warsaw. */
export function whenOf(iso: string): string {
  const date = dayOf.format(new Date(iso));
  return `${date === warsawToday() ? 'dziś' : `${fmtD(date)}${date.slice(0, 4) !== warsawToday().slice(0, 4) ? ` ${date.slice(0, 4)}` : ''}`} ${timeOf(iso)}`;
}

/** Exact rational to a fixed number of decimals (half up), with a Polish decimal comma and thin grouping. */
export function formatRational(value: { numerator: string; denominator: string }, decimals: number): string {
  const divisor = BigInt(value.denominator), scale = 10n ** BigInt(decimals);
  const rounded = (BigInt(value.numerator) * scale + divisor / 2n) / divisor;
  const integer = Number(rounded / scale).toLocaleString('pl-PL');
  return decimals === 0 ? integer : `${integer},${(rounded % scale).toString().padStart(decimals, '0')}`;
}
export const toNumber = (value: { numerator: string; denominator: string }) => Number(value.numerator) / Number(value.denominator);

/** Round tick values for an axis. */
export function niceTicks(min: number, max: number, count = 3): number[] {
  const span = max - min || 1; const raw = span / count; const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? mag * 10;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks: number[] = []; for (let value = lo; value <= hi + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

/** Polish plural of a count: 1 pomiar, 2–4 pomiary, 5+ pomiarów. */
export function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  return count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many;
}
