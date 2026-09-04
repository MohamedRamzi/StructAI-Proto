import { Router } from 'express';
import { getLlmSettings, updateLlmSettings } from '../db.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export const configRouter = Router();

const VALID_PROVIDERS = new Set(['gemini', 'ollama', 'lmstudio', 'openai_compatible']);

/** Any authenticated user can view the active config — but the API key is never returned in plaintext. */
configRouter.get('/llm', requireAuth, (_req, res) => {
  const settings = getLlmSettings();
  return res.json({
    success: true,
    config: {
      provider: settings.provider,
      modelName: settings.modelName,
      baseUrl: settings.baseUrl,
      temperature: settings.temperature,
      hasApiKey: !!settings.apiKey,
      updatedAt: settings.updatedAt,
    },
  });
});

configRouter.put('/llm', requireAuth, requireRole('admin'), (req, res) => {
  const { provider, modelName, baseUrl, apiKey, temperature } = req.body || {};

  if (provider !== undefined && !VALID_PROVIDERS.has(provider)) {
    return res.status(400).json({ success: false, error: `provider invalide. Valeurs autorisées : ${[...VALID_PROVIDERS].join(', ')}.` });
  }
  if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
    return res.status(400).json({ success: false, error: 'temperature doit être un nombre entre 0 et 2.' });
  }

  // apiKey omitted entirely -> keep existing key. apiKey: "" explicitly -> clear it.
  const updated = updateLlmSettings(
    { provider, modelName, baseUrl, apiKey: apiKey === undefined ? undefined : (apiKey === '' ? null : apiKey), temperature },
    req.user!.userId
  );

  return res.json({
    success: true,
    config: {
      provider: updated.provider,
      modelName: updated.modelName,
      baseUrl: updated.baseUrl,
      temperature: updated.temperature,
      hasApiKey: !!updated.apiKey,
      updatedAt: updated.updatedAt,
    },
  });
});
