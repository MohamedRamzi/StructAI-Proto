import { beforeAll, describe, expect, it } from 'vitest';
import { signAuthToken, verifyAuthToken } from './jwt.js';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-not-for-production';
});

describe('signAuthToken / verifyAuthToken', () => {
  it('round-trips a payload through sign then verify', () => {
    const token = signAuthToken({ userId: 1, email: 'admin@structai.local', role: 'admin' });
    const payload = verifyAuthToken(token);
    expect(payload).toMatchObject({ userId: 1, email: 'admin@structai.local', role: 'admin' });
  });

  it('returns null for a garbage token', () => {
    expect(verifyAuthToken('not-a-real-jwt')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const token = signAuthToken({ userId: 2, email: 'user@structai.local', role: 'user' });
    process.env.JWT_SECRET = 'a-different-secret';
    expect(verifyAuthToken(token)).toBeNull();
    process.env.JWT_SECRET = 'test-secret-not-for-production';
  });

  it('throws when JWT_SECRET is not configured', () => {
    delete process.env.JWT_SECRET;
    expect(() => signAuthToken({ userId: 1, email: 'a@b.com', role: 'user' })).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = 'test-secret-not-for-production';
  });
});
