import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listBodyPage } from '../packages/adapters/google-health/body-read.ts';

const range = { type: 'weight' as const, start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' };
test('pojedyncza strona zachowuje surowe dane i token kontynuacji', async () => {
  const fake: typeof fetch = async (address, options) => {
    const url = new URL(String(address));
    assert.equal(url.pathname, '/v4/users/me/dataTypes/weight/dataPoints');
    assert.equal(url.searchParams.get('pageSize'), '100');
    assert.equal(url.searchParams.get('pageToken'), 'next');
    assert.match(url.searchParams.get('filter')!, /weight\.sample_time\.physical_time/);
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer synthetic');
    return Response.json({ dataPoints: [{ synthetic: 'original' }], nextPageToken: 'continuation' });
  };
  assert.deepEqual(await listBodyPage({ ...range, pageToken: 'next' }, 'synthetic', fake), { rawJson: JSON.stringify({ dataPoints: [{ synthetic: 'original' }], nextPageToken: 'continuation' }), records: [{ synthetic: 'original' }], nextPageToken: 'continuation' });
});
test('pusta strona, błąd i nadmierna odpowiedź nie udają pełnego wyniku', async () => {
  assert.deepEqual(await listBodyPage({ ...range, type: 'body-fat' }, 'synthetic', async (address) => { const url = new URL(String(address)); assert.equal(url.pathname, '/v4/users/me/dataTypes/body-fat/dataPoints'); assert.match(url.searchParams.get('filter')!, /body_fat\.sample_time\.physical_time/); return Response.json({}); }), { rawJson: '{}', records: [], nextPageToken: null });
  await assert.rejects(listBodyPage(range, 'synthetic', async () => new Response('', { status: 403 })), /google_http_403/);
  await assert.rejects(listBodyPage(range, 'synthetic', async () => new Response('x'.repeat(1048577))), /response_too_large/);
  await assert.rejects(listBodyPage({ ...range, end: range.start }, 'synthetic'), /invalid_range/);
});
