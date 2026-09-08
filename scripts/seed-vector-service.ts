#!/usr/bin/env tsx
/**
 * One-time seeding script: pushes the main app's 10 seed equities
 * (src/data/underlyings-db.ts) into inference-service's instrument corpus via
 * POST /api/instruments/import/json — the same JSON import route the admin
 * UI's "Importer JSON" button uses. Also doubles as an end-to-end smoke test
 * of the whole pipeline (embedding call -> Chroma index -> ready to search).
 *
 * Authenticates as an admin (JWT login), NOT the INFERENCE_SERVICE_API_KEY: that
 * key is scoped to read-only search/analyze (least privilege for the always-on
 * main app process, see inference-service/README.md) and is rejected by write
 * routes on purpose.
 *
 * Usage: npx tsx scripts/seed-vector-service.ts
 */
import 'dotenv/config';
import { STOCK_DATABASE } from '../src/data/underlyings-db';
import { UnderlyingAsset } from '../src/types/structured-product';

const INFERENCE_SERVICE_URL = (process.env.INFERENCE_SERVICE_URL || 'http://localhost:4001').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.INFERENCE_SERVICE_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.INFERENCE_SERVICE_ADMIN_PASSWORD || '';

function toInstrument(stock: UnderlyingAsset) {
  return {
    assetClass: 'EQUITY',
    code: stock.ticker,
    name: stock.name,
    description: stock.reasoningForRecommendation || '',
    tags: [],
    metadata: {
      isin: stock.isin || '',
      sector: stock.sector,
      region: stock.region,
      spotPrice: stock.spotPrice,
      currency: stock.currency,
      impliedVol3m: stock.impliedVol3m,
      dividendYield: stock.dividendYield,
      repoRate: stock.repoRate,
      volatilityScore: stock.volatilityScore,
      reasoningForRecommendation: stock.reasoningForRecommendation || '',
    },
  };
}

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      '[Seed] INFERENCE_SERVICE_ADMIN_EMAIL / INFERENCE_SERVICE_ADMIN_PASSWORD manquantes dans .env — ' +
      "renseignez les identifiants d'un compte admin inference-service (voir inference-service/.env pour ADMIN_EMAIL/ADMIN_PASSWORD)."
    );
    process.exit(1);
  }

  console.log(`[Seed] Connexion à ${INFERENCE_SERVICE_URL} en tant que ${ADMIN_EMAIL} ...`);
  const loginRes = await fetch(`${INFERENCE_SERVICE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const loginData: any = await loginRes.json();
  if (!loginRes.ok || !loginData.success) {
    console.error(`[Seed] Échec de connexion : ${loginData.error || `HTTP ${loginRes.status}`}`);
    process.exit(1);
  }

  const payload = STOCK_DATABASE.map(toInstrument);
  console.log(`[Seed] Envoi de ${payload.length} instruments vers ${INFERENCE_SERVICE_URL}/api/instruments/import/json ...`);

  const res = await fetch(`${INFERENCE_SERVICE_URL}/api/instruments/import/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.token}` },
    body: JSON.stringify(payload),
  });
  const data: any = await res.json();

  if (!res.ok || !data.success) {
    console.error(`[Seed] Échec : ${data.error || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  console.log(`[Seed] ✅ ${data.imported} instrument(s) importé(s) et embeddés dans inference-service.`);
}

main().catch((err) => {
  console.error('[Seed] Erreur inattendue :', err);
  process.exit(1);
});
