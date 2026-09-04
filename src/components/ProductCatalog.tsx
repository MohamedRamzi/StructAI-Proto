import React, { useState } from 'react';
import { PRODUCT_CATALOG } from '../data/product-taxonomy';
import { ProductCatalogEntry, ProductFamily } from '../types/structured-product';
import { Search, Database, ArrowRight, Sparkles, Layers, ShieldCheck, Check } from 'lucide-react';

interface ProductCatalogProps {
  onSelectQueryToTest: (query: string) => void;
}

export const ProductCatalog: React.FC<ProductCatalogProps> = ({ onSelectQueryToTest }) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedFamily, setSelectedFamily] = useState<string>('ALL');

  const CATEGORIES: { id: string; label: string }[] = [
    { id: 'ALL', label: 'Tous les Produits (100+ Catalog)' },
    { id: 'YIELD_ENHANCEMENT', label: 'Rendement (Autocall, Phoenix, Reverse)' },
    { id: 'CAPITAL_PROTECTION', label: 'Protection du Capital (100% / 95%)' },
    { id: 'PARTICIPATION', label: 'Participation (Bonus, Outperformance)' },
    { id: 'CREDIT_HYBRID', label: 'Crédit & Hybrides (CLN, Rates)' },
  ];

  const filteredCatalog = PRODUCT_CATALOG.filter((item) => {
    const matchesCategory = selectedFamily === 'ALL' || item.family === selectedFamily;
    const matchesSearch =
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.frenchDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.keyFeatures.some((f) => f.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-8 pb-12">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-950/40 backdrop-blur-md text-white">
        <div className="space-y-4">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 text-xs font-bold uppercase tracking-widest">
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span>Taxonomie &amp; Schémas de Produits Dérivés</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
            Catalogue de ~100 Types de Produits Structurés
          </h1>
          <p className="text-sm text-slate-400 max-w-3xl leading-relaxed">
            Explorez les familles de produits structurés gérées par le registre IA. Cliquez sur n'importe quel exemple de demande client pour l'injecter directement dans le Workbench de Valorisation.
          </p>

          {/* Search & Category Filter */}
          <div className="pt-4 flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Rechercher un produit (Autocall, Phoenix, Reverse Convertible, CLN...)"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-medium"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedFamily(cat.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                    selectedFamily === cat.id
                      ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30'
                      : 'bg-slate-950/80 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Catalog Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredCatalog.map((product) => (
          <div
            key={product.id}
            className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-lg shadow-slate-950/40 backdrop-blur-md hover:border-indigo-500/50 transition-all flex flex-col justify-between group"
          >
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
                  {product.family}
                </span>
                <span className="text-[11px] font-mono text-slate-500">ID: {product.id}</span>
              </div>

              <h2 className="text-lg font-extrabold text-white group-hover:text-cyan-300 transition-colors">{product.name}</h2>
              <p className="text-xs text-slate-300 leading-relaxed">{product.frenchDescription}</p>

              {/* Key Features Pill */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {product.keyFeatures.map((feat, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-lg text-[11px] bg-slate-950/80 text-slate-300 border border-slate-800 flex items-center gap-1 font-medium"
                  >
                    <Check className="w-3 h-3 text-emerald-400" />
                    {feat}
                  </span>
                ))}
              </div>

              {/* Payoff Formula Summary */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300">
                <span className="font-bold text-white block mb-1">Formule de Payoff :</span>
                {product.payoffFormulaSummary}
              </div>
            </div>

            {/* Natural Language Example Queries */}
            <div className="pt-4 border-t border-slate-800 space-y-2 mt-4">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                Exemples de Demandes Clients en Langage Naturel :
              </span>
              <div className="space-y-2">
                {product.exampleNaturalLanguageQueries.map((query, qIdx) => (
                  <button
                    key={qIdx}
                    onClick={() => onSelectQueryToTest(query)}
                    className="w-full text-left p-3 rounded-xl bg-slate-950/80 hover:bg-indigo-950/60 border border-slate-800 hover:border-indigo-700/60 text-xs text-slate-200 hover:text-white transition-all flex items-center justify-between group/btn font-medium"
                  >
                    <span className="line-clamp-2 italic">"{query}"</span>
                    <ArrowRight className="w-4 h-4 text-cyan-400 opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

