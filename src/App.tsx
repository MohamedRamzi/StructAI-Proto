import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { QueryParserWorkbench } from './components/QueryParserWorkbench';
import { TermsheetPreview } from './components/TermsheetPreview';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { UnderlyingsManagementDashboard } from './components/UnderlyingsManagementDashboard';
import { ExtractedProductSpec, PricingResult, UnderlyingAsset } from './types/structured-product';
import { STOCK_DATABASE } from './data/underlyings-db';
import { priceStructuredProduct } from './services/quant-pricer';
import { getStoredUnderlyings, syncUnderlyingsWithServer } from './services/underlyings-storage';

// Default initial specification matching User Example 1
const DEFAULT_INITIAL_SPEC: ExtractedProductSpec = {
  rawQuery: 'solve le coupon pour un autocall avec départ forward dans 3 mois. Rappel trimestriel. NC 1y. PDI 70% sur un stock européen dans le secteur du luxe qui price bien',
  productTypeId: 'AUTOCALL_CLASSIC',
  productTypeName: 'Autocall Classic Forward Start',
  productFamily: 'YIELD_ENHANCEMENT',
  targetToSolve: 'COUPON_RATE',
  commonParams: {
    underlyings: [STOCK_DATABASE[0]], // LVMH Moët Hennessy Louis Vuitton (MC FP)
    basketType: 'SINGLE',
    maturityMonths: 36,
    forwardStartMonths: 3,
    observationFrequency: 'QUARTERLY',
    nonCallMonths: 12,
    currency: 'EUR',
    denomination: 1000,
    issuerCreditRating: 'A+',
    fundingSpreadBps: 45,
  },
  specificParams: {
    autocallBarrierPct: 100,
    pdiBarrierPct: 70,
    pdiType: 'EUROPEAN',
    memoryCoupon: true,
  },
  confidenceScore: 0.96,
  extractedTokens: [
    { phrase: 'solve le coupon', parameterName: 'targetToSolve', parsedValue: 'COUPON_RATE' },
    { phrase: 'départ forward dans 3 mois', parameterName: 'forwardStartMonths', parsedValue: '3 mois' },
    { phrase: 'Rappel trimestriel', parameterName: 'observationFrequency', parsedValue: 'QUARTERLY' },
    { phrase: 'NC 1y', parameterName: 'nonCallMonths', parsedValue: '12 mois' },
    { phrase: 'PDI 70%', parameterName: 'pdiBarrierPct', parsedValue: '70% European' },
    { phrase: 'stock européen secteur luxe qui price bien', parameterName: 'underlyings', parsedValue: 'LVMH MC FP (Vol 28.5%)' }
  ],
  missingRequiredParams: [],
  assumedDefaults: [
    { param: 'maturité', value: '36 mois (3 ans)', reason: 'Durée standard pour structure Autocall' },
    { param: 'barrière de rappel', value: '100%', reason: 'Rappel au niveau initial' },
    { param: 'spread émetteur', value: '45 bps', reason: 'Rating émetteur A+' }
  ],
  aiExplanation: 'L\'analyseur IA a correctement identifié la structure Autocall Classic avec départ différé de 3 mois. Pour la requête thématique "stock européen du secteur du luxe qui price bien", LVMH (MC FP) a été sélectionné pour sa volatilité de 28.5% qui génère le coupon le plus compétitif.',
  underlyingSelectionNote: 'LVMH (MC FP) présente une volatilité implicite élevée (~28.5%) idéale pour maximiser le coupon Autocall à barrière PDI 70%.',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'workbench' | 'termsheet' | 'analytics' | 'underlyings'>('workbench');
  const [spec, setSpec] = useState<ExtractedProductSpec | null>(null);
  const [pricing, setPricing] = useState<PricingResult | null>(null);

  // Sync stored underlyings with backend server on mount
  useEffect(() => {
    syncUnderlyingsWithServer(getStoredUnderlyings());
  }, []);

  const handleLoadHistoricalSpec = (historicalSpec: ExtractedProductSpec, historicalPricing: PricingResult) => {
    setSpec(historicalSpec);
    setPricing(historicalPricing);
    setActiveTab('workbench');
  };

  const handleSelectStockForPricing = (stock: UnderlyingAsset) => {
    const baseSpec: ExtractedProductSpec = spec || DEFAULT_INITIAL_SPEC;
    const updatedSpec: ExtractedProductSpec = {
      ...baseSpec,
      rawQuery: `Autocall 3 ans sur ${stock.name} (${stock.ticker})`,
      commonParams: {
        ...baseSpec.commonParams,
        underlyings: [stock],
      },
      underlyingSelectionNote: stock.reasoningForRecommendation || `Sous-jacent ${stock.name} sélectionné.`
    };
    const newPricing = priceStructuredProduct(updatedSpec);
    setSpec(updatedSpec);
    setPricing(newPricing);
    setActiveTab('workbench');
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 font-sans antialiased selection:bg-indigo-500 selection:text-white relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[350px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute top-1/3 right-10 w-[500px] h-[300px] bg-cyan-600/10 rounded-full blur-[100px] pointer-events-none"></div>
      {/* Top Sticky Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'workbench' && (
          <QueryParserWorkbench
            initialSpec={spec}
            initialPricing={pricing}
            onSelectTermsheet={() => setActiveTab('termsheet')}
            onSpecAndPricingChange={(newSpec, newPricing) => {
              setSpec(newSpec);
              setPricing(newPricing);
            }}
          />
        )}

        {activeTab === 'termsheet' && <TermsheetPreview spec={spec} pricing={pricing} />}

        {activeTab === 'analytics' && (
          <AnalyticsDashboard onLoadHistoricalSpec={handleLoadHistoricalSpec} />
        )}

        {activeTab === 'underlyings' && <UnderlyingsManagementDashboard onSelectStockForPricing={handleSelectStockForPricing} />}
      </main>
    </div>
  );
}
