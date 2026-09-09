import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { STOCK_DATABASE, findUnderlyingByTickerOrQuery } from './src/data/underlyings-db.js';
import { PRODUCT_CATALOG } from './src/data/product-taxonomy.js';
import { priceStructuredProduct } from './src/services/quant-pricer.js';
import { buildExtractedProductSpec } from './src/services/spec-builder.js';
import { UnderlyingAsset } from './src/types/structured-product.js';

const currentFilePath = typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : (typeof __filename !== 'undefined' ? __filename : process.cwd());
const currentDirPath = path.dirname(currentFilePath);

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (_req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const PORT = Number(process.env.PORT) || 3000;
const LOG_FILE_PATH = path.join(process.cwd(), 'llm_debug.log');

// Both the NLP analysis layer (prompt + LLM call + missing-field detection)
// and the qualitative/semantic search over underlyings (embeddings + ChromaDB)
// are delegated to the standalone inference-service (see inference-service/),
// a single Python/FastAPI service backed by vLLM (run as HTTP sidecars — see
// inference-service/README.md), reached with a service API key generated
// from its admin UI (http://localhost:4001/admin/login.html). This replaces
// the former quotation-service + vector-service pair.
const INFERENCE_SERVICE_URL = (process.env.INFERENCE_SERVICE_URL || 'http://localhost:4001').replace(/\/$/, '');
const INFERENCE_SERVICE_API_KEY = process.env.INFERENCE_SERVICE_API_KEY || '';

export function appendLlmLogToFile(data: {
  source?: string;
  provider?: string;
  model?: string;
  title?: string;
  prompt?: string;
  rawResponse?: string;
  parsedResult?: any;
  error?: string;
}) {
  try {
    const timestamp = new Date().toISOString();
    const divider = '='.repeat(80);
    let content = `\n${divider}\n[${timestamp}] LLM DIALOG LOG | Source: ${data.source || 'Server'} | Provider: ${data.provider || 'unknown'} | Model: ${data.model || 'unknown'}\nTitle: ${data.title || 'LLM Interaction'}\n${'-'.repeat(80)}\n`;

    if (data.prompt) {
      content += `>>> PROMPT SENT TO MODEL:\n${data.prompt}\n\n`;
    }
    if (data.rawResponse) {
      content += `<<< RAW RESPONSE FROM MODEL (COMPLETE & UNTRUNCATED):\n${data.rawResponse}\n\n`;
    }
    if (data.parsedResult) {
      content += `<<< PARSED RESULT JSON:\n${JSON.stringify(data.parsedResult, null, 2)}\n\n`;
    }
    if (data.error) {
      content += `!!! ERROR DETECTED:\n${data.error}\n\n`;
    }
    content += `${divider}\n`;

    fs.appendFileSync(LOG_FILE_PATH, content, 'utf-8');
    console.log(`[LLM Debug File] Appended log entry to ${LOG_FILE_PATH}`);
  } catch (err: any) {
    console.error('[LLM Log File Error] Failed to write to llm_debug.log:', err.message);
  }
}

function isServerDebugEnabled(): boolean {
  return process.env.DEBUG_LLM === 'true' || process.env.DEBUG_LLM === '1' || process.env.VITE_DEBUG_LLM === 'true' || process.env.VITE_DEBUG_LLM === '1';
}

function logServerLlmDebug(title: string, content: any) {
  if (!isServerDebugEnabled()) return;
  console.log(`\n==================== [DEBUG_LLM SERVER] ${title} ====================`);
  if (typeof content === 'string') {
    console.log(content);
  } else {
    console.dir(content, { depth: null });
  }
  console.log(`=======================================================================\n`);
}

// API Endpoint 0: Public status of the configured chat engine, proxied from
// inference-service (used by the frontend's read-only "Moteur LLM: ..." badge
// — see src/components/Header.tsx).
app.get('/api/llm-status', async (_req, res) => {
  const adminUrl = `${INFERENCE_SERVICE_URL}/admin/login.html`;
  try {
    const statusRes = await fetch(`${INFERENCE_SERVICE_URL}/api/status`);
    const statusData: any = await statusRes.json();
    if (!statusRes.ok || !statusData.success) {
      throw new Error(statusData.error || `HTTP ${statusRes.status}`);
    }
    return res.json({ success: true, provider: 'inference-service', modelName: statusData.chatModel, adminUrl });
  } catch (err: any) {
    return res.status(503).json({ success: false, error: `inference-service indisponible sur ${INFERENCE_SERVICE_URL} : ${err.message}`, adminUrl });
  }
});

// API Endpoint 0.2: Public status of the configured embedding engine, proxied from inference-service.
app.get('/api/vector-status', async (_req, res) => {
  const adminUrl = `${INFERENCE_SERVICE_URL}/admin/login.html`;
  try {
    const statusRes = await fetch(`${INFERENCE_SERVICE_URL}/api/status`);
    const statusData: any = await statusRes.json();
    if (!statusRes.ok || !statusData.success) {
      throw new Error(statusData.error || `HTTP ${statusRes.status}`);
    }
    return res.json({ success: true, provider: 'inference-service', model: statusData.embeddingModel, adminUrl });
  } catch (err: any) {
    return res.status(503).json({ success: false, error: `inference-service indisponible sur ${INFERENCE_SERVICE_URL} : ${err.message}`, adminUrl });
  }
});

// API Endpoint 0.3: Semantic search over underlyings — proxies to inference-service's real
// embeddings (vLLM sidecar) + ChromaDB index. Deliberately no local fallback on failure
// (see /api/parse-query's comment on the same principle): a search failure must surface
// as a clear error, not a silently degraded result.
app.post('/api/instruments/search', async (req, res) => {
  if (!INFERENCE_SERVICE_API_KEY) {
    return res.status(503).json({
      success: false,
      error: "Le service d'inférence (inference-service) n'est pas configuré : INFERENCE_SERVICE_API_KEY est manquante dans .env. Générez une clé depuis sa page d'admin (voir inference-service/README.md).",
    });
  }

  let searchRes: Response;
  try {
    searchRes = await fetch(`${INFERENCE_SERVICE_URL}/api/instruments/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INFERENCE_SERVICE_API_KEY}` },
      body: JSON.stringify(req.body),
    });
  } catch (networkErr: any) {
    return res.status(503).json({
      success: false,
      error: `Service d'inférence (inference-service) indisponible : ${networkErr.message}. Vérifiez qu'il tourne sur ${INFERENCE_SERVICE_URL}.`,
    });
  }

  const searchData: any = await searchRes.json();
  if (!searchRes.ok || !searchData.success) {
    return res.status(502).json({ success: false, error: `Échec de la recherche sémantique : ${searchData.error || `inference-service a répondu ${searchRes.status}`}` });
  }
  return res.json(searchData);
});

