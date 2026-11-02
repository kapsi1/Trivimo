import type { SourceKind } from '../contracts/source-records.ts';

export type ParsedSourceValue =
  | { status: 'parsed'; value: string; unit: 'kg' | '%' | 'szt.' | 'km' | 'kcal' }
  | { status: 'invalid' | 'unsupported' };

/** Parsing does not qualify a measurement or establish its identity or completeness. */
export function parseSourceValue(kind: SourceKind, input: string): ParsedSourceValue {
  if (kind === 'total_energy') return { status: 'unsupported' };
  if (input.length > 512 || !/^\d+(?:\.\d+)?$/.test(input)) return { status: 'invalid' };
  const [integerPart, fraction = ''] = input.split('.');
  const integer = integerPart!.replace(/^0+(?=\d)/, '');
  const nonzero = /[1-9]/.test(integer + fraction);
  if (kind === 'weight' && !nonzero) return { status: 'invalid' };
  if (kind === 'steps' && /[1-9]/.test(fraction)) return { status: 'invalid' };
  if (kind === 'body_fat' && (integer.length > 3 || Number(integer) > 100 || (integer === '100' && /[1-9]/.test(fraction)))) return { status: 'invalid' };
  if (kind === 'weight' || kind === 'distance') {
    // Shift the decimal point by three places without converting to floating point.
    const digits = integer.padStart(4, '0');
    const whole = digits.slice(0, -3).replace(/^0+(?=\d)/, '');
    return { status: 'parsed', value: `${whole}.${digits.slice(-3)}${fraction}`, unit: kind === 'weight' ? 'kg' : 'km' };
  }
  const value = fraction ? `${integer}.${fraction}` : integer;
  return { status: 'parsed', value, unit: kind === 'body_fat' ? '%' : kind === 'steps' ? 'szt.' : 'kcal' };
}
