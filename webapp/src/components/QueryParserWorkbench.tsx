import React, { useState, useEffect } from 'react';
import { ExtractedProductSpec, PricingResult, UnderlyingAsset } from '../types/structured-product';
import { PricingSimulationPanel } from './PricingSimulationPanel';
import { priceStructuredProduct } from '../services/quant-pricer';
import { parseFinancialQuery, QuoteBundle } from '../services/llm-parser';
import { VectorUnderlyingSearchModal } from './VectorUnderlyingSearchModal';
import { RichExtractionPanel } from './RichExtractionPanel';
import {
  Sparkles,
  Sliders,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Cpu,
  RefreshCw,
  HelpCircle,
  Layers,
  ArrowRight,
  Laptop,
  Server,
  Layers3,
  SlidersHorizontal,
  RotateCcw,
  Check,
  Tag,
  Copy,
  ClipboardPaste
} from 'lucide-react';

/** extractedTokens[].parsedValue is `any` — the LLM can map a phrase to a compound
 * value (e.g. an index-decrement `{type, amount, accrualBasis}`), not just a
 * primitive. React throws "Objects are not valid as a React child" if we hand it
 * the raw object, so render anything non-primitive as its JSON text instead. */
function formatTokenValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

interface QueryParserWorkbenchProps {
  initialSpec?: ExtractedProductSpec | null;
  initialPricing?: PricingResult | null;
  onSelectTermsheet: () => void;
  onSpecAndPricingChange?: (spec: ExtractedProductSpec, pricing: PricingResult) => void;
}

