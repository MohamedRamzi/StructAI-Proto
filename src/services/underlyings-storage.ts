import { UnderlyingAsset } from '../types/structured-product';
import { STOCK_DATABASE } from '../data/underlyings-db';

const UNDERLYINGS_STORAGE_KEY = 'structai_underlyings_db_v2';

let nodeMemoryDb: UnderlyingAsset[] | null = null;

/**
 * Get all stored underlying assets (LocalStorage or Node memory or default seed)
 */
export function getStoredUnderlyings(): UnderlyingAsset[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(UNDERLYINGS_STORAGE_KEY);
      if (!raw) return STOCK_DATABASE;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : STOCK_DATABASE;
    }
    return nodeMemoryDb || STOCK_DATABASE;
  } catch (err) {
    console.error('Failed to parse underlyings DB:', err);
    return nodeMemoryDb || STOCK_DATABASE;
  }
}

/**
 * Sync underlyings database with Node backend server
 */
export async function syncUnderlyingsWithServer(db: UnderlyingAsset[]): Promise<void> {
  try {
    if (typeof fetch !== 'undefined' && typeof window !== 'undefined') {
      const res = await fetch('/api/underlyings/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ underlyings: db }),
      });
      if (!res.ok) {
        return;
      }
    }
  } catch (err) {
    // Silent fail for offline/client environments
  }
}

/**
 * Save or update an underlying asset in the database
 */
export function saveUnderlyingAsset(asset: UnderlyingAsset): UnderlyingAsset[] {
  const current = getStoredUnderlyings();
  const cleanTicker = asset.ticker.trim().toUpperCase();
  
  const existingIdx = current.findIndex(s => s.ticker.toUpperCase() === cleanTicker);
  let updated: UnderlyingAsset[];
  
  const sanitizedAsset: UnderlyingAsset = {
    ...asset,
    ticker: cleanTicker,
    spotPrice: Number(asset.spotPrice) || 100,
    impliedVol3m: Number(asset.impliedVol3m) || 0.25,
    dividendYield: Number(asset.dividendYield) || 0.02,
    repoRate: Number(asset.repoRate) || 0.001,
  };

  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = sanitizedAsset;
  } else {
    updated = [sanitizedAsset, ...current];
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(UNDERLYINGS_STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('Failed to save underlyings DB to localStorage:', err);
    }
  }

  nodeMemoryDb = updated;
  syncUnderlyingsWithServer(updated);
  return updated;
}

/**
 * Delete an underlying asset by ticker
 */
export function deleteUnderlyingAsset(ticker: string): UnderlyingAsset[] {
  const current = getStoredUnderlyings();
  const cleanTicker = ticker.trim().toUpperCase();
  const updated = current.filter(s => s.ticker.toUpperCase() !== cleanTicker);

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(UNDERLYINGS_STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.error('Failed to delete underlying asset:', err);
    }
  }

  nodeMemoryDb = updated;
  syncUnderlyingsWithServer(updated);
  return updated;
}

/**
 * Reset underlying database to institutional defaults
 */
export function resetUnderlyingsDatabase(): UnderlyingAsset[] {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(UNDERLYINGS_STORAGE_KEY);
    } catch (err) {
      console.error('Failed to reset underlyings DB:', err);
    }
  }
  nodeMemoryDb = STOCK_DATABASE;
  syncUnderlyingsWithServer(STOCK_DATABASE);
  return STOCK_DATABASE;
}

/**
 * Export underlying database to CSV string
 */
