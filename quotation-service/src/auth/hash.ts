import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/**
 * Synchronous on purpose: node:sqlite's DatabaseSync API (see ../db.ts) is
 * itself fully synchronous, and this is a low-traffic internal admin
 * service — keeping password hashing sync avoids awkward async/sync
 * mixing around DB reads/writes for no real benefit at this scale.
 */
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}
