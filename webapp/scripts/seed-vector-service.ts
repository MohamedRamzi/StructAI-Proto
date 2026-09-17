#!/usr/bin/env tsx
/**
 * One-time seeding script: pushes a starter set of ~215 instruments
 * (`scripts/seed-data/instruments.json` — main indices Europe/US/Asia + their
 * constituents, rates, FX, credit) into inference-service's instrument corpus —
 * now the SINGLE source of underlyings — via POST /api/instruments/import/json
 * (the same route the admin UI's "Importer JSON" button uses). Also doubles as
 * an end-to-end smoke test of the pipeline (embedding call -> Chroma index).
 *
 * Market data in each instrument's `metadata` (spotPrice, impliedVol3m, ...) is
 * INDICATIVE, calibrated to ~September 2026 — a stand-in until a dedicated
 * market-data service exists. `scripts/seed-data/instruments.csv` is the same
 * data for the admin UI's "Importer un CSV" button.
 *
 * The corpus is managed from inference-service's admin UI (onglet Instruments)
 * thereafter; this script is just a convenience for a fresh install.
 *
 * Authenticates as an admin (JWT login), NOT the INFERENCE_SERVICE_API_KEY.
 *
 * Usage: npx tsx scripts/seed-vector-service.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const INFERENCE_SERVICE_URL = (process.env.INFERENCE_SERVICE_URL || 'http://localhost:4001').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.INFERENCE_SERVICE_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.INFERENCE_SERVICE_ADMIN_PASSWORD || '';

const SEED_FILE = join(dirname(fileURLToPath(import.meta.url)), 'seed-data', 'instruments.json');
const SEED_INSTRUMENTS: any[] = JSON.parse(readFileSync(SEED_FILE, 'utf-8'));

async function main() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      '[Seed] INFERENCE_SERVICE_ADMIN_EMAIL / INFERENCE_SERVICE_ADMIN_PASSWORD manquantes dans .env — ' +
      "renseignez les identifiants d'un compte admin inference-service (voir ../inference-service/.env pour ADMIN_EMAIL/ADMIN_PASSWORD)."
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

  const payload = SEED_INSTRUMENTS;
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
