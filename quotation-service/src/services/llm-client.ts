import { GoogleGenAI, Type } from '@google/genai';
import { FINANCIAL_PARSER_SYSTEM_PROMPT } from './financial-parser-prompt.js';

export type LlmProvider = 'gemini' | 'ollama' | 'lmstudio' | 'openai_compatible';

export interface LlmSettings {
  provider: LlmProvider;
  modelName: string;
  baseUrl: string;
  apiKey: string | null;
  temperature: number;
}

export interface AnalyzeOutcome {
  providerUsed: string;
  modelUsed: string;
  /** One raw extraction object per quote — same shape QuotationPrompt.md documents (productTypeId, maturityMonths, forwardStartMonths, ...), plus optional quoteId/label. */
  rawQuotes: Record<string, any>[];
}

function isDebugEnabled(): boolean {
  return process.env.DEBUG_LLM === 'true' || process.env.DEBUG_LLM === '1';
}

function debugLog(title: string, content: any) {
  if (!isDebugEnabled()) return;
  console.log(`\n==== [quotation-service DEBUG] ${title} ====`);
  console.dir(content, { depth: null });
}

/**
 * Extracts and parses a JSON object/array from a string that may contain
 * Markdown formatting, reasoning tags (<think>...</think>), or raw prose
 * (Qwen/DeepSeek/Ollama-style outputs that don't strictly honor JSON mode).
 */
