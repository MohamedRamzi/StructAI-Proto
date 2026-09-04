import { UnderlyingAsset } from '../types/structured-product';
import { getStoredUnderlyings } from './underlyings-storage';
import { buildTfIdfIndex, cosineSimilarity, tokenize, topSharedTerms, vectorizeQuery } from './text-similarity';

export interface VectorSearchResult {
  underlying: UnderlyingAsset;
  score: number; // 0 to 1 cosine similarity
  matchedConcepts: string[];
  qualitativeSummary: string;
}

// Curated qualitative descriptions used to enrich the search corpus for well-known
// underlyings. Assets without an entry here still get a document built purely from
// their market data (see buildUnderlyingDocument), so the search degrades gracefully.
interface QualitativeMetadata {
  tags: string[];
  qualitativeText: string;
}

const STOCK_QUALITATIVE_METADATA: Record<string, QualitativeMetadata> = {
  'MC FP': {
    tags: ['luxe', 'luxury', 'europe', 'cac40', 'croissance', 'marque mondiale', 'haute valeur', 'volatil', 'rendement autocall', 'france', 'consommation premium'],
    qualitativeText: 'Leader mondial du luxe. Portefeuille de marques iconiques. Volatilité idéale pour structuration Autocall avec coupons élevés.',
  },
  'KER FP': {
    tags: ['luxe', 'luxury', 'gucci', 'haute volatilité', 'rebound', 'coupon max', 'europe', 'cac40', 'mode', 'opportunité'],
    qualitativeText: 'Acteur majeur du luxe européen présentant une forte volatilité implicite. Génère les coupons les plus agressifs du marché.',
  },
  'RMS FP': {
    tags: ['luxe', 'luxury', 'ultra premium', 'défensif', 'résilient', 'faible volatilité', 'qualité supérieure', 'rare', 'stabilité'],
    qualitativeText: 'Luxe ultra-exclusif avec très faible sensibilité aux cycles économiques. Profil très sécurisant pour barrières PDI éloignées.',
  },
  'MONC IM': {
    tags: ['luxe', 'italie', 'mode', 'doudoune', 'croissance', 'volatilité moyenne', 'ftse mib'],
    qualitativeText: 'Marque italienne à forte dynamique de marge et croissance internationale.',
  },
  'FP FP': {
    tags: ['énergie', 'energy', 'pétrole', 'gaz', 'transition écologique', 'fort dividende', 'rendement', 'défensif', 'inflation', 'cac40'],
    qualitativeText: 'Major pétrolière européenne versée dans le gaz et le renouvelable. Offre un dividende très élevé (5.2%) protecteur en Phoenix.',
  },
  'OR FP': {
    tags: ['cosmétique', 'beauté', 'défensif', 'stabilité', 'faible volatilité', 'croissance régulière', 'fondamental solide', 'cac40'],
    qualitativeText: 'Leader mondial de la beauté. Volatilité contenue et croissance historique remarquable. Parfait pour de la protection de capital.',
  },
  'SAN FP': {
    tags: ['santé', 'pharmacie', 'pharma', 'défensif', 'dividende stable', 'faible bêta', 'résilient', 'médicament'],
    qualitativeText: 'Géant pharmaceutique européen. Dividende historique croissant et faible volatilité idéale pour des structures conservatrices.',
  },
  'ASML NA': {
    tags: ['tech', 'technologie', 'semi-conducteurs', 'ia', 'monopole', 'lithographie', 'croissance', 'volatilité forte', 'pays-bas'],
    qualitativeText: 'Monopole technologique mondial sur les machines de lithographie EUV. Brique fondamentale de la révolution IA.',
  },
  'SX5E Index': {
    tags: ['indice', 'broad market', 'euro stoxx 50', 'diversification', 'faible volatilité', 'institutionnel', 'benchmark'],
    qualitativeText: 'Indice de référence des 50 plus grandes capitalisations de la zone euro. Risque idiosyncrasique nul.',
  },
  'TSLA US': {
    tags: ['tech', 'usa', 'nasdaq', 'ev', 'vehicule electrique', 'ia', 'volatilité extrême', 'coupon géant', 'high beta'],
    qualitativeText: 'Action américaine à très haute volatilité (48%). Permet de solver des coupons dépassant 15% p.a.',
  },
};

function qualitativeSummaryFor(underlying: UnderlyingAsset): string {
  return STOCK_QUALITATIVE_METADATA[underlying.ticker]?.qualitativeText || underlying.reasoningForRecommendation || '';
}

/**
 * Builds the free-text "document" representing an underlying in the vector space.
 * Market data (dividend yield, implied vol) is translated into descriptive tokens so
 * quantitative characteristics participate in the same similarity space as qualitative
 * tags — this lets a query like "fort dividende et faible volatilité" match assets that
 * have no hand-written metadata entry at all.
 */
function buildUnderlyingDocument(underlying: UnderlyingAsset): string {
  const meta = STOCK_QUALITATIVE_METADATA[underlying.ticker];

  const parts: string[] = [
    underlying.ticker,
    underlying.name,
    underlying.sector,
    underlying.region,
    underlying.reasoningForRecommendation || '',
  ];

  if (meta) {
    parts.push(meta.qualitativeText, meta.tags.join(' '));
  }

  if (underlying.dividendYield >= 0.035) {
    parts.push('fort dividende rendement eleve high dividend yield generous');
  } else if (underlying.dividendYield <= 0.015) {
    parts.push('faible dividende low dividend yield');
  }

  if (underlying.impliedVol3m >= 0.28) {
    parts.push('haute volatilite volatil agressif coupon eleve autocall attractif high volatility aggressive');
  } else if (underlying.impliedVol3m <= 0.23) {
    parts.push('faible volatilite defensif stable securise protection capital low volatility defensive');
  }

  if (underlying.volatilityScore === 'EXCELLENT_FOR_AUTOCALL') {
    parts.push('excellent autocall coupon maximise price bien');
  }

  return parts.join(' ');
}

/**
 * Semantic search over the underlyings database using a TF-IDF vector space model:
 * each underlying (market data + qualitative metadata) is embedded as a bag-of-words
 * vector, the query is embedded the same way, and results are ranked by cosine
 * similarity. This replaces ad-hoc per-ticker keyword scoring with a real, generic
 * similarity computation (see src/services/text-similarity.ts).
 */
export function searchUnderlyingsByVector(query: string, limit = 5): VectorSearchResult[] {
  const storedDb = getStoredUnderlyings();

  if (!query || !query.trim()) {
    return storedDb.slice(0, limit).map((underlying) => ({
      underlying,
      score: 0.8,
      matchedConcepts: ['Recherche par défaut'],
      qualitativeSummary: qualitativeSummaryFor(underlying),
    }));
  }

  const documents = storedDb.map((underlying) => tokenize(buildUnderlyingDocument(underlying)));
  const index = buildTfIdfIndex(documents);

  const queryVector = vectorizeQuery(tokenize(query), index.idf);
  const queryNorm = Math.sqrt(Array.from(queryVector.values()).reduce((sum, w) => sum + w * w, 0));

  const results: VectorSearchResult[] = storedDb.map((underlying, i) => {
    const docVector = index.vectors[i];
    const score = cosineSimilarity(queryVector, docVector, queryNorm, index.norms[i]);
    const sharedTerms = topSharedTerms(queryVector, docVector, 4);

    return {
      underlying,
      score: Number(score.toFixed(2)),
      matchedConcepts: sharedTerms.length > 0 ? sharedTerms : ['Aucune correspondance sémantique directe'],
      qualitativeSummary: qualitativeSummaryFor(underlying),
    };
  });

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}
