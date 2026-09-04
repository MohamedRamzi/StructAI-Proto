import { Router } from 'express';
import { getLlmSettings } from '../db.js';
import { analyzeQuery } from '../services/llm-client.js';
import { detectMissingFields } from '../services/validation.js';
import { requireApiKeyOrAuth } from '../auth/middleware.js';

export const analyzeRouter = Router();

/**
 * The core of this service: takes a raw client request, concatenates it with
 * QuotationPrompt.md (see services/financial-parser-prompt.ts, loaded into
 * services/llm-client.ts's system prompt) as the system prompt, runs it
 * through the configured LLM (services/llm-client.ts), and returns the
 * recognized JSON per quote — flagging any required field the model could
 * not extract (services/validation.ts) instead of silently defaulting it.
 */
analyzeRouter.post('/', requireApiKeyOrAuth, async (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ success: false, error: 'query (texte de la demande client) est requis.' });
  }

  try {
    const settings = getLlmSettings();
    const outcome = await analyzeQuery(query, {
      provider: settings.provider as any,
      modelName: settings.modelName,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      temperature: settings.temperature,
    });

    if (outcome.rawQuotes.length === 0) {
      return res.status(502).json({ success: false, error: "Le moteur LLM configuré n'a retourné aucune cotation exploitable." });
    }

    const quotes = outcome.rawQuotes.map((extraction, index) => ({
      quoteId: extraction.quoteId ?? index + 1,
      label: extraction.label || extraction.productTypeName || `Cotation ${index + 1}`,
      extraction,
      missingFields: detectMissingFields(extraction),
    }));

    return res.json({
      success: true,
      providerUsed: outcome.providerUsed,
      modelUsed: outcome.modelUsed,
      quotes,
    });
  } catch (err: any) {
    console.error('[quotation-service] /api/analyze error:', err);
    return res.status(500).json({ success: false, error: err.message || "Erreur lors de l'analyse de la demande." });
  }
});