export function extractJsonFromText(rawText: string): any {
  if (!rawText || typeof rawText !== 'string') return null;

  const cleanedText = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  try {
    return JSON.parse(cleanedText);
  } catch {
    // continue
  }

  const jsonBlockMatch = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // continue
    }
  }

  const braceMatch = cleanedText.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch {
      // continue
    }
  }

  const bracketMatch = cleanedText.match(/\[[\s\S]*\]/);
  if (bracketMatch) {
    try {
      return JSON.parse(bracketMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

/** Normalizes a parsed LLM JSON payload into an array of per-quote raw extractions. */
function normalizeToRawQuotes(parsedJson: any): Record<string, any>[] {
  if (!parsedJson) return [];
  if (Array.isArray(parsedJson.quotes)) return parsedJson.quotes;
  if (Array.isArray(parsedJson.quote)) return parsedJson.quote;
  if (parsedJson.quotes && typeof parsedJson.quotes === 'object') return [parsedJson.quotes];
  if (Array.isArray(parsedJson)) return parsedJson;
  if (typeof parsedJson === 'object') return [parsedJson];
  return [];
}

// Single-quote object shape, reused as the "quotes" array item schema so Gemini's
// structured output can always return one-or-many quotes (see server-side history:
// a flat single-object schema silently dropped multi-quote requests).
const quoteItemSchema = {
  type: Type.OBJECT,
  properties: {
    quoteId: { type: Type.INTEGER, description: 'Index 1-based de la cotation dans la demande (1 pour la première, 2 pour la deuxième, etc.)' },
    label: { type: Type.STRING, description: "Libellé court de la cotation e.g. 'Cotation 1 - LVMH Autocall 3y'" },
    productTypeId: { type: Type.STRING, description: 'Identifiant du type de produit e.g. AUTOCALL_CLASSIC, PHOENIX_MEMORY, REVERSE_CONVERTIBLE' },
    productTypeName: { type: Type.STRING, description: 'Nom complet du produit e.g. Autocall Classic Forward Start' },
    productFamily: { type: Type.STRING, description: 'YIELD_ENHANCEMENT, CAPITAL_PROTECTION, PARTICIPATION, CREDIT_HYBRID, LEVERAGE' },
    targetToSolve: { type: Type.STRING, description: 'COUPON_RATE, STRIKE_LEVEL, PDI_BARRIER, CALL_BARRIER' },
    underlyingQueryOrTicker: { type: Type.STRING, description: 'Le ticker détecté ou la description de recherche sous-jacente (ex: MC FP ou stock européen luxe)' },
    // nullable: true is required here — maturityMonths is deliberately excluded from
    // `required` below and MUST be settable to null (see QuotationPrompt.md's rule on
    // never inventing a maturity). Without `nullable`, Gemini's structured output would
    // be forced to invent an integer (observed hallucinating 999999) rather than return
    // null, breaking the missing-maturity detection this service exists to provide.
    maturityMonths: { type: Type.INTEGER, nullable: true, description: 'Maturité totale en mois (ex: 36 pour 3 ans). null si non précisée dans la demande — ne jamais inventer une valeur.' },
    forwardStartMonths: { type: Type.INTEGER, description: 'Délai de départ forward en mois (ex: 3 pour départ forward dans 3 mois, 0 pour spot). Utiliser UNIQUEMENT pour une durée relative.' },
    forwardStartDate: { type: Type.STRING, description: "Date ABSOLUE de départ forward / première fixation au format ISO YYYY-MM-DD (ex: 'première fixation le 01/12/2026' -> '2026-12-01'). Omettre si seule une durée relative (forwardStartMonths) est mentionnée. Ne PAS convertir vous-même en mois." },
    observationFrequency: { type: Type.STRING, description: 'MONTHLY, QUARTERLY, SEMI_ANNUALLY, ANNUALLY' },
    nonCallMonths: { type: Type.INTEGER, description: 'Période de non-call en mois (ex: 12 pour NC 1y)' },
    currency: { type: Type.STRING, description: 'Devise (ex: EUR, USD)' },
    autocallBarrierPct: { type: Type.NUMBER, description: 'Barrière de rappel en % (ex: 100)' },
    pdiBarrierPct: { type: Type.NUMBER, description: 'Barrière PDI en % (ex: 70)' },
    memoryCoupon: { type: Type.BOOLEAN, description: 'Si coupon mémoire true/false' },
    confidenceScore: { type: Type.NUMBER, description: "Score de confiance de l'extraction de 0.0 à 1.0" },
    extractedTokens: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          phrase: { type: Type.STRING, description: 'Fragment du texte source e.g. NC 1y' },
          parameterName: { type: Type.STRING, description: 'Nom du paramètre e.g. nonCallMonths' },
          parsedValue: { type: Type.STRING, description: 'Valeur extraite e.g. 12 mois' },
        },
      },
    },
    aiExplanation: { type: Type.STRING, description: 'Explication pédagogique de la structuration et des termes identifiés en français' },
    underlyingSelectionNote: { type: Type.STRING, description: 'Remarque explicative sur le choix du sous-jacent ou la recommandation d\'action' },
  },
  // maturityMonths deliberately NOT required — it must be nullable (see field comment above).
  required: ['productTypeId', 'productTypeName', 'productFamily', 'targetToSolve', 'underlyingQueryOrTicker', 'forwardStartMonths', 'observationFrequency', 'nonCallMonths', 'currency', 'autocallBarrierPct', 'pdiBarrierPct', 'memoryCoupon', 'confidenceScore', 'aiExplanation'],
};

async function callGemini(query: string, settings: LlmSettings): Promise<AnalyzeOutcome> {
  const apiKey = settings.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Aucune clé API Gemini configurée (ni dans la config LLM, ni dans GEMINI_API_KEY).');
  }

  const aiClient = new GoogleGenAI({ apiKey });
  const response = await aiClient.models.generateContent({
    model: settings.modelName || 'gemini-3.5-flash',
    contents: `Analyse cette demande client de produit(s) structuré(s) et extrais la ou les spécification(s) complète(s) :\n"${query}"`,
    config: {
      systemInstruction: FINANCIAL_PARSER_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          quotes: {
            type: Type.ARRAY,
            description: 'Une entrée par cotation demandée. Un seul élément si la demande ne porte que sur une seule structure.',
            items: quoteItemSchema,
          },
        },
        required: ['quotes'],
      },
    },
  });

  debugLog('RAW GEMINI RESPONSE', response.text);
  const parsedJson = JSON.parse(response.text || '{}');
  return {
    providerUsed: 'gemini',
    modelUsed: settings.modelName || 'gemini-3.5-flash',
    rawQuotes: normalizeToRawQuotes(parsedJson),
  };
}

