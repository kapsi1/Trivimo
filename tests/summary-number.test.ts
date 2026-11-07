import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summaryNumber } from '../apps/web/src/summary-number.ts';

const snapshot = (items: { type: string; status: string; values?: Record<string, string> }[]) => ({ summaries: { items } });
test('liczba główna podsumowania: wartość i zgodne pola tak, konflikt, brak, nieodczytane i brak pola nie (nigdy zero)', () => {
  const temp = 'daily-sleep-temperature-derivations' as const;
  assert.equal(summaryNumber(snapshot([{ type: temp, status: 'value', values: { nightlyTemperatureCelsius: '33.5' } }]), temp), 33.5);
  assert.equal(summaryNumber(snapshot([{ type: temp, status: 'agreed', values: { nightlyTemperatureCelsius: '33.5' } }]), temp), 33.5);
  assert.equal(summaryNumber(snapshot([{ type: temp, status: 'value', values: { nightlyTemperatureCelsius: '0' } }]), temp), 0); // a real zero stays a zero
  assert.equal(summaryNumber(snapshot([{ type: temp, status: 'conflict' }]), temp), null);
  assert.equal(summaryNumber(snapshot([{ type: temp, status: 'absent' }]), temp), null);
  assert.equal(summaryNumber(snapshot([{ type: 'daily-vo2-max', status: 'value', values: { vo2Max: '44' } }]), temp), null);
  assert.equal(summaryNumber(snapshot([{ type: 'daily-heart-rate-variability', status: 'value', values: { entropy: '3' } }]), 'daily-heart-rate-variability'), null);
  assert.equal(summaryNumber(null, temp), null);
});