// Server-side in-memory underlyings database state (synced with client)
let serverUnderlyingsDb = [...STOCK_DATABASE];

// API Endpoint 0.1: Sync Underlyings Database between Frontend and Server (Matches all /api/underlyings endpoints)
app.all('/api/underlyings*', (req, res) => {
  try {
    const underlyings = req.body?.underlyings;
    if (Array.isArray(underlyings) && underlyings.length > 0) {
      serverUnderlyingsDb = underlyings;
      console.log(`[Underlyings Sync] Backend database updated (${serverUnderlyingsDb.length} underlyings active).`);
    }
    return res.json({ success: true, count: serverUnderlyingsDb.length, underlyings: serverUnderlyingsDb });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Resolves an underlying via inference-service's real semantic search (embeddings +
 * ChromaDB) instead of the local deterministic ticker/keyword matcher — used by
 * POST /api/parse-query when the caller opts in via `useVectorSearchForUnderlying`
 * (see the checkbox in QueryParserWorkbench.tsx). Maps the top hit into the app's
 * UnderlyingAsset shape (same mapping as VectorUnderlyingSearchModal.tsx's client-side
 * searchInstruments, duplicated here since this call happens server-side).
 *
 * Deliberately returns null rather than throwing on any failure (service down,
 * no API key configured, no results, or a rejected mismatch — see below): this is
 * an optional resolution STRATEGY, not the core LLM extraction step the project's
 * "no silent fallback" rule targets — the caller falls back to the local matcher
 * and the response still succeeds, just without the vector-search-refined pick.
 * Every rejection is still logged server-side for visibility.
 */
async function resolveUnderlyingViaVectorSearch(queryText: string): Promise<UnderlyingAsset | null> {
  if (!queryText || !queryText.trim() || !INFERENCE_SERVICE_API_KEY) return null;

  try {
    const searchRes = await fetch(`${INFERENCE_SERVICE_URL}/api/instruments/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INFERENCE_SERVICE_API_KEY}` },
      body: JSON.stringify({ query: queryText, assetClass: 'EQUITY', limit: 1 }),
    });
    const searchData: any = await searchRes.json();
    if (!searchRes.ok || !searchData.success || !searchData.results?.length) {
      if (!searchData?.success) console.warn(`[Vector Underlying Resolution] Échec ou aucun résultat pour "${queryText}": ${searchData?.error || `HTTP ${searchRes.status}`}`);
      return null;
    }

    const top = searchData.results[0];

    // A vector search always returns its best-available match, even when nothing in
    // the index is actually relevant (e.g. searching "FP FP" against an index that
    // only contains "MC FP" still returns "MC FP", just with a mediocre score) — so
    // when the query text itself looks like an explicit Bloomberg ticker (e.g. "MC FP",
    // "TSLA US"), require the top hit's own code to actually match it before trusting
    // it. Free-text / thematic queries ("un stock européen du luxe qui price bien")
    // skip this check entirely: that fuzziness is exactly what semantic search is for.
    const normalize = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
    const looksLikeExplicitTicker = /^[A-Z0-9]{1,6}\s+[A-Z]{2,6}(\s+INDEX)?$/i.test(queryText.trim());
    if (looksLikeExplicitTicker && normalize(top.code) !== normalize(queryText)) {
      console.warn(`[Vector Underlying Resolution] "${queryText}" ressemble à un ticker explicite mais le meilleur résultat vectoriel ("${top.code}") ne correspond pas — repli sur le matcher local.`);
      return null;
    }

    const meta = top.metadata || {};
    const resolved: UnderlyingAsset = {
      ticker: top.code,
      name: top.name,
      sector: meta.sector || '',
      region: meta.region || '',
      spotPrice: meta.spotPrice ?? 0,
      currency: meta.currency || 'EUR',
      impliedVol3m: meta.impliedVol3m ?? 0,
      dividendYield: meta.dividendYield ?? 0,
      repoRate: meta.repoRate ?? 0,
      volatilityScore: meta.volatilityScore || 'MEDIUM',
      isin: meta.isin || undefined,
      reasoningForRecommendation: meta.reasoningForRecommendation || undefined,
    };
    return resolved;
  } catch (networkErr: any) {
    console.warn(`[Vector Underlying Resolution] inference-service indisponible pour "${queryText}": ${networkErr.message}`);
    return null;
  }
}

