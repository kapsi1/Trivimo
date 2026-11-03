import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const scopes = ['https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly', 'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly'] as const;
const callback = 'http://127.0.0.1:3000/api/google/callback';
const credentialsSchema = z.object({ web: z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }).passthrough() }).passthrough();
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive(), scope: z.string().optional(), refresh_token: z.string().optional(), token_type: z.string().optional() }).passthrough();

type Credentials = z.infer<typeof credentialsSchema>['web'];
export class GoogleAuth {
  private pending?: { state: string; verifier: string; expires: number };
  private tokens?: { access: string; refresh?: string; expires: number; scopes: string[] };
  constructor(private readonly credentials: Credentials, private readonly send: typeof fetch = fetch, private readonly now: () => number = Date.now) {}
  static fromJson(data: unknown): GoogleAuth { return new GoogleAuth(credentialsSchema.parse(data).web); }
  start(): string {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    this.pending = { state, verifier, expires: this.now() + 10 * 60_000 };
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    const params = { client_id: this.credentials.client_id, redirect_uri: callback, response_type: 'code', scope: scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline' };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }
  async finish(state: string | null, code: string | null): Promise<void> {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending || !state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4096 || this.now() > pending.expires || state.length !== pending.state.length || !timingSafeEqual(Buffer.from(state), Buffer.from(pending.state))) throw new Error('invalid_callback');
    const body = new URLSearchParams({ code, client_id: this.credentials.client_id, client_secret: this.credentials.client_secret, redirect_uri: callback, grant_type: 'authorization_code', code_verifier: pending.verifier });
    const response = await this.send('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('token_exchange_failed');
    const token = tokenSchema.parse(await response.json());
    this.tokens = { access: token.access_token, refresh: token.refresh_token, expires: this.now() + token.expires_in * 1000, scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [] };
  }
  async withAccessToken<T>(scope: string, action: (token: string) => Promise<T>): Promise<T> {
    const token = this.tokens;
    if (!token || token.expires <= this.now()) throw new Error('authorization_required');
    if (!token.scopes.includes(scope)) throw new Error('scope_missing');
    return action(token.access);
  }
  status() { return { connected: !!this.tokens && this.tokens.expires > this.now(), grantedScopes: this.tokens?.scopes.filter((scope) => (scopes as readonly string[]).includes(scope)) ?? [], expiresAt: this.tokens ? new Date(this.tokens.expires).toISOString() : null }; }
}
