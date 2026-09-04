import type { NextFunction, Request, Response } from 'express';
import { verifyAuthToken } from './jwt.js';
import { verifyApiKeyToken } from '../db.js';
import type { UserRole } from '../db.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { userId: number; email: string; role: UserRole };
      apiKeyId?: number;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.header('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Requires a valid JWT (human login via the admin UI). Populates req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentification requise (en-tête Authorization: Bearer <token> manquant).' });
  }
  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Token invalide ou expiré.' });
  }
  req.user = payload;
  next();
}

/** Requires requireAuth to have run first, and the authenticated user to hold `role`. */
export function requireRole(role: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentification requise.' });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ success: false, error: `Droits insuffisants — rôle "${role}" requis.` });
    }
    next();
  };
}

/**
 * Accepts EITHER a service API key (server-to-server, e.g. the main StructAI
 * app calling POST /api/analyze) OR a human JWT (e.g. testing the endpoint
 * directly from the admin UI / a logged-in session). Populates req.user
 * and/or req.apiKeyId depending on which credential was presented.
 */
export function requireApiKeyOrAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentification requise (clé API ou token JWT).' });
  }

  if (token.startsWith('qsk_')) {
    const apiKeyId = verifyApiKeyToken(token);
    if (!apiKeyId) {
      return res.status(401).json({ success: false, error: 'Clé API invalide ou révoquée.' });
    }
    req.apiKeyId = apiKeyId;
    return next();
  }

  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Token invalide ou expiré.' });
  }
  req.user = payload;
  next();
}
