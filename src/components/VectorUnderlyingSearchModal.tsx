import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Sparkles, Check, Cpu, Tag, TrendingUp, ShieldAlert, Award } from 'lucide-react';
import { searchUnderlyingsByVector, VectorSearchResult } from '../services/vector-db';
import { UnderlyingAsset } from '../types/structured-product';

interface VectorUnderlyingSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectUnderlying: (asset: UnderlyingAsset) => void;
  currentUnderlyingTicker?: string;
}

export const VectorUnderlyingSearchModal: React.FC<VectorUnderlyingSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectUnderlying,
  currentUnderlyingTicker,
}) => {
  const [qualitativeQuery, setQualitativeQuery] = useState<string>('actions européennes à fort dividende et faible volatilité');
  const [results, setResults] = useState<VectorSearchResult[]>(() => searchUnderlyingsByVector(qualitativeQuery));

  if (!isOpen) return null;

  const handleSearch = (q: string) => {
    setQualitativeQuery(q);
    setResults(searchUnderlyingsByVector(q));
  };

  const PRESET_QUALITATIVE_SEARCHES = [
    'Luxe européen à fort potentiel de coupon',
    'Fort dividende (>4%) et profil défensif',
    'Technologie & IA haute volatilité pour coupon géant',
    'Transition énergétique et énergie verte',
    'Indice broad market à faible volatilité',
  ];

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl my-auto text-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3.5">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-800 flex items-center justify-center text-emerald-400 shadow-xs">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <span>Recherche Vectorielle Qualitative de Sous-jacent</span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                  VECTOR RAG
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Interrogez la base de données selon des critères qualitatifs (secteur, rendement, profil de volatilité).
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-sm font-bold p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Input bar */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={qualitativeQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="ex: actions luxe volatilité élevée, énergie verte rendement > 5%..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-xs font-semibold text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Quick preset suggestions */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-400 font-bold flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              Idées :
            </span>
            {PRESET_QUALITATIVE_SEARCHES.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => handleSearch(preset)}
                className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all font-medium"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Vector Search Match Results List */}
        <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
          {results.map((res) => {
            const asset = res.underlying || (res as any).asset;
            if (!asset) return null;

            const isSelected = asset.ticker === currentUnderlyingTicker;
            const scoreVal = res.score ?? (res as any).similarityScore ?? 0.8;
            const reason = res.qualitativeSummary || (res as any).matchReason || asset.reasoningForRecommendation;

            return (
              <div
                key={asset.ticker}
                className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-indigo-950/60 border-indigo-700 text-white'
                    : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-extrabold text-sm text-white font-mono">{asset.ticker}</span>
                    <span className="text-xs text-slate-400 font-semibold">{asset.name}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-900 border border-slate-800 text-cyan-300">
                      {asset.sector}
                    </span>
                  </div>

                  {/* Similarity Badge */}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="font-mono text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      <Award className="w-3.5 h-3.5" />
                      Cosine Match: {(scoreVal * 100).toFixed(0)}%
                    </span>
                    <span className="font-mono text-slate-400">Spot: ${asset.spotPrice.toFixed(2)}</span>
                    <span className="font-mono text-slate-400">Vol 3m: {(asset.impliedVol3m * 100).toFixed(1)}%</span>
                    <span className="font-mono text-slate-400">Div: {(asset.dividendYield * 100).toFixed(1)}%</span>
                  </div>

                  <p className="text-[11px] text-slate-400 italic line-clamp-1">"{reason}"</p>
                </div>

                <div className="shrink-0 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectUnderlying(asset);
                      onClose();
                    }}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs'
                    }`}
                  >
                    {isSelected ? 'Sélectionné' : 'Sélectionner'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 pt-3.5 flex items-center justify-between text-xs text-slate-400">
          <span>Recherche alimentée par embeddings qualitatifs &amp; données de marché.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold border border-slate-700"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
