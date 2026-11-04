/** Exact non-negative rationals for unit conversion and daily values; no floating point before presentation. */
export interface Rational { numerator: bigint; denominator: bigint }

function gcd(a: bigint, b: bigint): bigint { while (b !== 0n) [a, b] = [b, a % b]; return a; }

export function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator <= 0n || numerator < 0n) throw new Error('invalid_rational');
  const divisor = gcd(numerator, denominator) || 1n;
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

/** Plain non-negative decimal text with the given separator ("80.5", "80,5", "12000"); null when it is anything else. */
export function parseDecimal(text: string, separator: '.' | ','): Rational | null {
  const value = text.trim();
  if (value.length === 0 || value.length > 40) return null;
  const pattern = separator === '.' ? /^(\d+)(?:\.(\d+))?$/ : /^(\d+)(?:,(\d+))?$/;
  const match = pattern.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? '';
  return rational(BigInt(`${match[1]}${fraction}`), 10n ** BigInt(fraction.length));
}

export const add = (a: Rational, b: Rational) => rational(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
export const multiply = (a: Rational, b: Rational) => rational(a.numerator * b.numerator, a.denominator * b.denominator);
export const equal = (a: Rational, b: Rational) => a.numerator * b.denominator === b.numerator * a.denominator;
export const isInteger = (a: Rational) => a.denominator === 1n;
export const toText = (a: Rational) => ({ numerator: a.numerator.toString(), denominator: a.denominator.toString() });
export const fromText = (a: { numerator: string; denominator: string }) => rational(BigInt(a.numerator), BigInt(a.denominator));

/** Arithmetic mean of the values (at least one). */
export function mean(values: readonly Rational[]): Rational {
  if (values.length === 0) throw new Error('empty_mean');
  const sum = values.reduce((total, value) => add(total, value), rational(0n));
  return rational(sum.numerator, sum.denominator * BigInt(values.length));
}
