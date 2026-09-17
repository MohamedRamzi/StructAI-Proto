import { ExtractedProductSpec, PricingResult } from '../types/structured-product';
import { saveCalculationToHistory } from './history-storage';

export interface QuoteBundle {
  quoteId: number;
  label: string;
  spec: ExtractedProductSpec;
  pricing: PricingResult;
  underlyingMatches?: any[];
  // --- routed pipeline (inference-service) metadata, see src/services/analyze-adapter.ts ---
  /** e.g. "autocall/v1", "generic/v1", "rates/v1". */
  schemaVersion?: string;
  routing?: {
    assetClass: string | null;
    productFamily: string | null;
    promptKey: string;
    scopePrecision: number;
    routerConfidence: number | null;
    assetClassCorrectedFrom?: string | null;
  } | null;
  /** false for families with no local pricer yet (rates/fx/credit) — spec/pricing are then absent. */
  pricingAvailable?: boolean;
  /** Present when !pricingAvailable — the raw rich extraction, for display. */
  richExtraction?: Record<string, any>;
  /** Present when !pricingAvailable — why no price grid is shown. */
  degradationReason?: string;
  missingFields?: { field: string; label: string; message: string }[];
}

export interface ParseQueryResult {
  success: boolean;
  spec?: ExtractedProductSpec;
  pricing?: PricingResult;
  quotes?: QuoteBundle[]; // Multi-quote batch support
  underlyingMatches?: any[];
  error?: string;
  providerUsed?: string;
  modelUsed?: string;
  /** "routed" (default) | "single" — which inference-service pipeline produced this. */
  pipeline?: string;
}

export function isLlmDebugEnabled(): boolean {
  try {
    if (typeof window !== 'undefined' && (window as any).DEBUG_LLM) return true;
    const metaEnv = (import.meta as any).env;
    if (metaEnv) {
      if (metaEnv.VITE_DEBUG_LLM === 'true' || metaEnv.VITE_DEBUG_LLM === '1') return true;
      if (metaEnv.DEBUG_LLM === 'true' || metaEnv.DEBUG_LLM === '1') return true;
    }
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.DEBUG_LLM === 'true' || process.env.DEBUG_LLM === '1') return true;
      if (process.env.VITE_DEBUG_LLM === 'true' || process.env.VITE_DEBUG_LLM === '1') return true;
    }
  } catch (e) {
    // Ignore
  }
  return false;
}

export function logLlmDebug(title: string, content: any) {
  if (!isLlmDebugEnabled()) return;
  console.log(`%c[DEBUG_LLM] === ${title} ===`, 'color: #3b82f6; font-weight: bold; font-size: 13px;');
  if (typeof content === 'string') {
    console.log(content);
  } else {
    console.dir(content, { depth: null });
  }
}

export async function sendLlmLogToServer(data: {
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
    await fetch('/api/log-llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (e) {
    // Silent fail for log transmission
  }
}

/**
 * Runs a client request through the NLP analysis pipeline and returns the
 * priced spec (or specs, for a multi-quote request).
 *
 * The actual prompt-concatenation + LLM call + missing-field detection now
 * lives entirely in the standalone inference-service (see
 * ../inference-service/app/routers/analyze.py) — this just calls the main app's
 * own POST /api/parse-query, which proxies to inference-service and then
 * resolves the underlying + prices the result (see server.ts, spec-builder.ts).
 * The LLM provider/model is configured centrally there (its admin UI), not
 * per-browser-session. Underlyings are resolved server-side against
 * inference-service's instrument corpus (semantic search) — the single source.
 */
export async function parseFinancialQuery(
  query: string,
  options?: { reasoningMode?: 'auto' | 'fast' | 'thinking' }
): Promise<ParseQueryResult> {
  logLlmDebug('LLM PARSE QUERY STARTED', { query, options });

  try {
    const res = await fetch('/api/parse-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        ...(options?.reasoningMode ? { reasoningMode: options.reasoningMode } : {}),
      }),
    });
    const data = await res.json();
    logLlmDebug('BACKEND PARSE QUERY RESPONSE', data);

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erreur lors du traitement par le serveur backend.');
    }

    if (data.spec && data.pricing) {
      saveCalculationToHistory(data.spec, data.pricing);
    }

    return data;
  } catch (err: any) {
    console.error('[LLM Parse Query Error]', err);
    logLlmDebug('LLM PARSE QUERY ERROR', err.message || err);
    return {
      success: false,
      error: err.message || 'Échec du traitement de la demande.',
    };
  }
}
