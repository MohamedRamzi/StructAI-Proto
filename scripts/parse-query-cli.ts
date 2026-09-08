#!/usr/bin/env tsx
import 'dotenv/config';
import fs from 'fs';
import { priceStructuredProduct } from '../src/services/quant-pricer';
import { buildExtractedProductSpec } from '../src/services/spec-builder';
import { ExtractedProductSpec, PricingResult } from '../src/types/structured-product';

// Interface for parse result
interface CliParseResult {
  query: string;
  providerUsed: string;
  modelUsed: string;
  success: boolean;
  spec?: ExtractedProductSpec;
  pricing?: PricingResult;
  quotes?: Array<{
    quoteId: number;
    label: string;
    spec: ExtractedProductSpec;
    pricing: PricingResult;
    missingFields?: { field: string; label: string; message: string }[];
  }>;
  error?: string;
}

const INFERENCE_SERVICE_URL = (process.env.INFERENCE_SERVICE_URL || 'http://localhost:4001').replace(/\/$/, '');
const INFERENCE_SERVICE_API_KEY = process.env.INFERENCE_SERVICE_API_KEY || '';

// Single query processor function — delegates the actual NLP analysis to
// inference-service's POST /api/analyze (same call server.ts's /api/parse-query
// makes), then builds & prices the spec locally exactly like the main app does.
async function processSingleQuery(query: string): Promise<CliParseResult> {
  if (!INFERENCE_SERVICE_API_KEY) {
    return {
      query,
      providerUsed: 'none',
      modelUsed: 'none',
      success: false,
      error: 'INFERENCE_SERVICE_API_KEY manquante dans .env — générez une clé depuis la page d\'admin de inference-service (voir inference-service/README.md).',
    };
  }

  try {
    const analyzeRes = await fetch(`${INFERENCE_SERVICE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INFERENCE_SERVICE_API_KEY}` },
      body: JSON.stringify({ query }),
    });
    const analyzeData: any = await analyzeRes.json();
    if (!analyzeRes.ok || !analyzeData.success) {
      throw new Error(analyzeData.error || `inference-service a répondu ${analyzeRes.status}`);
    }

    const processedQuotes = (analyzeData.quotes || []).map((quote: any, idx: number) => {
      const { spec } = buildExtractedProductSpec({ query, parsedJson: quote.extraction, externalMissingFields: quote.missingFields });
      const pricing = priceStructuredProduct(spec);
      return {
        quoteId: quote.quoteId ?? idx + 1,
        label: quote.label || spec.productTypeName,
        spec,
        pricing,
        missingFields: quote.missingFields,
      };
    });

    return {
      query,
      providerUsed: 'inference-service',
      modelUsed: analyzeData.modelUsed,
      success: true,
      spec: processedQuotes[0].spec,
      pricing: processedQuotes[0].pricing,
      quotes: processedQuotes.length > 1 ? processedQuotes : undefined,
    };
  } catch (err: any) {
    return {
      query,
      providerUsed: 'error',
      modelUsed: 'error',
      success: false,
      error: `Erreur lors de l'appel à inference-service (${INFERENCE_SERVICE_URL}) : ${err.message}. Vérifiez qu'il tourne ("npm run dev" dans inference-service/).`,
    };
  }
}

// CLI Main execution
async function main() {
  const args = process.argv.slice(2);

  let reqsFile: string | null = null;
  let outputFile: string | null = null;
  let includePricing = false;
  let directQuery = '';

  // Parse command line options
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--reqs' && args[i + 1]) {
      reqsFile = args[i + 1];
      i++;
    } else if (arg.startsWith('--reqs=')) {
      reqsFile = arg.split('=')[1];
    } else if (arg === '--output' && args[i + 1]) {
      outputFile = args[i + 1];
      i++;
    } else if (arg.startsWith('--output=')) {
      outputFile = arg.split('=')[1];
    } else if (arg === '--pricing') {
      includePricing = true;
    } else if (!arg.startsWith('--')) {
      directQuery = arg;
    }
  }

  // Determine queries list
  let queriesToProcess: string[] = [];

  if (reqsFile) {
    if (!fs.existsSync(reqsFile)) {
      console.error(`[CLI Error] Le fichier de requêtes spécifié "${reqsFile}" n'existe pas.`);
      process.exit(1);
    }
    const fileContent = fs.readFileSync(reqsFile, 'utf-8');
    // Split by blank lines (\n\n or \r\n\r\n)
    queriesToProcess = fileContent
      .split(/\n\s*\n/)
      .map(q => q.trim())
      .filter(q => q.length > 0);

    if (queriesToProcess.length === 0) {
      console.error(`[CLI Error] Aucun texte de requête valide trouvé dans "${reqsFile}".`);
      process.exit(1);
    }
  } else if (directQuery.trim()) {
    queriesToProcess = [directQuery.trim()];
  } else {
    console.error(`
Usage: npx tsx scripts/parse-query-cli.ts "<requête client>" [options]

Le moteur LLM utilisé (modèle) est celui configuré dans inference-service
(page d'admin http://localhost:4001/admin/login.html) — ce script n'appelle plus
directement Gemini/Ollama/LM Studio, il délègue à inference-service comme le fait
l'application principale.

Options:
  --reqs <filename>       Fichier contenant la liste des requêtes (séparées par une ligne vide)
  --output <filename>     Fichier où stocker les résultats JSON (affichage écran par défaut)
  --pricing               Inclut les résultats de pricing (calculs Monte Carlo, grecques) dans le JSON (exclu par défaut)

Prérequis : inference-service doit tourner (npm run dev dans inference-service/,
avec ses deux sidecars vLLM démarrés séparément — voir inference-service/README.md)
et INFERENCE_SERVICE_URL / INFERENCE_SERVICE_API_KEY doivent être définis dans .env.

Exemples:
  npx tsx scripts/parse-query-cli.ts "Reverse Convertible 1 an TotalEnergies FP"
  npx tsx scripts/parse-query-cli.ts "Autocall LVMH 3 ans" --pricing
  npx tsx scripts/parse-query-cli.ts --reqs requetes.txt --output resultats.json --pricing
`);
    process.exit(1);
  }

  console.error(`[CLI Exec] Traitement de ${queriesToProcess.length} requête(s) via inference-service (${INFERENCE_SERVICE_URL}) (Pricing inclus: ${includePricing ? 'OUI' : 'NON'})...`);

  const results: CliParseResult[] = [];
  for (let i = 0; i < queriesToProcess.length; i++) {
    const query = queriesToProcess[i];
    console.error(`[CLI Exec] [${i + 1}/${queriesToProcess.length}] Parsing : "${query.slice(0, 60)}..."`);
    const res = await processSingleQuery(query);

    // Sanitize pricing output based on --pricing flag
    if (!includePricing) {
      delete res.pricing;
      if (res.quotes) {
        res.quotes = res.quotes.map(q => {
          const qCopy = { ...q };
          delete qCopy.pricing;
          return qCopy;
        });
      }
    }

    results.push(res);
  }

  // Format final JSON output
  const finalJsonOutput = JSON.stringify(results.length === 1 ? results[0] : results, null, 2);

  if (outputFile) {
    fs.writeFileSync(outputFile, finalJsonOutput, 'utf-8');
    console.error(`[CLI Exec] ✅ Succès ! Le fichier JSON a été enregistré dans : ${outputFile}`);
  } else {
    // Print to stdout
    console.log(finalJsonOutput);
  }
}

main().catch((err) => {
  console.error('[CLI Critical Error]', err);
  process.exit(1);
});
