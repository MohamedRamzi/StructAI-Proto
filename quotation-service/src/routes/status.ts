import { Router } from 'express';
import { getLlmSettings } from '../db.js';

export const statusRouter = Router();

/** Public, no-secret status — lets the main app show "Moteur LLM: provider · model" without auth. */
statusRouter.get('/', (_req, res) => {
  const settings = getLlmSettings();
  return res.json({
    success: true,
    provider: settings.provider,
    modelName: settings.modelName,
  });
});
