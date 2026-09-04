import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { configRouter } from './routes/config.js';
import { apiKeysRouter } from './routes/api-keys.js';
import { analyzeRouter } from './routes/analyze.js';
import { statusRouter } from './routes/status.js';

const currentDirPath = path.dirname(fileURLToPath(import.meta.url));

/**
 * The configured Express app, with no listener attached — imported directly
 * by tests (via supertest) so they never need to bind a real port. src/server.ts
 * is the only place that calls app.listen(), for actually running the service.
 */
export const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'quotation-service' }));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/config', configRouter);
app.use('/api/api-keys', apiKeysRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/status', statusRouter);

// Static admin UI (plain HTML/CSS/JS, no build step) — served at /admin/*.
app.use('/admin', express.static(path.join(currentDirPath, '..', 'public', 'admin')));

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route inconnue.' });
});
