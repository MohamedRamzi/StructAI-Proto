import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Env vars must be set BEFORE db.ts (imported transitively by app.ts) runs its
// module-load-time bootstrap, hence the dynamic import inside beforeAll rather
// than a static top-level `import { app } from './app.js'`.
let app: Express;
let adminToken: string;

const FAKE_LLM_BASE_URL = 'http://fake-llm.test/v1';
const originalFetch = globalThis.fetch;

/** Set before each /api/analyze call to control what the stubbed LLM endpoint returns. */
let nextFakeQuotes: any[] = [];
let nextFakeStatus = 200;

function fakeChatCompletionBody() {
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify({ quotes: nextFakeQuotes }) } }] });
}

beforeAll(async () => {
  process.env.DB_PATH = ':memory:';
  process.env.JWT_SECRET = 'integration-test-secret';
  process.env.ADMIN_EMAIL = 'admin@test.local';
  process.env.ADMIN_PASSWORD = 'admin-test-password';
  delete process.env.GEMINI_API_KEY; // no accidental real Gemini calls from this suite

  // Stub fetch, but only for calls to our fake LLM endpoint — everything else (none,
  // in this suite: supertest talks to `app` in-process, not over fetch) passes through.
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && url.startsWith(FAKE_LLM_BASE_URL)) {
      return new Response(fakeChatCompletionBody(), { status: nextFakeStatus, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  const mod = await import('./app.js');
  app = mod.app;

  const loginRes = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'admin-test-password' });
  adminToken = loginRes.body.token;

  // Point the LLM config at our stubbed OpenAI-compatible endpoint so /api/analyze
  // tests are deterministic and network-free, without relying on any deterministic
  // fallback engine (quotation-service has none — a failed extraction must error out).
  await request(app).put('/api/config/llm').set('Authorization', `Bearer ${adminToken}`).send({
    provider: 'openai_compatible',
    modelName: 'test-model',
    baseUrl: FAKE_LLM_BASE_URL,
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

const FULL_EXTRACTION = {
  quoteId: 1,
  label: 'Autocall Classic',
  productTypeId: 'AUTOCALL_CLASSIC',
  productTypeName: 'Autocall Classic',
  productFamily: 'YIELD_ENHANCEMENT',
  targetToSolve: 'COUPON_RATE',
  underlyingQueryOrTicker: 'MC FP',
  maturityMonths: 36,
  forwardStartMonths: 0,
  observationFrequency: 'QUARTERLY',
  nonCallMonths: 12,
  currency: 'EUR',
  autocallBarrierPct: 100,
  pdiBarrierPct: 70,
  memoryCoupon: true,
  confidenceScore: 0.9,
  aiExplanation: 'test',
};

describe('POST /api/auth/login', () => {
  it('logs in the bootstrap admin and returns a JWT', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'admin-test-password' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({ email: 'admin@test.local', role: 'admin' });
    expect(typeof res.body.token).toBe('string');
  });

  it('rejects invalid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

describe('Role-based access control', () => {
  it('returns 401 on an admin route without a token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('blocks a non-admin user from user management (403)', async () => {
    await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({ email: 'member@test.local', password: 'member-password', role: 'user' });
    const loginRes = await request(app).post('/api/auth/login').send({ email: 'member@test.local', password: 'member-password' });
    const userToken = loginRes.body.token;

    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it('still lets a non-admin user read (but not write) the LLM config', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ email: 'member@test.local', password: 'member-password' });
    const userToken = loginRes.body.token;

    const getRes = await request(app).get('/api/config/llm').set('Authorization', `Bearer ${userToken}`);
    expect(getRes.status).toBe(200);

    const putRes = await request(app).put('/api/config/llm').set('Authorization', `Bearer ${userToken}`).send({ provider: 'gemini' });
    expect(putRes.status).toBe(403);
  });
});

describe('POST /api/analyze (via a generated service API key)', () => {
  it('creates an API key and uses it to call /api/analyze successfully', async () => {
    nextFakeQuotes = [FULL_EXTRACTION];
    nextFakeStatus = 200;

    const keyRes = await request(app).post('/api/api-keys').set('Authorization', `Bearer ${adminToken}`).send({ label: 'test-key' });
    expect(keyRes.status).toBe(201);
    const apiKeyToken = keyRes.body.token as string;
    expect(apiKeyToken).toMatch(/^qsk_/);

    const res = await request(app).post('/api/analyze').set('Authorization', `Bearer ${apiKeyToken}`).send({ query: 'Autocall LVMH PDI 70% 3 ans' });
    expect(res.status).toBe(200);
    expect(res.body.providerUsed).toBe('openai_compatible');
    expect(res.body.quotes[0].extraction.maturityMonths).toBe(36);
    expect(res.body.quotes[0].missingFields).toHaveLength(0);
  });

  it('flags a missing maturity in the response instead of silently defaulting it', async () => {
    nextFakeQuotes = [{ ...FULL_EXTRACTION, maturityMonths: null }];
    nextFakeStatus = 200;

    const keyRes = await request(app).post('/api/api-keys').set('Authorization', `Bearer ${adminToken}`).send({ label: 'test-key-2' });
    const apiKeyToken = keyRes.body.token as string;

    const res = await request(app).post('/api/analyze').set('Authorization', `Bearer ${apiKeyToken}`).send({ query: 'Autocall LVMH PDI 70%' });
    expect(res.status).toBe(200);
    expect(res.body.quotes[0].extraction.maturityMonths).toBeNull();
    expect(res.body.quotes[0].missingFields).toContainEqual(expect.objectContaining({ field: 'maturityMonths' }));
  });

  it('returns a clear error (no silent fallback) when the LLM endpoint itself fails', async () => {
    nextFakeStatus = 500; // simulates the configured LLM endpoint being broken/misconfigured

    const keyRes = await request(app).post('/api/api-keys').set('Authorization', `Bearer ${adminToken}`).send({ label: 'test-key-fail' });
    const apiKeyToken = keyRes.body.token as string;

    const res = await request(app).post('/api/analyze').set('Authorization', `Bearer ${apiKeyToken}`).send({ query: 'Autocall LVMH PDI 70% 3 ans' });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);

    nextFakeStatus = 200; // restore for subsequent tests
  });

  it('returns a clear error when the Gemini provider is selected without an API key configured (no deterministic fallback)', async () => {
    await request(app).put('/api/config/llm').set('Authorization', `Bearer ${adminToken}`).send({ provider: 'gemini', modelName: 'gemini-3.5-flash', apiKey: '' });

    const keyRes = await request(app).post('/api/api-keys').set('Authorization', `Bearer ${adminToken}`).send({ label: 'test-key-gemini' });
    const apiKeyToken = keyRes.body.token as string;

    const res = await request(app).post('/api/analyze').set('Authorization', `Bearer ${apiKeyToken}`).send({ query: 'Autocall LVMH PDI 70% 3 ans' });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/clé API Gemini/i);

    // Restore the stubbed provider for any subsequent test in this file.
    await request(app).put('/api/config/llm').set('Authorization', `Bearer ${adminToken}`).send({ provider: 'openai_compatible', modelName: 'test-model', baseUrl: FAKE_LLM_BASE_URL });
  });

  it('rejects a revoked API key', async () => {
    nextFakeQuotes = [FULL_EXTRACTION];

    const keyRes = await request(app).post('/api/api-keys').set('Authorization', `Bearer ${adminToken}`).send({ label: 'to-revoke' });
    const apiKeyToken = keyRes.body.token as string;
    const keyId = keyRes.body.apiKey.id;

    await request(app).delete(`/api/api-keys/${keyId}`).set('Authorization', `Bearer ${adminToken}`);

    const res = await request(app).post('/api/analyze').set('Authorization', `Bearer ${apiKeyToken}`).send({ query: 'Autocall LVMH PDI 70% 3 ans' });
    expect(res.status).toBe(401);
  });

  it('rejects a request with no query', async () => {
    const keyRes = await request(app).post('/api/api-keys').set('Authorization', `Bearer ${adminToken}`).send({ label: 'test-key-3' });
    const apiKeyToken = keyRes.body.token as string;

    const res = await request(app).post('/api/analyze').set('Authorization', `Bearer ${apiKeyToken}`).send({});
    expect(res.status).toBe(400);
  });
});

describe('Safety rails on user management', () => {
  it('prevents an admin from deleting their own account', async () => {
    const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app).delete(`/api/users/${meRes.body.user.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});
