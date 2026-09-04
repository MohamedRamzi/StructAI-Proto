import jwt from 'jsonwebtoken';
import type { UserRole } from '../db.js';

export interface AuthTokenPayload {
  userId: number;
  email: string;
  role: UserRole;
}

const JWT_EXPIRES_IN = '12h';

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '') {
    throw new Error('JWT_SECRET n\'est pas configuré (voir quotation-service/.env.example).');
  }
  return secret;
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: JWT_EXPIRES_IN });
}

/** Returns the decoded payload, or null if the token is missing/invalid/expired. */
export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, getSecret()) as unknown as AuthTokenPayload;
  } catch {
    return null;
  }
}
