import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './hash.js';

describe('hashPassword / verifyPassword', () => {
  it('produces a hash different from the original password', () => {
    const hash = hashPassword('correct-horse-battery-staple');
    expect(hash).not.toBe('correct-horse-battery-staple');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('verifies a matching password', () => {
    const hash = hashPassword('s3cret!');
    expect(verifyPassword('s3cret!', hash)).toBe(true);
  });

  it('rejects a non-matching password', () => {
    const hash = hashPassword('s3cret!');
    expect(verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('produces different hashes for the same password on different calls (salted)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(verifyPassword('same-password', a)).toBe(true);
    expect(verifyPassword('same-password', b)).toBe(true);
  });
});
