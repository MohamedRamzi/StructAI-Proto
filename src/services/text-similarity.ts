/**
 * Generic TF-IDF vector space model + cosine similarity.
 * Used to power the semantic underlying search (see vector-db.ts) with a real
 * similarity computation instead of ad-hoc keyword/tag matching.
 */

const STOPWORDS = new Set([
  'les', 'des', 'une', 'un', 'le', 'la', 'du', 'de', 'et', 'ou', 'en', 'au', 'aux',
  'pour', 'avec', 'dans', 'sur', 'par', 'est', 'qui', 'que', 'qu', 'ces', 'ses',
  'son', 'sa', 'ce', 'cet', 'cette', 'plus', 'très', 'tres', 'bien',
  'the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'were', 'from', 'you',
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

function vectorNorm(vector: Map<string, number>): number {
  let sumSquares = 0;
  for (const weight of vector.values()) sumSquares += weight * weight;
  return Math.sqrt(sumSquares);
}

export interface TfIdfIndex {
  idf: Map<string, number>;
  vectors: Map<string, number>[]; // one TF-IDF weighted vector per input document
  norms: number[]; // pre-computed L2 norm per document vector
}

/**
 * Builds a TF-IDF index over a corpus of already-tokenized documents.
 * Uses smoothed IDF (log((1 + N) / (1 + df)) + 1) so every term keeps a strictly
 * positive weight, including terms that appear in every document.
 */
export function buildTfIdfIndex(documents: string[][]): TfIdfIndex {
  const documentFrequency = new Map<string, number>();
  const documentTermFrequencies = documents.map(termFrequencies);

  for (const tf of documentTermFrequencies) {
    for (const term of tf.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }

  const totalDocuments = documents.length;
  const idf = new Map<string, number>();
  for (const [term, df] of documentFrequency.entries()) {
    idf.set(term, Math.log((1 + totalDocuments) / (1 + df)) + 1);
  }

  const vectors = documentTermFrequencies.map((tf) => {
    const vector = new Map<string, number>();
    for (const [term, count] of tf.entries()) {
      vector.set(term, count * (idf.get(term) || 0));
    }
    return vector;
  });

  const norms = vectors.map(vectorNorm);

  return { idf, vectors, norms };
}

/**
 * Projects a raw token list into the vector space defined by a previously built
 * TF-IDF index. Terms unseen in the corpus are ignored (zero weight).
 */
export function vectorizeQuery(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = termFrequencies(tokens);
  const vector = new Map<string, number>();
  for (const [term, count] of tf.entries()) {
    const weight = idf.get(term);
    if (weight) vector.set(term, count * weight);
  }
  return vector;
}

/**
 * Cosine similarity between two sparse TF-IDF vectors, bounded in [0, 1] since
 * TF-IDF weights are always non-negative. Pass pre-computed norms to avoid
 * recomputation when scoring a query against many documents.
 */
export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
  normA?: number,
  normB?: number
): number {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let dotProduct = 0;
  for (const [term, weight] of smaller.entries()) {
    const otherWeight = larger.get(term);
    if (otherWeight) dotProduct += weight * otherWeight;
  }

  const resolvedNormA = normA ?? vectorNorm(a);
  const resolvedNormB = normB ?? vectorNorm(b);
  if (resolvedNormA === 0 || resolvedNormB === 0) return 0;

  return dotProduct / (resolvedNormA * resolvedNormB);
}

/**
 * Returns the terms two vectors have in common, ranked by their combined
 * TF-IDF contribution to the cosine similarity (highest first). Useful to
 * explain a search match to the end user.
 */
export function topSharedTerms(
  a: Map<string, number>,
  b: Map<string, number>,
  limit = 4
): string[] {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  const contributions: { term: string; weight: number }[] = [];

  for (const [term, weight] of smaller.entries()) {
    const otherWeight = larger.get(term);
    if (otherWeight) {
      contributions.push({ term, weight: weight * otherWeight });
    }
  }

  contributions.sort((x, y) => y.weight - x.weight);
  return contributions.slice(0, limit).map((c) => c.term);
}