// API Endpoint 1: Parse Natural Language Query — delegates the actual NLP analysis
// (prompt + LLM call + missing-field detection) to inference-service's POST /api/analyze,
// then builds the priced ExtractedProductSpec locally (underlying resolution + Monte
// Carlo pricing stay app-side; see src/services/spec-builder.ts, quant-pricer.ts).
app.post('/api/parse-query', async (req, res) => {
  try {
    const { query, useVectorSearchForUnderlying } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'La requête en langage naturel est requise.' });
    }

    console.log(`[Parse Query] Processing query: "${query}"`);
    logServerLlmDebug('PARSE QUERY REQUEST RECEIVED', { query, body: req.body });

    if (!INFERENCE_SERVICE_API_KEY) {
      return res.status(503).json({
        error: "Le service d'inférence (inference-service) n'est pas configuré : INFERENCE_SERVICE_API_KEY est manquante dans .env. Générez une clé depuis sa page d'admin (voir inference-service/README.md).",
      });
    }

    // Two distinct failure modes are deliberately reported differently: the service
    // being unreachable (infra issue, fix = start it) vs. the service responding but
    // the LLM extraction itself failing (bad API key, model error, ...). Neither one
    // falls back to a local deterministic guess — the analysis logic lives in exactly
    // one place (inference-service), and a failed extraction must surface as a clear
    // error to the user rather than being silently masked by an ad hoc fallback.
    let analyzeRes: Response;
    try {
      logServerLlmDebug('CALLING INFERENCE-SERVICE /api/analyze', { url: `${INFERENCE_SERVICE_URL}/api/analyze`, query });
      analyzeRes = await fetch(`${INFERENCE_SERVICE_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INFERENCE_SERVICE_API_KEY}` },
        body: JSON.stringify({ query }),
      });
    } catch (networkErr: any) {
      console.error('[Parse Query] inference-service unreachable:', networkErr.message);
      logServerLlmDebug('INFERENCE SERVICE UNREACHABLE', networkErr.message);
      return res.status(503).json({
        error: `Service d'analyse NLP (inference-service) indisponible : ${networkErr.message}. Vérifiez qu'il tourne sur ${INFERENCE_SERVICE_URL} ("npm run dev" dans inference-service/).`,
      });
    }

    const analyzeData: any = await analyzeRes.json();
    if (!analyzeRes.ok || !analyzeData.success) {
      console.error('[Parse Query] LLM analysis failed:', analyzeData.error);
      logServerLlmDebug('LLM ANALYSIS FAILED', analyzeData.error);
      return res.status(502).json({
        error: `Échec de l'analyse de la demande par le moteur LLM : ${analyzeData.error || `inference-service a répondu ${analyzeRes.status}`}`,
      });
    }

    logServerLlmDebug('INFERENCE SERVICE RESPONSE', analyzeData);

    appendLlmLogToFile({
      source: 'Server Backend (via inference-service)',
      provider: 'inference-service',
      model: analyzeData.modelUsed,
      title: `Parse Query: "${query}"`,
      prompt: `User Request: "${query}"`,
      rawResponse: JSON.stringify(analyzeData.quotes, null, 2),
      parsedResult: analyzeData.quotes,
    });

    // Resolve underlying + build the full ExtractedProductSpec (shared with the CLI
    // tool, see src/services/spec-builder.ts) for EACH quote returned by
    // inference-service, then price it via the quant engine. Any field
    // inference-service flagged as missing (quote.missingFields) is merged into
    // spec.missingRequiredParams, reusing the UI's existing display for it.
    //
    // Underlying resolution strategy: by default the local deterministic matcher
    // (findUnderlyingByTickerOrQuery, run inside buildExtractedProductSpec) is used.
    // When `useVectorSearchForUnderlying` is set, the LLM-extracted
    // underlyingQueryOrTicker (or, failing that, the underlying selection note or
    // the raw query) is sent instead to inference-service's real semantic search
    // — see resolveUnderlyingViaVectorSearch — and its top hit is used directly.
    const activeDb = req.body.underlyingsDb || req.body.underlyings || serverUnderlyingsDb;
    const quotes = await Promise.all((analyzeData.quotes || []).map(async (quote: any, index: number) => {
      let vectorResolvedUnderlying: UnderlyingAsset | null = null;
      if (useVectorSearchForUnderlying) {
        const vectorQueryText = quote.extraction?.underlyingQueryOrTicker || quote.extraction?.underlyingSelectionNote || query;
        vectorResolvedUnderlying = await resolveUnderlyingViaVectorSearch(vectorQueryText);
      }

      const { spec, underlyingMatches } = buildExtractedProductSpec({
        query,
        parsedJson: quote.extraction,
        underlyingsDb: activeDb,
        externalMissingFields: quote.missingFields,
        vectorResolvedUnderlying: vectorResolvedUnderlying || undefined,
      });
      const pricing = priceStructuredProduct(spec);
      return {
        quoteId: quote.quoteId ?? index + 1,
        label: quote.label || spec.productTypeName || `Cotation ${index + 1}`,
        spec,
        pricing,
        underlyingMatches,
      };
    }));

    if (quotes.length === 0) {
      return res.status(502).json({ error: "inference-service n'a retourné aucune cotation exploitable." });
    }

    logServerLlmDebug('FINAL PRICING CALCULATED', { quotes });

    return res.json({
      success: true,
      spec: quotes[0].spec,
      pricing: quotes[0].pricing,
      underlyingMatches: quotes[0].underlyingMatches,
      quotes,
    });
  } catch (error: any) {
    console.error('[Parse Query Error]', error);
    logServerLlmDebug('PARSE QUERY ENDPOINT FATAL ERROR', error.message);
    return res.status(500).json({
      error: 'Erreur lors du traitement de la requête.',
      details: error.message,
    });
  }
});

