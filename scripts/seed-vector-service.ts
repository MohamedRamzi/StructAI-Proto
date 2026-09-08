#!/usr/bin/env tsx
/**
 * One-time seeding script: pushes the main app's 10 seed equities
 * (src/data/underlyings-db.ts) into vector-service's instrument corpus via
 * POST /api/instruments/import/json — the same JSON import route the admin
 * UI's "Importer JSON" button uses. Also doubles as an end-to-end smoke test
 * of the whole pipeline (embedding call -> Chroma index -> ready to search).
 *
 * Authenticates as an admin (JWT login), NOT the VECTOR_SERVICE_API_KEY: that
 * key is scoped to read-only search (least privilege for the always-on main
 * app process, see vector-service/README.md) and is rejected by write routes
 * on purpose.
 *
 * Usage: npx tsx scripts/seed-vector-service.ts
 */
import 'dotenv/config';
import { STOCK_DATABASE } from '../src/data/underlyings-db';
import { UnderlyingAsset } from '../src/types/structured-product';

const VECTOR_SERVICE_URL = (process.env.VECTOR_SERVICE_URL || 'http://localhost:4002').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.VECTOR_SERVICE_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.VECTOR_SERVICE_ADMIN_PASSWORD || '';

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
      '[Seed] VECTOR_SERVICE_ADMIN_EMAIL / VECTOR_SERVICE_ADMIN_PASSWORD manquantes dans .env — ' +
      "renseignez les identifiants d'un compte admin vector-service (voir vector-service/.env pour ADMIN_EMAIL/ADMIN_PASSWORD)."
    );
    process.exit(1);
  }

  console.log(`[Seed] Connexion à ${VECTOR_SERVICE_URL} en tant que ${ADMIN_EMAIL} ...`);
  const loginRes = await fetch(`${VECTOR_SERVICE_URL}/api/auth/login`, {
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
  console.log(`[Seed] Envoi de ${payload.length} instruments vers ${VECTOR_SERVICE_URL}/api/instruments/import/json ...`);

  const res = await fetch(`${VECTOR_SERVICE_URL}/api/instruments/import/json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loginData.token}` },
    body: JSON.stringify(payload),
  });
  const data: any = await res.json();

  if (!res.ok || !data.success) {
    console.error(`[Seed] Échec : ${data.error || `HTTP ${res.status}`}`);
    process.exit(1);
  }

  console.log(`[Seed] ✅ ${data.imported} instrument(s) importé(s) et embeddés dans vector-service.`);
}

main().catch((err) => {
  console.error('[Seed] Erreur inattendue :', err);
  process.exit(1);
});