export const QueryParserWorkbench: React.FC<QueryParserWorkbenchProps> = ({
  initialSpec,
  initialPricing,
  onSelectTermsheet,
  onSpecAndPricingChange,
}) => {
  const [queryInput, setQueryInput] = useState<string>(initialSpec?.rawQuery || '');
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [isRecalculating, setIsRecalculating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [pasted, setPasted] = useState<boolean>(false);

  const handleCopyQuery = async () => {
    try {
      await navigator.clipboard.writeText(queryInput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handlePasteQuery = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setQueryInput(text);
        setPasted(true);
        setTimeout(() => setPasted(false), 2000);
      }
    } catch (err) {
      console.error('Failed to read from clipboard:', err);
      alert('Accès au presse-papier non autorisé ou non supporté par votre navigateur. Utilisez le raccourci clavier Ctrl+V ou Cmd+V.');
    }
  };
  
  // Active spec & pricing
  const [spec, setSpec] = useState<ExtractedProductSpec | null>(initialSpec || null);
  const [pricing, setPricing] = useState<PricingResult | null>(initialPricing || null);
  const [baseAiSpec, setBaseAiSpec] = useState<ExtractedProductSpec | null>(initialSpec || null);

  // Sync state when initialSpec or initialPricing props change from parent
  useEffect(() => {
    setSpec(initialSpec || null);
    setPricing(initialPricing || null);
    setBaseAiSpec(initialSpec || null);
    if (initialSpec?.rawQuery) {
      setQueryInput(initialSpec.rawQuery);
    }
  }, [initialSpec, initialPricing]);

  // Multi-quote state
  const [quotesBundle, setQuotesBundle] = useState<QuoteBundle[]>([]);
  const [activeQuoteId, setActiveQuoteId] = useState<number>(1);
  const [showComparisonView, setShowComparisonView] = useState<boolean>(false);
  // Set when the active quote was parsed into a rich schema with no local
  // pricer (rates/fx/credit) — the workbench shows RichExtractionPanel instead
  // of the pricing grid. Mutually exclusive with `spec` being set.
  const [activeRichQuote, setActiveRichQuote] = useState<QuoteBundle | null>(null);

  const isPriceable = (q: QuoteBundle) => q.pricingAvailable !== false && !!q.spec && !!q.pricing;

  // Overrides tracker
  const [overriddenFields, setOverriddenFields] = useState<Set<string>>(new Set());

  // Underlying-search modal (semantic search over inference-service's corpus).
  const [showVectorModal, setShowVectorModal] = useState<boolean>(false);

  // Per-request override of inference-service's configured "thinking" mode.
  // "default" = don't send anything, let the service use its configured default.
  const [reasoningMode, setReasoningMode] = useState<'default' | 'auto' | 'fast' | 'thinking'>('default');

  // Presets including multi-quote examples
  const PRESET_QUERIES = [
    {
      label: 'Exemple 1 (Thématique Luxe)',
      text: 'solve le coupon pour un autocall avec départ forward dans 3 mois. Rappel trimestriel. NC 1y. PDI 70% sur un stock européen dans le secteur du luxe qui price bien',
    },
    {
      label: 'Exemple Multi-Cotations (2 Produits)',
      text: 'Proposer 2 cotations : Cotation 1 : Autocall LVMH MC FP 3 ans PDI 70% fwd 3m. Cotation 2 : Phoenix Kering KER FP 2 ans PDI 65% coupon 10%. Solve les coupons.',
    },
    {
      label: 'Exemple 3 (Phoenix Euro Stoxx 50)',
      text: 'Phoenix Memory 3 ans sur Euro Stoxx 50 Index. Rappel semestriel 100%, coupon barrière 75% mémoire, PDI 60% européen. Solve le coupon.',
    },
    {
      label: 'Exemple 4 (Reverse Convertible TotalEnergies)',
      text: 'Reverse Convertible 1 an sur TotalEnergies FP. Coupon garanti 8.5% p.a., protection PDI 65%. Solve la barrière de protection.',
    },
  ];

  // Parse natural language request
  const handleParseQuery = async (queryToRun?: string) => {
    const textToRun = queryToRun || queryInput;
    if (!textToRun.trim()) return;

    setIsParsing(true);
    setOverriddenFields(new Set());
    try {
      const result = await parseFinancialQuery(textToRun, {
        ...(reasoningMode !== 'default' ? { reasoningMode } : {}),
      });
      const hasUsableResult = result.success && (!!result.spec || (result.quotes?.length ?? 0) > 0);
      if (hasUsableResult) {
        // Underlyings are already resolved server-side against inference-service's
        // instrument corpus (the single source) — the workbench does no local
        // re-matching. Normalize to a quotes array (a single-quote response may
        // omit `quotes`).
        const quotes: QuoteBundle[] = (result.quotes && result.quotes.length > 0)
          ? result.quotes
          : (result.spec && result.pricing
              ? [{ quoteId: 1, label: result.spec.productTypeName, spec: result.spec, pricing: result.pricing, pricingAvailable: true }]
              : []);

        setQuotesBundle(quotes.length > 1 ? quotes : []);

        const firstPriceable = quotes.find(isPriceable);
        if (firstPriceable) {
          setActiveQuoteId(firstPriceable.quoteId);
          setActiveRichQuote(null);
          setSpec(firstPriceable.spec!);
          setPricing(firstPriceable.pricing!);
          setBaseAiSpec(firstPriceable.spec!);
          onSpecAndPricingChange?.(firstPriceable.spec!, firstPriceable.pricing!);
        } else if (quotes.length > 0) {
          // Every quote parsed into a rich schema with no local pricer.
          setActiveQuoteId(quotes[0].quoteId);
          setActiveRichQuote(quotes[0]);
          setSpec(null);
          setPricing(null);
          setBaseAiSpec(null);
        }
      } else {
        alert(`Erreur de parsing : ${result.error || 'Modèle non disponible'}`);
      }
    } catch (err: any) {
      console.error(err);
      alert(`Erreur de connexion au service d'analyse NLP : ${err.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  // Switch active quote in multi-quote mode
  const handleSwitchQuote = (quote: QuoteBundle) => {
    setActiveQuoteId(quote.quoteId);
    setOverriddenFields(new Set());
    if (isPriceable(quote)) {
      setActiveRichQuote(null);
      setSpec(quote.spec!);
      setPricing(quote.pricing!);
      setBaseAiSpec(quote.spec!);
      onSpecAndPricingChange?.(quote.spec!, quote.pricing!);
    } else {
      setActiveRichQuote(quote);
      setSpec(null);
      setPricing(null);
      setBaseAiSpec(null);
    }
  };

  // Re-calculate pricing when user manually overrides parameter form
  const handleParamOverride = async (newSpec: ExtractedProductSpec, fieldName: string) => {
    setSpec(newSpec);
    if (fieldName) {
      setOverriddenFields((prev) => new Set(prev).add(fieldName));
    }
    setIsRecalculating(true);
    try {
      const res = await fetch('/api/price-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: newSpec }),
      });
      const data = await res.json();
      if (data.success) {
        setPricing(data.pricing);
        onSpecAndPricingChange?.(newSpec, data.pricing);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRecalculating(false);
    }
  };

  // Restore parameters to original AI extraction
  const handleRestoreAiParams = () => {
    setSpec(baseAiSpec);
    setOverriddenFields(new Set());
    handleParamOverride(baseAiSpec, '');
  };

  // Select stock from Underlying Modal or Vector RAG Search
  const handleSelectUnderlying = (stock: UnderlyingAsset) => {
    const updatedSpec = {
      ...spec,
      commonParams: {
        ...spec.commonParams,
        underlyings: [stock],
      },
    };
    setShowVectorModal(false);
    handleParamOverride(updatedSpec, 'underlyings');
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Search Bar section */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl shadow-slate-950/40 backdrop-blur-md space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white flex items-center gap-2.5">
              <Sparkles className="w-6 h-6 text-cyan-400 animate-pulse" />
              Valorisation &amp; Parsing NLP de Produits Structurés
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Saisissez une ou plusieurs demandes financières. L'IA extrait automatiquement les structures et résout les coupons.
            </p>
          </div>
          <span className="self-start sm:self-auto px-3 py-1 rounded-full text-[10px] font-bold bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 font-mono flex items-center gap-1.5 shadow-xs">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
            NLP_PARSER_ACTIVE
          </span>
        </div>

        {/* Main Natural Language Textarea & Submit */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Saisie de la Requête Client en Langage Naturel
            </span>

            {/* Copy & Paste Clipboard Buttons */}
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleCopyQuery}
                className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs"
                title="Copier le texte de la demande dans le presse-papier"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-bold">Copié !</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Copier</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handlePasteQuery}
                className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 text-xs font-semibold transition-all flex items-center gap-1.5 shadow-xs"
                title="Coller du texte depuis le presse-papier"
              >
                {pasted ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-bold">Collé !</span>
                  </>
                ) : (
                  <>
                    <ClipboardPaste className="w-3.5 h-3.5 text-slate-400" />
                    <span>Coller</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="relative">
            <textarea
              id="nl-query-input"
              rows={3}
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Exemple : Cotation 1 : Autocall LVMH 3y PDI 70% | Cotation 2 : Phoenix Kering 2y PDI 65%. Solve le coupon."
              className="w-full bg-slate-950/90 border border-slate-700/80 rounded-xl p-4 pr-40 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 font-medium resize-none shadow-inner"
            />
            <button
              id="submit-nl-query-btn"
              onClick={() => handleParseQuery()}
              disabled={isParsing}
              className="absolute right-3.5 bottom-3.5 px-5 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-xs sm:text-sm shadow-md shadow-indigo-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isParsing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                  <span>Analyse IA...</span>
                </>
              ) : (
                <>
                  <Cpu className="w-4 h-4 text-cyan-300" />
                  <span>Extraire &amp; Pricer</span>
                </>
              )}
            </button>
          </div>

          <label className="flex items-center gap-2 mt-3 text-xs text-slate-400 font-medium select-none w-fit">
            <span>Raisonnement du modèle :</span>
            <select
              value={reasoningMode}
              onChange={(e) => setReasoningMode(e.target.value as 'default' | 'auto' | 'fast' | 'thinking')}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 accent-indigo-500"
            >
              <option value="default">défaut configuré</option>
              <option value="fast">fast (plus rapide)</option>
              <option value="thinking">thinking (si le parsing échoue)</option>
              <option value="auto">auto</option>
            </select>
          </label>
        </div>

        {/* Preset Buttons */}
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-2.5">
            Exemples de demandes financières clients prédéfinies :
          </span>
          <div className="flex flex-wrap gap-2">
            {PRESET_QUERIES.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setQueryInput(preset.text);
                  handleParseQuery(preset.text);
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs bg-slate-800/80 hover:bg-slate-700/90 border border-slate-700/80 text-slate-200 font-medium transition-all flex items-center gap-2 hover:border-indigo-500/50 hover:text-white"
              >
                <ArrowRight className="w-3 h-3 text-cyan-400" />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Multi-Quote Bar (Feature 1: Multi-Demande dans une seule requête) */}
      {quotesBundle.length > 1 && (
        <div className="bg-slate-900/90 border border-indigo-500/40 rounded-2xl p-5 shadow-xl shadow-slate-950/40 backdrop-blur-md space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Layers3 className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">
                Multi-Cotations Détectées ({quotesBundle.length} structures dans la demande)
              </h3>
            </div>

            <button
              onClick={() => setShowComparisonView(!showComparisonView)}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-950/80 hover:bg-indigo-900/90 border border-indigo-700/60 text-indigo-200 text-xs font-bold transition-all self-start sm:self-auto"
            >
              {showComparisonView ? 'Masquer le Comparateur' : 'Afficher le Comparateur Côte à Côte'}
            </button>
          </div>

          {/* Quote Selection Tabs */}
          <div className="flex flex-wrap gap-2">
            {quotesBundle.map((q) => {
              const priceable = isPriceable(q);
              const couponVal = q.pricing?.solvedTarget?.solvedValueNumber ?? (q.pricing as any)?.solvedCouponPct ?? 0;
              return (
                <button
                  key={q.quoteId}
                  onClick={() => handleSwitchQuote(q)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border ${
                    activeQuoteId === q.quoteId
                      ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white border-indigo-500 shadow-md shadow-indigo-600/30'
                      : 'bg-slate-950/60 text-slate-300 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${priceable ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                  <span>{q.label}</span>
                  <span className="font-mono text-cyan-300 text-[11px]">
                    {priceable ? `(${couponVal.toFixed(2)}%)` : `(${q.schemaVersion || 'parse-only'})`}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Side-by-Side Comparison Matrix */}
          {showComparisonView && (
            <div className="mt-4 pt-4 border-t border-slate-800 overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse text-slate-200">
                <thead>
                  <tr className="bg-slate-950 text-slate-400 uppercase font-bold text-[10px] border-b border-slate-800">
                    <th className="p-3">Structure</th>
                    <th className="p-3">Sous-jacent</th>
                    <th className="p-3">Maturité</th>
                    <th className="p-3">PDI Barrier</th>
                    <th className="p-3 text-right">Coupon Solvé p.a.</th>
                    <th className="p-3 text-right">Fair Value</th>
                    <th className="p-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-medium">
                  {quotesBundle.map((q) => {
                    const priceable = isPriceable(q);
                    const cVal = q.pricing?.solvedTarget?.solvedValueNumber ?? (q.pricing as any)?.solvedCouponPct ?? 0;
                    const fVal = q.pricing?.theoreticalValuePct ?? (q.pricing as any)?.fairValuePct ?? 100;
                    const ticker = q.spec?.commonParams?.underlyings?.[0]?.ticker
                      || (q.routing ? `${q.routing.assetClass ?? '—'} / ${q.routing.productFamily ?? '—'}` : 'MULTI');
                    const mat = q.spec?.commonParams?.maturityMonths ?? null;
                    const pdi = (q.spec?.specificParams as any)?.pdiBarrierPct ?? null;

                    return (
                      <tr
                        key={q.quoteId}
                        className={activeQuoteId === q.quoteId ? 'bg-indigo-950/60 font-bold text-white' : 'hover:bg-slate-800/50'}
                      >
                        <td className="p-3 text-white">{q.spec?.productTypeName || q.label || 'Produit Structuré'}</td>
                        <td className="p-3 font-mono text-cyan-400">
                          {ticker}
                        </td>
                        <td className="p-3">{mat != null ? `${mat}m` : '—'}</td>
                        <td className="p-3">{pdi != null ? `${pdi}%` : '—'}</td>
                        <td className="p-3 text-right font-mono font-extrabold text-emerald-400 text-sm">
                          {priceable ? `${cVal.toFixed(2)} %` : '—'}
                        </td>
                        <td className="p-3 text-right font-mono text-slate-300">
                          {priceable ? `${fVal.toFixed(2)} %` : <span className="text-amber-400 text-[11px]">pricing indispo.</span>}
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleSwitchQuote(q)}
                            className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px]"
                          >
                            Sélectionner
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Rich parse-only quote (rates/fx/credit — no local pricer), Main Workbench Grid, or Blank State Welcome */}
      {activeRichQuote && !spec ? (
        <RichExtractionPanel quote={activeRichQuote} />
      ) : !spec || !spec.commonParams?.underlyings?.length ? (
        <div key="welcome-placeholder-card" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-4 shadow-xl backdrop-blur-md max-w-3xl mx-auto my-6">
          <div className="w-14 h-14 rounded-2xl bg-indigo-950/80 border border-indigo-700/60 flex items-center justify-center text-cyan-400 mx-auto shadow-md">
            <Sparkles className="w-7 h-7 animate-pulse text-cyan-400" />
          </div>
          <div className="space-y-2 max-w-lg mx-auto">
            <h3 className="text-lg font-extrabold text-white">Assistant StructAI Prêt</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Saisissez une demande client de produit structuré en langage naturel ci-dessus, ou cliquez sur l'un des exemples prédéfinis pour lancer l'extraction NLP et la simulation Monte Carlo.
            </p>
          </div>
        </div>
      ) : (
        <div key="workbench-details-grid" className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (5 cols): AI Extraction Rationale & Token Mapping */}
        <div className="lg:col-span-5 space-y-6">
          {/* Product Identification Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                  Identification Produit IA
                </h3>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-mono">
                Confiance {(spec.confidenceScore * 100).toFixed(0)}%
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <span className="text-xs text-slate-400 block">Type de Produit Structuré Détecté :</span>
                <span className="text-lg font-extrabold text-white">{spec.productTypeName}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Famille</span>
                  <span className="text-xs font-bold text-indigo-300">{spec.productFamily}</span>
                </div>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Variable Résolue</span>
                  <span className="text-xs font-bold text-emerald-400 font-mono">{spec.targetToSolve}</span>
                </div>
              </div>

              {/* AI Explanation Text */}
              <div className="bg-indigo-950/50 border border-indigo-800/60 rounded-xl p-3.5 text-xs text-indigo-200 leading-relaxed">
                <span className="font-bold text-white block mb-1">Raisonnement de l'Analyseur IA :</span>
                {spec.aiExplanation}
              </div>
            </div>
          </div>

          {/* Extracted Tokens Table */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" />
              Mappage des Termes de Jargon Financier Extraits
            </h3>

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-xs text-left text-slate-200">
                <thead className="bg-slate-950 text-slate-400 uppercase tracking-widest text-[10px] font-bold border-b border-slate-800">
                  <tr>
                    <th className="px-3 py-2.5">Expression Source</th>
                    <th className="px-3 py-2.5">Paramètre Structuré</th>
                    <th className="px-3 py-2.5">Valeur Mappée</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {spec.extractedTokens.map((token, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/40">
                      <td className="px-3 py-2.5 font-mono text-cyan-300 bg-slate-950/40">
                        "{token.phrase}"
                      </td>
                      <td className="px-3 py-2.5 text-slate-300 font-medium">
                        {token.parameterName}
                      </td>
                      <td className="px-3 py-2.5 text-emerald-400 font-bold font-mono">
                        {formatTokenValue(token.parsedValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column (7 cols): Active Stock Card & Parameter Grid Controls */}
        <div className="lg:col-span-7 space-y-6">
          {/* Active Underlying Asset Card */}
          {spec.commonParams.underlyings[0] && (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md relative">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
                      {spec.commonParams.underlyings[0].ticker}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">{spec.commonParams.underlyings[0].isin}</span>
                  </div>
                  <h3 className="text-lg font-extrabold text-white mt-1">
                    {spec.commonParams.underlyings[0].name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Secteur : {spec.commonParams.underlyings[0].sector} | {spec.commonParams.underlyings[0].region}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowVectorModal(true)}
                    className="px-3.5 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-200 border border-emerald-700/60 text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Changer le sous-jacent (recherche)</span>
                  </button>
                </div>
              </div>

              {/* Stock Parameters Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Prix Spot</span>
                  <span className="text-sm font-mono font-extrabold text-white">
                    {spec.commonParams.underlyings[0].spotPrice} {spec.commonParams.underlyings[0].currency}
                  </span>
                </div>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Volatilité Implicite 3m</span>
                  <span className="text-sm font-mono font-extrabold text-amber-400">
                    {(spec.commonParams.underlyings[0].impliedVol3m * 100).toFixed(1)}% p.a.
                  </span>
                </div>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Rendement Dividende</span>
                  <span className="text-sm font-mono font-extrabold text-emerald-400">
                    {(spec.commonParams.underlyings[0].dividendYield * 100).toFixed(1)}% p.a.
                  </span>
                </div>
                <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Aptitude Autocall</span>
                  <span className="text-xs font-bold text-cyan-300">
                    {spec.commonParams.underlyings[0].volatilityScore === 'EXCELLENT_FOR_AUTOCALL'
                      ? 'Excellente (Price Bien)'
                      : 'Standard'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Feature 4: Interactive Parameter Grid with Explicit Overrides & Badges */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">
                  Grille des Paramètres &amp; Surcharges Manuelles
                </h3>
              </div>

              {overriddenFields.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800 font-mono flex items-center gap-1">
                    <SlidersHorizontal className="w-3 h-3 text-amber-400" />
                    <span>{overriddenFields.size} Paramètre(s) Surchargé(s)</span>
                  </span>

                  <button
                    onClick={handleRestoreAiParams}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1 border border-slate-700"
                  >
                    <RotateCcw className="w-3 h-3 text-slate-400" />
                    <span>Rétablir Valeurs IA</span>
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              {/* Maturity */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-bold">Maturité Totale (en mois) :</label>
                  {!spec.commonParams.maturityMonths ? (
                    <span className="text-[9px] font-bold text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-700/80 animate-pulse flex items-center gap-1">
                      ⚠️ À préciser (Unspecified)
                    </span>
                  ) : overriddenFields.has('maturityMonths') ? (
                    <span className="text-[9px] font-bold text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800">
                      Surchargé
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-500">IA Extrait</span>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    min={1}
                    max={120}
                    step={1}
                    placeholder="ex: 36 (À préciser)"
                    value={spec.commonParams.maturityMonths ?? ''}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      const numMonths = isNaN(val) ? null : Math.max(1, val);
                      const newSpec = {
                        ...spec,
                        commonParams: { ...spec.commonParams, maturityMonths: numMonths },
                        missingRequiredParams: (spec.missingRequiredParams || []).filter((p: any) => (typeof p === 'string' ? p : p.param) !== 'maturityMonths'),
                      };
                      handleParamOverride(newSpec, 'maturityMonths');
                    }}
                    className={`w-full bg-slate-950 border rounded-xl p-2.5 pr-28 text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                      !spec.commonParams.maturityMonths
                        ? 'border-amber-500/80 bg-amber-950/20 ring-1 ring-amber-500/50'
                        : overriddenFields.has('maturityMonths')
                        ? 'border-amber-500 ring-1 ring-amber-500/50'
                        : 'border-slate-800'
                    }`}
                  />
                  <span className="absolute right-3 text-xs font-bold text-slate-400 pointer-events-none">
                    {!spec.commonParams.maturityMonths
                      ? 'Non spécifiée'
                      : `${spec.commonParams.maturityMonths} mois (${(spec.commonParams.maturityMonths / 12).toFixed(1).replace('.0', '')}y)`}
                  </span>
                </div>

                {/* Quick maturity selection presets when unspecified */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[10px] text-slate-400 font-medium">Définir rapidement :</span>
                  {[
                    { label: '1 an (12m)', value: 12 },
                    { label: '2 ans (24m)', value: 24 },
                    { label: '3 ans (36m)', value: 36 },
                    { label: '5 ans (60m)', value: 60 },
                    { label: '10 ans (120m)', value: 120 },
                  ].map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => {
                        const newSpec = {
                          ...spec,
                          commonParams: { ...spec.commonParams, maturityMonths: preset.value },
                          missingRequiredParams: (spec.missingRequiredParams || []).filter((p: any) => (typeof p === 'string' ? p : p.param) !== 'maturityMonths'),
                        };
                        handleParamOverride(newSpec, 'maturityMonths');
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                        spec.commonParams.maturityMonths === preset.value
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs'
                          : 'bg-slate-950/80 hover:bg-slate-800 border-slate-800 text-slate-300'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Forward Start */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-bold">Départ Forward (en mois) :</label>
                  {overriddenFields.has('forwardStartMonths') ? (
                    <span className="text-[9px] font-bold text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800">
                      Surchargé
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-500">IA Extrait</span>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    min={0}
                    max={60}
                    step={1}
                    value={spec.commonParams.forwardStartMonths ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      const numMonths = isNaN(val) ? 0 : Math.max(0, val);
                      const newSpec = {
                        ...spec,
                        commonParams: { ...spec.commonParams, forwardStartMonths: numMonths },
                      };
                      handleParamOverride(newSpec, 'forwardStartMonths');
                    }}
                    className={`w-full bg-slate-950 border rounded-xl p-2.5 pr-24 text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                      overriddenFields.has('forwardStartMonths') ? 'border-amber-500 ring-1 ring-amber-500/50' : 'border-slate-800'
                    }`}
                  />
                  <span className="absolute right-3 text-xs font-bold text-slate-400 pointer-events-none">
                    {spec.commonParams.forwardStartMonths === 0 ? 'mois (Spot 0m)' : 'mois'}
                  </span>
                </div>
              </div>

              {/* Observation Frequency */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-bold">Fréquence d'Observation :</label>
                  {overriddenFields.has('observationFrequency') ? (
                    <span className="text-[9px] font-bold text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800">
                      Surchargé
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-500">IA Extrait</span>
                  )}
                </div>
                <select
                  value={spec.commonParams.observationFrequency}
                  onChange={(e) => {
                    const newSpec = {
                      ...spec,
                      commonParams: { ...spec.commonParams, observationFrequency: e.target.value as any },
                    };
                    handleParamOverride(newSpec, 'observationFrequency');
                  }}
                  className={`w-full bg-slate-950 border rounded-xl p-2.5 text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    overriddenFields.has('observationFrequency') ? 'border-amber-500 ring-1 ring-amber-500/50' : 'border-slate-800'
                  }`}
                >
                  <option value="MONTHLY">Mensuelle</option>
                  <option value="QUARTERLY">Trimestrielle</option>
                  <option value="SEMI_ANNUALLY">Semestrielle</option>
                  <option value="ANNUALLY">Annuelle</option>
                </select>
              </div>

              {/* Non-Call Period */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-bold">Période Non-Call NC (en mois) :</label>
                  {overriddenFields.has('nonCallMonths') ? (
                    <span className="text-[9px] font-bold text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800">
                      Surchargé
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-500">IA Extrait</span>
                  )}
                </div>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    min={0}
                    max={120}
                    step={1}
                    value={spec.commonParams.nonCallMonths ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      const numMonths = isNaN(val) ? 0 : Math.max(0, val);
                      const newSpec = {
                        ...spec,
                        commonParams: { ...spec.commonParams, nonCallMonths: numMonths },
                      };
                      handleParamOverride(newSpec, 'nonCallMonths');
                    }}
                    className={`w-full bg-slate-950 border rounded-xl p-2.5 pr-28 text-white font-mono font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                      overriddenFields.has('nonCallMonths') ? 'border-amber-500 ring-1 ring-amber-500/50' : 'border-slate-800'
                    }`}
                  />
                  <span className="absolute right-3 text-xs font-bold text-slate-400 pointer-events-none">
                    {spec.commonParams.nonCallMonths === 0 ? 'mois (Pas de NC)' : 'mois'}
                  </span>
                </div>
              </div>

              {/* PDI Barrier % */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-bold">Barrière PDI / Protection (%) :</label>
                  {overriddenFields.has('pdiBarrierPct') ? (
                    <span className="text-[9px] font-bold text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800">
                      Surchargé
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-500">IA Extrait</span>
                  )}
                </div>
                <input
                  type="number"
                  min={40}
                  max={90}
                  step={5}
                  value={spec.specificParams?.pdiBarrierPct ?? 70}
                  onChange={(e) => {
                    const newSpec = {
                      ...spec,
                      specificParams: { ...spec.specificParams, pdiBarrierPct: parseFloat(e.target.value) },
                    };
                    handleParamOverride(newSpec, 'pdiBarrierPct');
                  }}
                  className={`w-full bg-slate-950 border rounded-xl p-2.5 text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    overriddenFields.has('pdiBarrierPct') ? 'border-amber-500 ring-1 ring-amber-500/50' : 'border-slate-800'
                  }`}
                />
              </div>

              {/* Autocall Barrier % */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-300 font-bold">Barrière Autocall (%) :</label>
                  {overriddenFields.has('autocallBarrierPct') ? (
                    <span className="text-[9px] font-bold text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded border border-amber-800">
                      Surchargé
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-500">IA Extrait</span>
                  )}
                </div>
                <input
                  type="number"
                  min={80}
                  max={110}
                  step={5}
                  value={spec.specificParams?.autocallBarrierPct ?? 100}
                  onChange={(e) => {
                    const newSpec = {
                      ...spec,
                      specificParams: { ...spec.specificParams, autocallBarrierPct: parseFloat(e.target.value) },
                    };
                    handleParamOverride(newSpec, 'autocallBarrierPct');
                  }}
                  className={`w-full bg-slate-950 border rounded-xl p-2.5 text-white font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                    overriddenFields.has('autocallBarrierPct') ? 'border-amber-500 ring-1 ring-amber-500/50' : 'border-slate-800'
                  }`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Pricing Analytics & Payoff / Monte Carlo Charts */}
      <PricingSimulationPanel spec={spec} pricing={pricing} isRecalculating={isRecalculating} />

      {/* Vector Underlying RAG Search Modal */}
      <VectorUnderlyingSearchModal
        isOpen={showVectorModal}
        onClose={() => setShowVectorModal(false)}
        onSelectUnderlying={handleSelectUnderlying}
        currentUnderlyingTicker={spec?.commonParams?.underlyings?.[0]?.ticker}
      />

    </div>
  );
};