// API Endpoint 2: Re-price Custom Grid Parameters
app.post('/api/price-custom', (req, res) => {
  try {
    const { spec } = req.body;
    if (!spec) {
      return res.status(400).json({ error: 'La spécification du produit est requise.' });
    }
    const pricing = priceStructuredProduct(spec);
    return res.json({ success: true, pricing });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// API Endpoint 3: Underlying Stocks Search & Recommendation
app.post('/api/underlyings/search', (req, res) => {
  const { query } = req.body;
  const result = findUnderlyingByTickerOrQuery(query || '');
  return res.json(result);
});

// API Endpoint 4: Get 100+ Product Catalog
app.get('/api/products/catalog', (req, res) => {
  return res.json({
    totalProductsCount: 100, // Taxonomy catalog covering ~100 derivative specs
    categories: ['YIELD_ENHANCEMENT', 'CAPITAL_PROTECTION', 'PARTICIPATION', 'CREDIT_HYBRID', 'LEVERAGE'],
    catalog: PRODUCT_CATALOG,
  });
});

// API Endpoint 5: Append Client or Server LLM Dialog directly into llm_debug.log
app.post('/api/log-llm', (req, res) => {
  try {
    const { source, provider, model, title, prompt, rawResponse, parsedResult, error } = req.body;
    appendLlmLogToFile({
      source: source || 'client',
      provider,
      model,
      title,
      prompt,
      rawResponse,
      parsedResult,
      error,
    });
    return res.json({ success: true, message: 'Entrée enregistrée dans llm_debug.log' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// API Endpoint 6: Read full llm_debug.log file
app.get('/api/llm-logs', (req, res) => {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const logs = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
      return res.type('text/plain').send(logs);
    }
    return res.type('text/plain').send('Fichier llm_debug.log vide ou non encore créé. Effectuez des requêtes LLM pour le générer.');
  } catch (err: any) {
    return res.status(500).send(`Erreur de lecture de llm_debug.log: ${err.message}`);
  }
});

// API Endpoint 7: Clear llm_debug.log file
app.delete('/api/llm-logs', (req, res) => {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      fs.writeFileSync(LOG_FILE_PATH, '', 'utf-8');
    }
    return res.json({ success: true, message: 'Le fichier llm_debug.log a été réinitialisé.' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Cross-platform browser opener helper
function openBrowser(url: string) {
  const startCmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
  
  import('child_process').then(({ exec }) => {
    exec(`${startCmd} ${url}`, (err) => {
      if (err) {
        console.log(`[Auto-Open] Information: Impossible d'ouvrir automatiquement le navigateur (${err.message})`);
      } else {
        console.log(`[Auto-Open] Navigateur ouvert sur ${url}`);
      }
    });
  }).catch(() => {});
}

// Vite Middleware Integration for Dev / Static Serving for Prod
async function setupServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Structured Products AI Pricing Engine running at ${url}`);
    
    // Automatically open browser tab on dev launch
    if (process.env.NODE_ENV !== 'production' && !process.env.NO_OPEN) {
      openBrowser(url);
    }
  });
}

setupServer();

