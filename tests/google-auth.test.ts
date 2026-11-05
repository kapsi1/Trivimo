import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { GoogleAuth } from '../apps/server/google-auth.ts';

test('OAuth wiąże state i PKCE, nie udostępnia tokenów i nie ponawia kodu', async () => {
  let calls = 0; let sent: URLSearchParams | undefined;
  const fake: typeof fetch = async (_url, options) => { calls++; sent = options?.body as URLSearchParams; return Response.json({ access_token: 'synthetic-token', refresh_token: 'synthetic-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly' }); };
  const auth = new GoogleAuth({ client_id: 'synthetic-id', client_secret: 'synthetic-secret' }, fake, () => 1000);
  const url = new URL(auth.start()); const state = url.searchParams.get('state');
  await assert.rejects(auth.finish('incorrect', 'code'));
  await assert.rejects(auth.finish(`${state!.slice(0, 42)}${state!.endsWith('A') ? 'B' : 'A'}`, 'code'));
  assert.equal(calls, 0);
  // a callback with another state does not cancel the authorization in progress; a newer start replaces it
  const next = new URL(auth.start());
  await assert.rejects(auth.finish(state, 'code'));
  assert.equal(calls, 0);
  await auth.finish(next.searchParams.get('state'), 'code');
  assert.equal(calls, 1);
  assert.equal(createHash('sha256').update(sent!.get('code_verifier')!).digest('base64url'), next.searchParams.get('code_challenge'));
  assert.equal(auth.status().connected, true);
  assert.equal(JSON.stringify(auth.status()).includes('synthetic-token'), false);
  // the code is used once: the same callback again is refused without a request
  await assert.rejects(auth.finish(next.searchParams.get('state'), 'code'));
  assert.equal(calls, 1);
});

test('OAuth: obcy callback nie przerywa trwającej autoryzacji, token jest odświeżany minutę przed wygaśnięciem', async () => {
  let clock = 1000, calls = 0;
  const fake: typeof fetch = async () => { calls++; return Response.json({ access_token: `synthetic-${calls}`, refresh_token: 'synthetic-refresh', expires_in: 3600, scope: 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly' }); };
  const auth = new GoogleAuth({ client_id: 'synthetic-id', client_secret: 'synthetic-secret' }, fake, () => clock);
  const state = new URL(auth.start()).searchParams.get('state');
  await assert.rejects(auth.finish('A'.repeat(43), 'code'));
  await auth.finish(state, 'code');
  assert.equal(calls, 1);
  const scope = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
  clock = 1000 + 3600_000 - 120_000;
  assert.equal(await auth.withAccessToken(scope, async (token) => token), 'synthetic-1');
  clock = 1000 + 3600_000 - 30_000;
  assert.equal(await auth.withAccessToken(scope, async (token) => token), 'synthetic-2');
});

test('OAuth zachowuje poprzedni token po błędzie wymiany', async () => {
  let succeed = true;
  const fake: typeof fetch = async () => succeed ? Response.json({ access_token: 'old', expires_in: 100, scope: '' }) : new Response('', { status: 400 });
  const auth = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, fake, () => 1000);
  let url = new URL(auth.start()); await auth.finish(url.searchParams.get('state'), 'code');
  succeed = false; url = new URL(auth.start()); await assert.rejects(auth.finish(url.searchParams.get('state'), 'code'));
  assert.equal(auth.status().connected, true);
});

test('punkty OAuth wymagają lokalnej sesji i chronionego żądania, callback nie ujawnia kodu', async () => {
  const { createApp } = await import('../apps/server/app.ts');
  const { createDemoDatabase } = await import('../packages/storage/days.ts');
  const fake: typeof fetch = async () => Response.json({ access_token: 'synthetic-private-token', expires_in: 3600, scope: '' });
  const auth = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, fake);
  const demo = createDemoDatabase(); const server = createApp(demo, undefined, undefined, [], auth);
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const cookie = (await fetch(`${base}/api/session`)).headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie);
    assert.equal((await fetch(`${base}/api/google/start`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/google/start`, { method: 'POST', headers: { Cookie: cookie } })).status, 403);
    const headers = { Cookie: cookie, Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'X-Trivimo-Request': '1' };
    const start = await fetch(`${base}/api/google/start`, { method: 'POST', headers, body: '{}' });
    const data = await start.json() as { url: string }; const state = new URL(data.url).searchParams.get('state'); assert.ok(state);
    const callback = await fetch(`${base}/api/google/callback?state=${state}&code=synthetic-code`, { redirect: 'manual' });
    assert.equal(callback.status, 303); assert.equal(callback.headers.get('location'), 'http://localhost:5173/');
    assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
    assert.doesNotMatch(await callback.text(), /synthetic-code|synthetic-private-token/);
    const status = await fetch(`${base}/api/google/status`, { headers: { Cookie: cookie } });
    assert.doesNotMatch(await status.text(), /synthetic-private-token/);
    assert.equal((await fetch(`${base}/api/google/callback?state=${state}&code=synthetic-code`)).status, 400);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); demo.close(); }
});

test('OAuth zapisuje tylko token odświeżania, odtwarza go po restarcie i odświeża token dostępu', async () => {
  let saved: string | null = null; let cleared = false; let reject = false; const grants: string[] = [];
  const store = { load: async () => saved, save: async (value: string) => { saved = value; }, clear: async () => { cleared = true; saved = null; } };
  const scope = 'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly';
  let now = 1000;
  const fake: typeof fetch = async (_url, options) => {
    const body = options?.body as URLSearchParams; grants.push(body.get('grant_type')!);
    if (body.get('grant_type') === 'refresh_token' && reject) return new Response('', { status: 400 });
    return Response.json(body.get('grant_type') === 'refresh_token' ? { access_token: 'renewed', expires_in: 3600 } : { access_token: 'first', refresh_token: 'synthetic-refresh', expires_in: 3600, scope });
  };
  const first = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, fake, () => now, store);
  await first.finish(new URL(first.start()).searchParams.get('state'), 'code');
  assert.doesNotMatch(saved!, /first/); assert.match(saved!, /synthetic-refresh/);
  const second = new GoogleAuth({ client_id: 'id', client_secret: 'secret' }, fake, () => now, store);
  await second.restore();
  assert.equal(second.status().connected, true);
  assert.equal(await second.withAccessToken(scope, async (token) => token), 'renewed');
  now += 4000 * 1000; reject = true;
  await assert.rejects(second.withAccessToken(scope, async (token) => token), /authorization_required/);
  assert.equal(cleared, true); assert.equal(second.status().connected, false);
  assert.deepEqual(grants, ['authorization_code', 'refresh_token', 'refresh_token']);
});
