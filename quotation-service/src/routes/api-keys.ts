import { Router } from 'express';
import { listApiKeys, createApiKey, revokeApiKey } from '../db.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export const apiKeysRouter = Router();

apiKeysRouter.use(requireAuth, requireRole('admin'));

apiKeysRouter.get('/', (_req, res) => {
  return res.json({ success: true, apiKeys: listApiKeys() });
});

apiKeysRouter.post('/', (req, res) => {
  const { label } = req.body || {};
  if (!label || String(label).trim() === '') {
    return res.status(400).json({ success: false, error: 'label est requis.' });
  }

  const { record, plainToken } = createApiKey(String(label).trim(), req.user!.userId);
  // The plaintext token is only ever returned here, at creation time — it is
  // not recoverable afterwards (only the hash is stored).
  return res.status(201).json({ success: true, apiKey: record, token: plainToken });
});

apiKeysRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  revokeApiKey(id);
  return res.status(204).send();
});
