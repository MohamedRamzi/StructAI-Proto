import { describe, expect, it } from 'vitest';
import { buildTfIdfIndex, cosineSimilarity, tokenize, topSharedTerms, vectorizeQuery } from './text-similarity';

describe('tokenize', () => {
  it('lowercases, strips accents and splits on non-alphanumeric characters', () => {
    expect(tokenize('Volatilité Élevée, luxe!')).toEqual(['volatilite', 'elevee', 'luxe']);
  });

  it('drops tokens of length <= 2 and known stopwords', () => {
    expect(tokenize('un des et le luxe')).toEqual(['luxe']);
  });

  it('returns an empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('buildTfIdfIndex + cosineSimilarity', () => {
  const documents = [
    tokenize('luxe volatilite haute autocall coupon'), // doc 0: luxury/high vol
    tokenize('energie petrole dividende fort defensif'), // doc 1: energy/defensive
    tokenize('technologie semi conducteurs croissance ia'), // doc 2: tech
  ];
  const index = buildTfIdfIndex(documents);

  it('gives a perfect cosine match for a document against itself', () => {
    const score = cosineSimilarity(index.vectors[0], index.vectors[0], index.norms[0], index.norms[0]);
    expect(score).toBeCloseTo(1, 10);
  });

  it('ranks the most relevant document highest for a themed query', () => {
    const queryVector = vectorizeQuery(tokenize('luxe autocall haute volatilite'), index.idf);
    const queryNorm = Math.sqrt(Array.from(queryVector.values()).reduce((s, w) => s + w * w, 0));

    const scores = index.vectors.map((docVector, i) => cosineSimilarity(queryVector, docVector, queryNorm, index.norms[i]));

    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[0]).toBeGreaterThan(scores[2]);
  });

  it('returns 0 similarity when query and document share no terms', () => {
    const queryVector = vectorizeQuery(tokenize('zzz unknown gibberish'), index.idf);
    const score = cosineSimilarity(queryVector, index.vectors[0]);
    expect(score).toBe(0);
  });

  it('returns 0 similarity against an empty vector without throwing', () => {
    const empty = new Map<string, number>();
    expect(cosineSimilarity(empty, index.vectors[0])).toBe(0);
  });
});

describe('topSharedTerms', () => {
  it('ranks shared terms by their combined TF-IDF contribution', () => {
    const documents = [tokenize('luxe volatilite haute autocall coupon'), tokenize('energie petrole dividende')];
    const index = buildTfIdfIndex(documents);
    const queryVector = vectorizeQuery(tokenize('luxe haute volatilite'), index.idf);

    const shared = topSharedTerms(queryVector, index.vectors[0], 5);
    expect(shared).toContain('luxe');
    expect(shared).toContain('volatilite');
    expect(shared).toContain('haute');
    expect(shared).not.toContain('energie');
  });

  it('returns an empty array when nothing overlaps', () => {
    const documents = [tokenize('luxe volatilite'), tokenize('energie petrole')];
    const index = buildTfIdfIndex(documents);
    const queryVector = vectorizeQuery(tokenize('inconnu absent'), index.idf);
    expect(topSharedTerms(queryVector, index.vectors[0])).toEqual([]);
  });
});
