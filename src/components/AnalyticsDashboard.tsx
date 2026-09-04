import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid
} from 'recharts';
import {
  Activity,
  Database,
  TrendingUp,
  Download,
  Trash2,
  Filter,
  Search,
  Sparkles,
  ArrowRight,
  Layers,
  Award,
  Clock,
  Laptop
} from 'lucide-react';
import {
  getCalculationHistory,
  clearCalculationHistory,
  AuditHistoryEntry
} from '../services/history-storage';
import { ExtractedProductSpec, PricingResult } from '../types/structured-product';

interface AnalyticsDashboardProps {
  onLoadHistoricalSpec: (spec: ExtractedProductSpec, pricing: PricingResult) => void;
}

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ onLoadHistoricalSpec }) => {
  const [history, setHistory] = useState<AuditHistoryEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('ALL');

  useEffect(() => {
    setHistory(getCalculationHistory());
  }, []);

  const handleClear = () => {
    if (confirm('Voulez-vous vraiment effacer l\'historique des cotations ?')) {
      clearCalculationHistory();
      setHistory([]);
    }
  };

  const filteredHistory = (history || []).filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const rawQ = String(item.rawQuery || (item as any).queryText || '');
    const ticker = String(item.underlyingTicker || '');
    const pName = String(item.productTypeName || '');
    const search = String(searchTerm || '').toLowerCase();

    const matchesSearch =
      rawQ.toLowerCase().includes(search) ||
      ticker.toLowerCase().includes(search) ||
      pName.toLowerCase().includes(search);
    const itemProv = String(item.provider || 'gemini');
    const matchesProvider = providerFilter === 'ALL' || itemProv === providerFilter;
    return matchesSearch && matchesProvider;
  });

  // Calculate Metrics
  const totalCalculations = history.length;
  const avgCoupon =
    totalCalculations > 0
      ? (history.reduce((acc, curr) => acc + (curr.solvedCouponPct || 0), 0) / totalCalculations).toFixed(2)
      : '0.00';
  const avgAutocallProb =
    totalCalculations > 0
      ? (history.reduce((acc, curr) => acc + (curr.autocallProbPct || 0), 0) / totalCalculations).toFixed(1)
      : '0.0';

  // Count by Product Type for Pie Chart
  const productTypeCounts: Record<string, number> = {};
  history.forEach((h) => {
    const pName = h.productTypeName || 'Produit Structuré';
    productTypeCounts[pName] = (productTypeCounts[pName] || 0) + 1;
  });
  const pieData = Object.entries(productTypeCounts).map(([name, value]) => ({ name, value }));

  // Count by Underlying Ticker for Bar Chart
  const underlyingCounts: Record<string, number> = {};
  history.forEach((h) => {
    const uTicker = h.underlyingTicker || 'MULTI';
    underlyingCounts[uTicker] = (underlyingCounts[uTicker] || 0) + 1;
  });
  const barData = Object.entries(underlyingCounts)
    .map(([ticker, count]) => ({ ticker, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const COLORS = ['#818cf8', '#34d399', '#fbbf24', '#fb7185', '#c084fc', '#38bdf8'];

  const exportCsv = () => {
    const headers = ['ID', 'Horodatage', 'Requete', 'Moteur LLM', 'Produit', 'Sous-Jacent', 'Maturite (Mois)', 'Coupon Solve (%)', 'Fair Value (%)'];
    const rows = history.map((h) => [
      h.id,
      h.timestamp,
      `"${(h.rawQuery || '').replaceAll('"', '""')}"`,
      `${h.provider || 'gemini'} (${h.modelName || 'gemini-3.6-flash'})`,
      `"${h.productTypeName || 'Produit Structuré'}"`,
      h.underlyingTicker || 'MULTI',
      h.spec?.commonParams?.maturityMonths || 36,
      (h.solvedCouponPct || 0).toFixed(2),
      (h.fairValuePct || 100).toFixed(2),
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `structai_history_export_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-950/40 backdrop-blur-md text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 text-xs font-bold uppercase tracking-widest mb-2">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Audit &amp; Intelligence de Cotations</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white">
            Historique &amp; Tableaux de Bord des Cotations
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Suivi en temps réel des volumes, typologies de produits structurés demandés et performances de pricing.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={exportCsv}
            disabled={history.length === 0}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-slate-400" />
            <span>Exporter CSV</span>
          </button>
          <button
            onClick={handleClear}
            disabled={history.length === 0}
            className="px-4 py-2.5 rounded-xl bg-red-950/80 hover:bg-red-900/90 text-red-300 border border-red-800/60 text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
            <span>Vider Historique</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-1">
              Cotations Traitées
            </span>
            <span className="text-2xl font-extrabold text-white font-mono">{totalCalculations}</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-indigo-950/80 border border-indigo-800 flex items-center justify-center text-cyan-400 shadow-xs">
            <Database className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-1">
              Coupon Moyen Solvé
            </span>
            <span className="text-2xl font-extrabold text-cyan-400 font-mono">{avgCoupon} % p.a.</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-950/80 border border-emerald-800 flex items-center justify-center text-emerald-400 shadow-xs">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-1">
              Proba Autocall Moyenne
            </span>
            <span className="text-2xl font-extrabold text-white font-mono">{avgAutocallProb} %</span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-950/80 border border-amber-800 flex items-center justify-center text-amber-400 shadow-xs">
            <Award className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400 block mb-1">
              Sous-jacent Top Demandé
            </span>
            <span className="text-xl font-extrabold text-white font-mono">
              {barData[0]?.ticker || 'MC FP'}
            </span>
          </div>
          <div className="w-11 h-11 rounded-xl bg-purple-950/80 border border-purple-800 flex items-center justify-center text-purple-400 shadow-xs">
            <Layers className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart: Product Types */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-lg shadow-slate-950/40 backdrop-blur-md space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-400" />
            <span>Répartition par Typologie de Produits</span>
          </h3>
          <div className="h-64 w-full">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Aucune donnée enregistrée dans la session
              </div>
            )}
          </div>
        </div>

        {/* Bar Chart: Top Underlyings */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-lg shadow-slate-950/40 backdrop-blur-md space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <span>Top 5 Sous-Jacents les plus cotés</span>
          </h3>
          <div className="h-64 w-full">
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                  <XAxis dataKey="ticker" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc' }} />
                  <Bar dataKey="count" fill="#818cf8" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Aucune donnée enregistrée dans la session
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Filterable History Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-lg shadow-slate-950/40 backdrop-blur-md space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            <span>Journal d'Audit des Demandes Clients ({filteredHistory.length})</span>
          </h3>

          <div className="flex items-center gap-2">
            <div className="relative w-48">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl py-1.5 px-3 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="ALL">Tous Moteurs IA</option>
              <option value="gemini">Gemini Cloud</option>
              <option value="ollama">Ollama (Local)</option>
              <option value="lmstudio">LM Studio (Local)</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto border border-slate-800/80 rounded-xl">
          <table className="w-full text-left border-collapse text-slate-200">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-950">
                <th className="py-3 px-3.5">Date</th>
                <th className="py-3 px-3.5">Demande Client</th>
                <th className="py-3 px-3.5">Moteur LLM</th>
                <th className="py-3 px-3.5">Produit / Sous-jacent</th>
                <th className="py-3 px-3.5 text-right">Coupon Solvé</th>
                <th className="py-3 px-3.5 text-right">Fair Value</th>
                <th className="py-3 px-3.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs">
              {filteredHistory.map((item) => {
                const formattedDate = new Date(item.timestamp).toLocaleString('fr-FR', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const matMonths = item.spec?.commonParams?.maturityMonths || 36;
                const providerLabel = item.provider || 'gemini';
                const modelLabel = item.modelName || 'gemini-3.6-flash';
                const hasSpecAndPricing = !!(item.spec && item.pricing);

                return (
                  <tr key={item.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-3.5 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                      {formattedDate}
                    </td>
                    <td className="py-3 px-3.5 max-w-xs font-medium italic text-slate-300 line-clamp-2">
                      "{item.rawQuery}"
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-slate-950 text-cyan-300 border border-slate-800">
                        {providerLabel} ({modelLabel})
                      </span>
                    </td>
                    <td className="py-3 px-3.5 whitespace-nowrap">
                      <span className="font-bold text-white block">{item.productTypeName || 'Produit Structuré'}</span>
                      <span className="font-mono text-[11px] text-slate-400">{item.underlyingTicker || 'MULTI'} ({matMonths}m)</span>
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono font-extrabold text-cyan-400 whitespace-nowrap">
                      {(item.solvedCouponPct || 0).toFixed(2)} % p.a.
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono text-slate-400 whitespace-nowrap">
                      {(item.fairValuePct || 100).toFixed(2)} %
                    </td>
                    <td className="py-3 px-3.5 text-center whitespace-nowrap">
                      {hasSpecAndPricing ? (
                        <button
                          onClick={() => onLoadHistoricalSpec(item.spec, item.pricing)}
                          className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition-all inline-flex items-center gap-1 shadow-xs cursor-pointer"
                        >
                          <span>Charger</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500">N/A</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-xs text-slate-400">
                    Aucun historique correspondant. Lancez des cotations dans le Workbench pour alimenter le journal.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

