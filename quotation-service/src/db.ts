import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { hashPassword, verifyPassword } from './auth/hash.js';

export type UserRole = 'admin' | 'user';

export interface UserRecord {
  id: number;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
}

export interface LlmSettingsRecord {
  provider: string;
  modelName: string;
  baseUrl: string;
  apiKey: string | null;
  temperature: number;
  updatedAt: string;
}

export interface ApiKeyRecord {
  id: number;
  label: string;
  keyPrefix: string;
  createdBy: number | null;
  createdAt: string;
  revokedAt: string | null;
}

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'quotation-service.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS llm_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL DEFAULT 'gemini',
    model_name TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT,
    temperature REAL NOT NULL DEFAULT 0.1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT
  );
`);

function mapUserRow(row: any): UserRecord {
  return { id: row.id, email: row.email, passwordHash: row.password_hash, role: row.role, createdAt: row.created_at };
}

function mapLlmSettingsRow(row: any): LlmSettingsRecord {
  return {
    provider: row.provider,
    modelName: row.model_name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    temperature: row.temperature,
    updatedAt: row.updated_at,
  };
}

function mapApiKeyRow(row: any): ApiKeyRecord {
  return { id: row.id, label: row.label, keyPrefix: row.key_prefix, createdBy: row.created_by, createdAt: row.created_at, revokedAt: row.revoked_at };
}

// --- Bootstrap: default admin account + default LLM settings row ---
function bootstrap() {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const email = process.env.ADMIN_EMAIL || 'admin@structai.local';
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, hashPassword(password), 'admin');
    const passwordNote = process.env.ADMIN_PASSWORD ? '' : ` (mot de passe généré : ${password} — changez-le après connexion)`;
    console.log(`[quotation-service] Compte admin initial créé : ${email}${passwordNote}`);
  }

  const settingsRow = db.prepare('SELECT id FROM llm_settings WHERE id = 1').get();
  if (!settingsRow) {
    // Always bootstrap as "gemini" — there is no deterministic fallback provider.
    // GEMINI_API_KEY is only used as an initial convenience if present; if it's
    // absent, apiKey stays null and POST /api/analyze will fail with a clear,
    // explicit error until an admin configures a real key or a different
    // provider from the admin UI — never a silently degraded extraction.
    const geminiKey = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ? process.env.GEMINI_API_KEY
      : null;
    db.prepare(
      'INSERT INTO llm_settings (id, provider, model_name, base_url, api_key, temperature) VALUES (1, ?, ?, ?, ?, ?)'
    ).run('gemini', 'gemini-3.5-flash', '', geminiKey, 0.1);
  }
}

bootstrap();

// --- Users ---

export function listUsers(): Omit<UserRecord, 'passwordHash'>[] {
  const rows = db.prepare('SELECT id, email, role, created_at FROM users ORDER BY id ASC').all() as any[];
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at }));
}

export function findUserByEmail(email: string): UserRecord | undefined {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
  return row ? mapUserRow(row) : undefined;
}

export function findUserById(id: number): UserRecord | undefined {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  return row ? mapUserRow(row) : undefined;
}

export function createUser(email: string, password: string, role: UserRole): UserRecord {
  const result = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, hashPassword(password), role);
  return findUserById(Number(result.lastInsertRowid))!;
}

export function updateUser(id: number, fields: { role?: UserRole; password?: string }): UserRecord | undefined {
  if (fields.role !== undefined) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(fields.role, id);
  }
  if (fields.password !== undefined) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(fields.password), id);
  }
  return findUserById(id);
}

export function deleteUser(id: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function verifyUserCredentials(email: string, password: string): UserRecord | null {
  const user = findUserByEmail(email);
  if (!user) return null;
  return verifyPassword(password, user.passwordHash) ? user : null;
}

// --- LLM settings ---

export function getLlmSettings(): LlmSettingsRecord {
  const row = db.prepare('SELECT * FROM llm_settings WHERE id = 1').get() as any;
  return mapLlmSettingsRow(row);
}

export function updateLlmSettings(
  fields: { provider?: string; modelName?: string; baseUrl?: string; apiKey?: string | null; temperature?: number },
  updatedBy: number
): LlmSettingsRecord {
  const current = getLlmSettings();
  db.prepare(
    'UPDATE llm_settings SET provider = ?, model_name = ?, base_url = ?, api_key = ?, temperature = ?, updated_at = datetime(\'now\'), updated_by = ? WHERE id = 1'
  ).run(
    fields.provider ?? current.provider,
    fields.modelName ?? current.modelName,
    fields.baseUrl ?? current.baseUrl,
    fields.apiKey !== undefined ? fields.apiKey : current.apiKey,
    fields.temperature ?? current.temperature,
    updatedBy
  );
  return getLlmSettings();
}

// --- API keys ---
// Token format: "qsk_<row id>_<random secret>" — the id gives O(1) lookup, the
// random secret is bcrypt-hashed (never stored/logged in plaintext) and
// compared on each request. The plaintext token is only ever returned once,
// at creation time, matching standard API-key UX (GitHub, Stripe, etc.).

export function listApiKeys(): ApiKeyRecord[] {
  const rows = db.prepare('SELECT id, label, key_prefix, created_by, created_at, revoked_at FROM api_keys ORDER BY id DESC').all() as any[];
  return rows.map(mapApiKeyRow);
}

export function createApiKey(label: string, createdBy: number): { record: ApiKeyRecord; plainToken: string } {
  const secret = crypto.randomBytes(24).toString('base64url');
  const keyHash = hashPassword(secret);
  const keyPrefix = secret.slice(0, 8);
  const result = db.prepare('INSERT INTO api_keys (label, key_hash, key_prefix, created_by) VALUES (?, ?, ?, ?)').run(label, keyHash, keyPrefix, createdBy);
  const id = Number(result.lastInsertRowid);
  return {
    record: { id, label, keyPrefix, createdBy, createdAt: new Date().toISOString(), revokedAt: null },
    plainToken: `qsk_${id}_${secret}`,
  };
}

export function revokeApiKey(id: number): void {
  db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?").run(id);
}

/** Verifies a plaintext "qsk_<id>_<secret>" token against the stored hash. Returns the key's row id if valid and active, else null. */
export function verifyApiKeyToken(token: string): number | null {
  const match = token.match(/^qsk_(\d+)_(.+)$/);
  if (!match) return null;
  const id = Number(match[1]);
  const candidate = match[2];
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as any;
  if (!row || row.revoked_at) return null;
  return verifyPassword(candidate, row.key_hash) ? id : null;
}
