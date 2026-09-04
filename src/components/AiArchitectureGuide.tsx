import React, { useState } from 'react';
import { Cpu, Layers, Database, Code, ShieldCheck, Zap, ArrowRight, CheckCircle2, FileJson, Sparkles } from 'lucide-react';

export const AiArchitectureGuide: React.FC = () => {
  const [activeStep, setActiveStep] = useState<number>(1);

  const PIPELINE_STEPS = [
    {
      stepNumber: 1,
      title: "1. Registre des Schémas Produits (~100 Types)",
      shortDesc: "Modélisation orientée objet des schémas de produits dérivés structurés",
      icon: Database,
      details: [
        "Création d'une interface commune de base `CommonProductParameters` (maturité, sous-jacents, devise, fréquence de rappel, NC).",
        "Extension spécifique par sous-famille de produit (`AutocallParameters`, `PhoenixParameters`, `ReverseConvertibleParameters`, `CreditLinkedParameters`).",
        "Stockage sous forme de registre JSON Schema versionné au niveau de la banque.",
      ],
      codeSnippet: `// TypeScript Interface Architecture
export interface CommonProductParameters {
  underlyings: UnderlyingAsset[];
  maturityMonths: number;            // e.g. 36
  forwardStartMonths: number;        // e.g. 3
  observationFrequency: 'QUARTERLY' | 'SEMI_ANNUALLY';
  nonCallMonths: number;             // e.g. 12
  currency: string;
}

export interface AutocallSpecificParameters {
  autocallBarrierPct: number;        // e.g. 100%
  pdiBarrierPct: number;             // e.g. 70%
  memoryCoupon: boolean;             // Coupon mémoire
}`
    },
    {
      stepNumber: 2,
      title: "2. Extraction LLM & JSON Schema Mode (Gemini 2.5 / 3.6)",
      shortDesc: "Parsing déterministe du langage naturel vers JSON sans hallucination",
      icon: Sparkles,
      details: [
        "Utilisation de `@google/genai` avec la configuration `responseMimeType: 'application/json'` et un `responseSchema` strict.",
        "Prompt système enrichi d'un dictionnaire de jargon financier (NC = Non-Call, PDI = Protection Downside Interactive, fwd 3m = Forward 3 mois).",
        "Extraction simultanée de la variable cible à résoudre (COUPON_RATE, STRIKE, PDI_BARRIER).",
      ],
      codeSnippet: `// Gemini JSON Schema Call
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: \`Analyse cette demande client : "\${query}"\`,
  config: {
    systemInstruction: FINANCIAL_PARSER_SYSTEM_PROMPT,
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        productTypeId: { type: Type.STRING },
        targetToSolve: { type: Type.STRING },
        underlyingQueryOrTicker: { type: Type.STRING },
        pdiBarrierPct: { type: Type.NUMBER },
      }
    }
  }
});`
    },
    {
      stepNumber: 3,
      title: "3. Résolution d'Entités & Linking Tickers (RAG / Volatility DB)",
      shortDesc: "Mappage intelligent des requêtes vagues vers les sous-jacents de marché",
      icon: Layers,
      details: [
        "Mappage immédiat des abréviations de tickers Bloomberg/Reuters : 'MC FP' -> LVMH (ISIN: FR0000121014), 'KER FP' -> Kering.",
        "Recherche sémantique pour requêtes qualitatives : 'stock européen du secteur du luxe qui price bien' -> Filtrage sur l'Europe + Luxe + Volatilité implicite élevée (~28-36%) assurant un fort coupon Autocall.",
        "Enrichissement dynamique avec les données de marché temps réel (Spot, Volatilité implicite 3m, Rendement dividende, Repo).",
      ],
      codeSnippet: `// Entity Linking & Stock Recommendation Engine
export function findUnderlyingByTickerOrQuery(query: string) {
  if (query.includes('LUXE')) {
    // Top picks pour Autocall : LVMH (MC FP), Kering (KER FP)
    return { matches: luxuryStocks, autoSelected: luxuryStocks[0] };
  }
  // Lookup direct par Ticker Bloomberg
  return stockDb.find(s => s.ticker === query);
}`
    },
    {
      stepNumber: 4,
      title: "4. Intégration au Moteur de Pricing Quant (Pont C++ / Python / QuantLib)",
      shortDesc: "Valorisation financière par Monte Carlo, EDP ou formules fermées",
      icon: Cpu,
      details: [
        "Conversion de la spécification JSON extraite par l'IA en objet d'entrée pour la librairie de pricing Quant (QuantLib / Monte Carlo).",
        "Exécution des simulations de trajectoires d'actions pour calculer les probabilités d'Autocall, de franchissement de barrière PDI et la maturité moyenne.",
        "Inversion numérique (Solveur de Newton-Raphson / Dichotomie) pour trouver le coupon exact p.a. équilibrant la valeur théorique de la note à 100.0% (Au Pair).",
      ],
      codeSnippet: `# Exemple de bridge Python / QuantLib
@app.post("/api/v1/price")
def price_product(spec: ProductSpecificationPayload):
    # instanciation du moteur Monte Carlo C++ / Python
    engine = MonteCarloAutocallPricer(
        spot=spec.underlying.spot,
        vol=spec.underlying.implied_vol,
        pdi_barrier=spec.specific_params.pdi_barrier_pct
    )
    # Solve coupon p.a.
    solved_coupon = engine.solve_target_coupon()
    return {"solved_coupon": solved_coupon}`
    },
    {
      stepNumber: 5,
      title: "5. Guardrails, Validation d'Intégrité & Human-In-The-Loop",
      shortDesc: "Contrôle des risques, cohérence des barrières et génération de Termsheet",
      icon: ShieldCheck,
      details: [
        "Validation mathématique des contraintes : Vérification que Barrière PDI < Barrière Autocall, Non-Call <= Maturité.",
        "Alerte de confiance : Si le score de confiance du LLM est inférieur à 0.85, le système demande une confirmation à l'opérateur/structurateur.",
        "Génération automatique de la Termsheet officielle et export du payload JSON structuré pour le book de trading.",
      ],
      codeSnippet: `// Guardrail Rule Check
if (spec.specificParams.pdiBarrierPct >= spec.specificParams.autocallBarrierPct) {
  throw new ValidationError("La barrière PDI ne peut pas être supérieure à la barrière de rappel Autocall.");
}`
    }
  ];

  return (
    <div className="space-y-8 pb-12">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-950/40 backdrop-blur-md text-white">
        <div className="max-w-3xl space-y-3">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 text-xs font-bold uppercase tracking-widest">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span>Architecture Technique &amp; Blueprint IA</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
            L'Approche IA pour Valoriser 100+ Types de Produits Structurés
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Pour réussir ce projet d'envergure, nous recommandons une architecture hybride **IA Générative + Moteur Quant
            Déterministe**. L'IA interprète le langage naturel financier et les tickers, tandis que le moteur Quant calcule le pricing et les probabilités de barrière.
          </p>
        </div>
      </div>

      {/* Interactive Step Pipeline Navigator */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {PIPELINE_STEPS.map((step) => {
          const IconComp = step.icon;
          const isActive = activeStep === step.stepNumber;
          return (
            <button
              key={step.stepNumber}
              onClick={() => setActiveStep(step.stepNumber)}
              className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                isActive
                  ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 border-indigo-500 text-white shadow-lg shadow-indigo-600/30'
                  : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold font-mono ${
                  isActive ? 'bg-white/20 text-white' : 'bg-slate-950 text-slate-400 border border-slate-800'
                }`}>
                  0{step.stepNumber}
                </span>
                <IconComp className={`w-5 h-5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              </div>
              <h3 className="text-xs font-bold leading-tight mb-1">{step.title.split('.')[1]}</h3>
              <p className="text-[10px] opacity-80 line-clamp-2">{step.shortDesc}</p>
            </button>
          );
        })}
      </div>

      {/* Active Step Deep Dive Card */}
      {(() => {
        const current = PIPELINE_STEPS.find((s) => s.stepNumber === activeStep)!;
        const Icon = current.icon;
        return (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-950/40 backdrop-blur-md space-y-6">
            <div className="flex items-center space-x-3 border-b border-slate-800 pb-4">
              <div className="p-3 rounded-xl bg-indigo-950/80 border border-indigo-800 text-cyan-400 shadow-xs">
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">
                  Étape {current.stepNumber} sur 5
                </span>
                <h2 className="text-xl font-extrabold text-white">{current.title}</h2>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Key Functional Pillars */}
              <div className="lg:col-span-6 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Piliers de Mise en Œuvre Déployés
                </h3>
                <ul className="space-y-3">
                  {current.details.map((detail, idx) => (
                    <li key={idx} className="flex items-start gap-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800 text-xs text-slate-200 leading-relaxed">
                      <ArrowRight className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Right Column: Code Implementation Example */}
              <div className="lg:col-span-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <Code className="w-4 h-4 text-indigo-400" />
                    Exemple d'Implémentation Code Production
                  </h3>
                  <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/80 px-2 py-0.5 rounded-full border border-cyan-800 font-bold">
                    PRODUCTION CODE PATTERN
                  </span>
                </div>

                <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800 font-mono text-xs text-emerald-300 overflow-x-auto shadow-inner">
                  <pre>{current.codeSnippet}</pre>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Summary Matrix of AI Approach Benefits */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-950/40 backdrop-blur-md space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <FileJson className="w-5 h-5 text-indigo-400" />
          Pourquoi cette Approche Répond Parfaitement aux 100 Types de Produits :
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
            <span className="text-xs font-bold text-cyan-300 uppercase tracking-wide block">Éscalabilité à 100+ Produits</span>
            <p className="text-xs text-slate-400 leading-relaxed">
              Chaque produit partage une même interface de base (`CommonProductParameters`). Ajouter un 101ème produit consiste uniquement à déclarer son schéma JSON sans réécrire le parser.
            </p>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wide block">Rigueur Financière Sans Hallucination</span>
            <p className="text-xs text-slate-400 leading-relaxed">
              Le mode JSON Schema garantit que le LLM retourne uniquement des valeurs structurées et typées. Aucun calcul de pricing n'est confié au LLM : le pricing reste 100% déterministe (moteur Quant).
            </p>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
            <span className="text-xs font-bold text-indigo-300 uppercase tracking-wide block">Résolution de Tickers et Jargon</span>
            <p className="text-xs text-slate-400 leading-relaxed">
              L'IA résout les abréviations complexes ("NC 1y", "PDI 70%", "fwd 3m") et les recherches thématiques ("stock européen du secteur du luxe") en trouvant les meilleures actions en volatilité.
            </p>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800 space-y-2">
            <span className="text-xs font-bold text-purple-300 uppercase tracking-wide block">Multi-LLM Local &amp; Confidentialité</span>
            <p className="text-xs text-slate-400 leading-relaxed">
              Supporte l'exécution 100% en local via Ollama ou LM Studio (ex: Gemma / Qwen sur Mac) pour préserver la confidentialité des requêtes institutionnelles sensibles.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