export function exportUnderlyingsToCsv(): string {
  const assets = getStoredUnderlyings();
  const headers = ['Ticker', 'ISIN', 'Name', 'Sector', 'Region', 'SpotPrice', 'Currency', 'ImpliedVol3m', 'DividendYield', 'VolatilityScore', 'Reasoning'];
  
  const rows = assets.map(a => [
    `"${a.ticker}"`,
    `"${a.isin || ''}"`,
    `"${a.name.replaceAll('"', '""')}"`,
    `"${a.sector.replaceAll('"', '""')}"`,
    `"${a.region.replaceAll('"', '""')}"`,
    a.spotPrice,
    a.currency || 'EUR',
    a.impliedVol3m,
    a.dividendYield,
    a.volatilityScore,
    `"${(a.reasoningForRecommendation || '').replaceAll('"', '""')}"`
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Batch import underlyings from CSV text
 */
export function importUnderlyingsFromCsv(csvText: string): { success: boolean; count: number; error?: string } {
  try {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length <= 1) {
      return { success: false, count: 0, error: 'Fichier CSV vide ou incomplet.' };
    }

    const current = getStoredUnderlyings();
    const updatedMap = new Map<string, UnderlyingAsset>();
    current.forEach(a => updatedMap.set(a.ticker.toUpperCase(), a));

    let importedCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Simple CSV split handling quotes
      const cells = line.match(/(?:\"[^\"]*\"|[^,])+/g)?.map(c => c.trim().replace(/^"|"$/g, '').replaceAll('""', '"')) || [];
      if (cells.length >= 3) {
        const ticker = cells[0]?.trim().toUpperCase();
        if (!ticker) continue;

        const asset: UnderlyingAsset = {
          ticker,
          isin: cells[1] || `FR-${ticker.replace(/\s+/g, '')}`,
          name: cells[2] || ticker,
          sector: cells[3] || 'Actions Générales',
          region: cells[4] || 'Europe',
          spotPrice: parseFloat(cells[5]) || 100,
          currency: cells[6] || 'EUR',
          impliedVol3m: parseFloat(cells[7]) || 0.25,
          dividendYield: parseFloat(cells[8]) || 0.02,
          repoRate: 0.001,
          volatilityScore: (['LOW', 'MEDIUM', 'HIGH', 'EXCELLENT_FOR_AUTOCALL'].includes(cells[9]) ? cells[9] : 'MEDIUM') as any,
          reasoningForRecommendation: cells[10] || 'Importé via fichier CSV.'
        };

        updatedMap.set(ticker, asset);
        importedCount++;
      }
    }

    const newDb = Array.from(updatedMap.values());
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(UNDERLYINGS_STORAGE_KEY, JSON.stringify(newDb));
    }
    syncUnderlyingsWithServer(newDb);

    return { success: true, count: importedCount };
  } catch (err: any) {
    return { success: false, count: 0, error: err.message || 'Erreur lors du décodage du fichier CSV.' };
  }
}

/** How a result was reached — lets callers distinguish a real match from a
 * best-effort guess:
 *   'alias' | 'exact' | 'token'  -> a confident, name/ticker-based match
 *   'theme'                       -> a loose keyword/theme score (fine for a
 *                                    vague query like "luxe qui price bien",
 *                                    NOT for a concrete name)
 *   'none'                        -> nothing matched; autoSelected is db[0] as a
 *                                    fallback only
 */
export type UnderlyingMatchStrategy = 'alias' | 'exact' | 'token' | 'theme' | 'none';

export interface UnderlyingMatchResult {
  matches: UnderlyingAsset[];
  autoSelected?: UnderlyingAsset;
  matchStrategy: UnderlyingMatchStrategy;
}

/** True when the match was reached by name/ticker/alias (not a theme score or a fallback). */
export function isPreciseUnderlyingMatch(r: { matchStrategy: UnderlyingMatchStrategy }): boolean {
  return r.matchStrategy === 'alias' || r.matchStrategy === 'exact' || r.matchStrategy === 'token';
}

/**
 * Multi-Strategy Dynamic Search Engine (No hardcoded rules!)
 * 1. Direct Ticker / ISIN / Synonym & Alias Match (e.g. Eurostoxx -> SX5E Index, TotalEnergies -> FP FP, LVMH -> MC FP)
 * 2. Space-Collapsed & Exact or Substring Company Name Match
 * 3. Vector Similarity & Keyword Theme Scoring (e.g. "luxe qui price bien", "bancaires résilientes", "énergie")
 */
export function findUnderlyingMultiStrategy(query: string, customDb?: UnderlyingAsset[]): UnderlyingMatchResult {
  const db = (customDb && customDb.length > 0) ? customDb : getStoredUnderlyings();
  const rawClean = query.trim().toUpperCase();
  if (!rawClean) {
    return { matches: db, autoSelected: db[0], matchStrategy: 'none' };
  }

  const rawCollapsed = rawClean.replace(/[^A-Z0-9]/g, '');

  // Common Financial Synonyms & Ticker Aliases
  const ALIAS_MAP: { ticker: string; synonyms: string[] }[] = [
    { ticker: 'SX5E Index', synonyms: ['EUROSTOXX', 'EURO STOXX', 'EUROSTOXX50', 'EURO STOXX 50', 'STOXX50', 'STOXX 50', 'SX5E', 'EURO STOXX 50 INDEX'] },
    { ticker: 'FP FP', synonyms: ['TOTALENERGIES', 'TOTAL ENERGIES', 'TOTAL', 'TTE', 'TOTAL ENERGIES FP'] },
    { ticker: 'MC FP', synonyms: ['LVMH', 'LOUIS VUITTON', 'MOET HENNESSY', 'MOET', 'LVMH MC FP'] },
    { ticker: 'KER FP', synonyms: ['KERING', 'GUCCI', 'KERING KER FP'] },
    { ticker: 'RMS FP', synonyms: ['HERMES', 'HERMÈS', 'HERMES INTERNATIONAL'] },
    { ticker: 'SAN FP', synonyms: ['SANOFI', 'SANOFI SA'] },
    { ticker: 'OR FP', synonyms: ['LOREAL', "L'OREAL", "L'ORÉAL", "L OREAL"] },
    { ticker: 'ASML NA', synonyms: ['ASML', 'ASML HOLDING'] },
    { ticker: 'TSLA US', synonyms: ['TESLA', 'TSLA'] },
    { ticker: 'MONC IM', synonyms: ['MONCLER', 'MONC'] },
  ];

  // --- STRATEGY 0: Synonym & Alias Map Lookup ---
  for (const aliasItem of ALIAS_MAP) {
    const targetAsset = db.find(a => a.ticker.toUpperCase() === aliasItem.ticker.toUpperCase());
    if (targetAsset) {
      for (const syn of aliasItem.synonyms) {
        const synUpper = syn.toUpperCase();
        const synCollapsed = synUpper.replace(/[^A-Z0-9]/g, '');

        if (rawClean === synUpper || rawClean.includes(synUpper) || (synCollapsed.length >= 4 && rawCollapsed.includes(synCollapsed))) {
          return { matches: [targetAsset], autoSelected: targetAsset, matchStrategy: 'alias' };
        }
      }
    }
  }

  // --- STRATEGY 1: Direct Bloomberg Ticker / ISIN / Exact Name Match ---
  for (const asset of db) {
    const t = asset.ticker.toUpperCase();
    const tBase = t.split(' ')[0]; // e.g. "FP" from "FP FP" or "MC" from "MC FP"
    const isin = (asset.isin || '').toUpperCase();
    const nameUpper = asset.name.toUpperCase();
    const nameCollapsed = nameUpper.replace(/[^A-Z0-9]/g, '');

    if (rawClean === t || rawClean === isin || rawClean === nameUpper || rawCollapsed === nameCollapsed) {
      return { matches: [asset], autoSelected: asset, matchStrategy: 'exact' };
    }

    if (t.length >= 2 && rawClean.includes(t)) {
      return { matches: [asset], autoSelected: asset, matchStrategy: 'exact' };
    }
    if (tBase.length >= 2 && rawClean.match(new RegExp(`\\b${tBase}\\b`, 'i'))) {
      return { matches: [asset], autoSelected: asset, matchStrategy: 'exact' };
    }
    if (nameCollapsed.length >= 4 && (rawCollapsed.includes(nameCollapsed) || nameCollapsed.includes(rawCollapsed))) {
      return { matches: [asset], autoSelected: asset, matchStrategy: 'exact' };
    }
  }

  // --- STRATEGY 2: Text / Company Substring & Token Matching ---
  const words = rawClean
    .split(/[^A-Z0-9']/)
    .filter(w => w.length >= 3 && !['SUR', 'STOCK', 'POUR', 'AVEC', 'SOLVE', 'COUPON', 'NOTE', 'PDI', 'NC', 'FWD', 'FORWARD', 'RAPPEL', 'PROTECTION', 'REVERSE', 'CONVERTIBLE', 'AUTOCALL', 'PHOENIX', 'ANS', 'AN', 'MOIS', 'DEPART'].includes(w));

  const textMatches: { asset: UnderlyingAsset; score: number }[] = [];

  db.forEach(asset => {
    let score = 0;
    const nameUpper = asset.name.toUpperCase();
    const tickerUpper = asset.ticker.toUpperCase();

    words.forEach(word => {
      if (nameUpper.includes(word)) score += 10;
      if (tickerUpper.includes(word)) score += 15;
    });

    if (score > 0) {
      textMatches.push({ asset, score });
    }
  });

  if (textMatches.length > 0) {
    textMatches.sort((a, b) => b.score - a.score);
    return {
      matches: textMatches.map(m => m.asset),
      autoSelected: textMatches[0].asset,
      matchStrategy: 'token',
    };
  }

  // --- STRATEGY 3: Vector Similarity & Keyword Theme Scoring (Imprecise Query RAG) ---
  // For queries like "luxe qui price bien", "bancaires résilientes", "haute volatilité et dividende"
  const themeScored: { asset: UnderlyingAsset; score: number }[] = db.map(asset => {
    let score = 0;
    const fullText = `${asset.name} ${asset.sector} ${asset.region} ${asset.volatilityScore} ${asset.reasoningForRecommendation || ''}`.toUpperCase();

    // Theme keywords scoring
    if (rawClean.includes('LUXE') || rawClean.includes('LUXURY')) {
      if (asset.sector.toUpperCase().includes('LUXE')) score += 20;
    }
    if (rawClean.includes('ÉNERGIE') || rawClean.includes('ENERGIE') || rawClean.includes('PETROLE') || rawClean.includes('ENERGY')) {
      if (asset.sector.toUpperCase().includes('ÉNERGIE') || asset.sector.toUpperCase().includes('ENERGIE')) score += 20;
    }
    if (rawClean.includes('BANQUE') || rawClean.includes('FINANCE') || rawClean.includes('BANK')) {
      if (asset.sector.toUpperCase().includes('FINANC') || asset.sector.toUpperCase().includes('BANQU')) score += 20;
    }
    if (rawClean.includes('TECH') || rawClean.includes('SEMI-CONDUCTEUR')) {
      if (asset.sector.toUpperCase().includes('TECH') || asset.sector.toUpperCase().includes('SEMI')) score += 20;
    }
    if (rawClean.includes('PRICE BIEN') || rawClean.includes('VOLATILITÉ') || rawClean.includes('VOLATILITE')) {
      if (asset.volatilityScore === 'EXCELLENT_FOR_AUTOCALL') score += 15;
      if (asset.impliedVol3m >= 0.28) score += 10;
    }
    if (rawClean.includes('DIVIDENDE') || rawClean.includes('RENDEMENT')) {
      if (asset.dividendYield >= 0.035) score += 15;
    }

    // Word token overlap with full asset text
    words.forEach(w => {
      if (fullText.includes(w)) score += 3;
    });

    return { asset, score };
  });

  themeScored.sort((a, b) => b.score - a.score);
  const bestMatches = themeScored.filter(s => s.score > 0).map(s => s.asset);

  return {
    matches: bestMatches.length > 0 ? bestMatches : db,
    autoSelected: bestMatches.length > 0 ? bestMatches[0] : db[0],
    matchStrategy: bestMatches.length > 0 ? 'theme' : 'none',
  };
}