async function callOllama(query: string, settings: LlmSettings): Promise<AnalyzeOutcome> {
  const baseUrl = (settings.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  const userPrompt = `Analyse cette demande client de produit(s) structuré(s) et extrais les spécifications au format JSON :\n"${query}"`;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.modelName,
        messages: [
          { role: 'system', content: FINANCIAL_PARSER_SYSTEM_PROMPT },
          { role: 'user', content: `${userPrompt}\n\nIMPORTANT: Réponds uniquement avec l'objet JSON valide.` },
        ],
        stream: false,
        format: 'json',
        options: { temperature: settings.temperature ?? 0.1 },
      }),
    });
  } catch (networkErr: any) {
    // fetch() throws on connection-level failures (ECONNREFUSED, DNS, ...) before
    // any HTTP response exists — caught separately from the !res.ok case below so
    // the error stays specific instead of surfacing Node's generic "fetch failed".
    throw new Error(`Impossible de contacter Ollama sur ${baseUrl} : ${networkErr.message}. Vérifiez que "ollama serve" tourne et que l'URL est correcte.`);
  }

  if (!res.ok) {
    throw new Error(`Ollama ne répond pas (${res.status}) sur ${baseUrl}. Vérifiez que le modèle "${settings.modelName}" est installé.`);
  }

  const data = await res.json() as any;
  const rawText = data.message?.content || data.response || '';
  const parsedJson = extractJsonFromText(rawText);
  if (!parsedJson) {
    throw new Error(`Ollama (${settings.modelName}) a répondu sans JSON valide décodable.`);
  }

  return { providerUsed: 'ollama', modelUsed: settings.modelName, rawQuotes: normalizeToRawQuotes(parsedJson) };
}

async function callOpenAiCompatible(query: string, settings: LlmSettings): Promise<AnalyzeOutcome> {
  const baseUrl = (settings.baseUrl || 'http://localhost:1234/v1').replace(/\/$/, '');
  const userPrompt = `Analyse cette demande client de produit(s) structuré(s) et extrais les spécifications au format JSON :\n"${query}"`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.modelName || 'local-model',
        messages: [
          { role: 'system', content: FINANCIAL_PARSER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: settings.temperature ?? 0.1,
        response_format: { type: 'json_object' },
      }),
    });
  } catch (networkErr: any) {
    throw new Error(`Impossible de contacter l'endpoint OpenAI-compatible sur ${baseUrl} : ${networkErr.message}. Vérifiez que le serveur (LM Studio, vLLM, ...) tourne et que l'URL est correcte.`);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Endpoint OpenAI-compatible ne répond pas (${res.status}) sur ${baseUrl}.${errBody ? ` ${errBody.slice(0, 300)}` : ''}`);
  }

  const data = await res.json() as any;
  const rawText = data.choices?.[0]?.message?.content || '';
  const parsedJson = extractJsonFromText(rawText);
  if (!parsedJson) {
    throw new Error(`Le modèle (${settings.modelName}) a répondu sans JSON valide décodable.`);
  }

  return {
    providerUsed: settings.provider,
    modelUsed: settings.modelName,
    rawQuotes: normalizeToRawQuotes(parsedJson),
  };
}

/**
 * Runs the configured LLM against a client query, concatenating it with
 * QuotationPrompt.md as the system prompt. Deliberately does NOT catch or
 * fall back on failure — any error (missing API key, unreachable endpoint,
 * malformed response, ...) propagates to the caller (routes/analyze.ts),
 * which turns it into a clear `{ success: false, error }` response. There is
 * no silent degraded mode: an extraction failure must be visible, not masked
 * behind a best-effort deterministic guess.
 */
export async function analyzeQuery(query: string, settings: LlmSettings): Promise<AnalyzeOutcome> {
  debugLog('ANALYZE QUERY', { query, settings: { ...settings, apiKey: settings.apiKey ? '<redacted>' : null } });

  if (settings.provider === 'gemini') return callGemini(query, settings);
  if (settings.provider === 'ollama') return callOllama(query, settings);
  if (settings.provider === 'lmstudio' || settings.provider === 'openai_compatible') return callOpenAiCompatible(query, settings);
  throw new Error(`Provider LLM inconnu ou non configuré : "${settings.provider}". Configurez un moteur LLM depuis la page d'admin.`);
}
