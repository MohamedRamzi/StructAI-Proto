/**
 * Thin client for inference-service's semantic instrument search
 * (POST /api/instruments/search — embeddings + ChromaDB over the single
 * instrument corpus). Shared by server.ts's /api/parse-query and the
 * parse-query CLI so they resolve underlyings identically.
 *
 * Returns the raw instrument JSON (or null). Mapping to an UnderlyingAsset +
 * market-data placeholders is done downstream (services/market-data.ts), in one
 * place. Never throws — a resolution miss is not the "no silent fallback" LLM
 * failure the project guards against; the caller keeps the extracted name and
 * flags the gap.
 */

export interface InstrumentSearchConfig {
  baseUrl: string;
  apiKey: string;
}

/** Looks like an explicit Bloomberg-style ticker ("MC FP", "TSLA US", "SX5E Index"). */
function looksLikeExplicitTicker(s: string): boolean {
  return /^[A-Z0-9]{1,6}\s+[A-Z]{2,6}(\s+INDEX)?$/i.test(s.trim());
}

const normalize = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');

/** The routed-analyze pipeline emits "RATES"; the instrument corpus schema uses
 * "RATE_INDEX". Map it so an asset-class filter on the search actually matches. */
function corpusAssetClass(assetClass: string | null | undefined): string | undefined {
  if (!assetClass) return undefined;
  const ac = assetClass.toUpperCase();
  if (ac === 'RATES' || ac === 'RATE') return 'RATE_INDEX';
  if (['EQUITY', 'RATE_INDEX', 'FX', 'CREDIT'].includes(ac)) return ac;
  return undefined;
}

export async function searchInstrument(
  queryText: string,
  assetClass: string | null | undefined,
  cfg: InstrumentSearchConfig,
  log: (msg: string) => void = () => {},
): Promise<any | null> {
  if (!queryText || !queryText.trim() || !cfg.apiKey) return null;

  try {
    const res = await fetch(`${cfg.baseUrl}/api/instruments/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        query: queryText,
        assetClass: corpusAssetClass(assetClass),
        limit: 1,
      }),
    });
    const data: any = await res.json();
    if (!res.ok || !data.success || !data.results?.length) {
      if (!data?.success) log(`[Instrument Search] aucun résultat pour "${queryText}" : ${data?.error || `HTTP ${res.status}`}`);
      return null;
    }

    const top = data.results[0];

    // A vector search always returns its best available match even when nothing
    // is truly relevant. When the query text is itself an explicit ticker,
    // require the hit's own code to match before trusting it.
    if (looksLikeExplicitTicker(queryText) && normalize(top.code || '') !== normalize(queryText)) {
      log(`[Instrument Search] "${queryText}" ressemble à un ticker mais le meilleur résultat ("${top.code}") ne correspond pas — ignoré.`);
      return null;
    }

    return top;
  } catch (err: any) {
    log(`[Instrument Search] inference-service indisponible pour "${queryText}" : ${err.message}`);
    return null;
  }
}
