import React, { useState, useEffect } from 'react';
import { UnderlyingAsset } from '../types/structured-product';
import {
  getStoredUnderlyings,
  saveUnderlyingAsset,
  deleteUnderlyingAsset,
  resetUnderlyingsDatabase,
  exportUnderlyingsToCsv,
  importUnderlyingsFromCsv
} from '../services/underlyings-storage';
import {
  Database,
  Plus,
  Search,
  Download,
  Upload,
  RotateCcw,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  FileSpreadsheet,
  TrendingUp,
  Layers,
  Sparkles,
  DollarSign
} from 'lucide-react';

export interface UnderlyingsManagementDashboardProps {
  onSelectStockForPricing?: (stock: UnderlyingAsset) => void;
}

export const UnderlyingsManagementDashboard: React.FC<UnderlyingsManagementDashboardProps> = ({
  onSelectStockForPricing
}) => {
  const [underlyings, setUnderlyings] = useState<UnderlyingAsset[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sectorFilter, setSectorFilter] = useState('ALL');

  // Add / Edit Modal State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTicker, setEditingTicker] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<UnderlyingAsset>>({
    ticker: '',
    isin: '',
    name: '',
    sector: 'Consommation Discrétionnaire / Luxe',
    region: 'Europe (France - CAC40)',
    spotPrice: 100,
    currency: 'EUR',
    impliedVol3m: 0.25,
    dividendYield: 0.02,
    repoRate: 0.001,
    volatilityScore: 'EXCELLENT_FOR_AUTOCALL',
    reasoningForRecommendation: ''
  });

  // CSV Import Modal State
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importMessage, setImportMessage] = useState<{ success?: boolean; text: string } | null>(null);

  useEffect(() => {
    setUnderlyings(getStoredUnderlyings());
  }, []);

  const handleOpenAddModal = () => {
    setEditingTicker(null);
    setFormData({
      ticker: '',
      isin: '',
      name: '',
      sector: 'Consommation Discrétionnaire / Luxe',
      region: 'Europe (France - CAC40)',
      spotPrice: 100,
      currency: 'EUR',
      impliedVol3m: 0.25,
      dividendYield: 0.02,
      repoRate: 0.001,
      volatilityScore: 'EXCELLENT_FOR_AUTOCALL',
      reasoningForRecommendation: ''
    });
    setShowEditModal(true);
  };

  const handleOpenEditModal = (asset: UnderlyingAsset) => {
    setEditingTicker(asset.ticker);
    setFormData({ ...asset });
    setShowEditModal(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.ticker || !formData.name) {
      alert('Veuillez remplir au moins le Ticker et le Nom du sous-jacent.');
      return;
    }

    const savedAsset: UnderlyingAsset = {
      ticker: formData.ticker.trim().toUpperCase(),
      isin: formData.isin || `FR-${formData.ticker.trim().toUpperCase()}`,
      name: formData.name,
      sector: formData.sector || 'Actions Générales',
      region: formData.region || 'Europe',
      spotPrice: Number(formData.spotPrice) || 100,
      currency: formData.currency || 'EUR',
      impliedVol3m: Number(formData.impliedVol3m) || 0.25,
      dividendYield: Number(formData.dividendYield) || 0.02,
      repoRate: Number(formData.repoRate) || 0.001,
      volatilityScore: formData.volatilityScore || 'MEDIUM',
      reasoningForRecommendation: formData.reasoningForRecommendation || 'Titre ajouté manuellement dans la base de données.'
    };

    const updated = saveUnderlyingAsset(savedAsset);
    setUnderlyings(updated);
    setShowEditModal(false);
  };

  const handleDelete = (ticker: string) => {
    if (confirm(`Voulez-vous vraiment supprimer le sous-jacent ${ticker} de la base de données ?`)) {
      const updated = deleteUnderlyingAsset(ticker);
      setUnderlyings(updated);
    }
  };

  const handleResetDb = () => {
    if (confirm('Voulez-vous réinitialiser la base de données des sous-jacents aux valeurs institutionnelles par défaut ?')) {
      const reseted = resetUnderlyingsDatabase();
      setUnderlyings(reseted);
    }
  };

  const handleExportCsv = () => {
    const csv = exportUnderlyingsToCsv();
    const encodedUri = encodeURI('data:text/csv;charset=utf-8,' + csv);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `structai_underlyings_db_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvText(content || '');
    };
    reader.readAsText(file);
  };

  const handleRunImportCsv = () => {
    if (!csvText.trim()) {
      setImportMessage({ success: false, text: 'Veuillez sélectionner ou coller un fichier CSV.' });
      return;
    }

    const res = importUnderlyingsFromCsv(csvText);
    if (res.success) {
      setUnderlyings(getStoredUnderlyings());
      setImportMessage({ success: true, text: `Succès : ${res.count} sous-jacents importés ou mis à jour !` });
      setTimeout(() => {
        setShowImportModal(false);
        setImportMessage(null);
        setCsvText('');
      }, 1500);
    } else {
      setImportMessage({ success: false, text: res.error || 'Erreur lors de l\'importation CSV.' });
    }
  };

  // Filter logic
  const sectors = Array.from(new Set(underlyings.map(u => u.sector)));
  const filteredUnderlyings = underlyings.filter(u => {
    const matchesSearch =
      u.ticker.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.isin || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.sector.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSector = sectorFilter === 'ALL' || u.sector === sectorFilter;
    return matchesSearch && matchesSector;
  });

  return (
    <div className="space-y-8 pb-12">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-950/40 backdrop-blur-md text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 text-xs font-bold uppercase tracking-widest mb-2">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span>Référentiel Moteur Quant &amp; RAG</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white">
            Gestion &amp; Maintenance de la Base des Sous-Jacents ({underlyings.length})
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Gérez les actions, indices et paniers pris en compte par le moteur d'extraction NLP, la recherche vectorielle et les simulations Monte Carlo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleOpenAddModal}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white font-bold text-xs shadow-md shadow-indigo-600/30 transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Ajouter Titre</span>
          </button>

          <button
            onClick={() => setShowImportModal(true)}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all flex items-center gap-2"
          >
            <Upload className="w-4 h-4 text-emerald-400" />
            <span>Importer CSV</span>
          </button>

          <button
            onClick={handleExportCsv}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all flex items-center gap-2"
          >
            <Download className="w-4 h-4 text-slate-400" />
            <span>Exporter CSV</span>
          </button>

          <button
            onClick={handleResetDb}
            className="px-3.5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs font-semibold transition-all flex items-center gap-1.5"
            title="Réinitialiser la base de données aux 10+ valeurs institutionnelles par défaut"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Réinitialiser</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Rechercher par Ticker, ISIN, Nom de Société, Secteur..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center space-x-3">
          <span className="text-xs font-semibold text-slate-400">Filtrer par Secteur :</span>
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs font-semibold text-white focus:outline-none focus:border-indigo-500"
          >
            <option value="ALL">Tous les Secteurs ({underlyings.length})</option>
            {sectors.map((sec) => (
              <option key={sec} value={sec}>{sec}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Underlyings Database Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-lg shadow-slate-950/40 backdrop-blur-md space-y-4">
        <div className="overflow-x-auto border border-slate-800/80 rounded-xl">
          <table className="w-full text-left border-collapse text-slate-200">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-950">
                <th className="py-3.5 px-4">Ticker / ISIN</th>
                <th className="py-3.5 px-4">Sous-Jacent (Société)</th>
                <th className="py-3.5 px-4">Secteur &amp; Région</th>
                <th className="py-3.5 px-4 text-right">Prix Spot</th>
                <th className="py-3.5 px-4 text-right">Vol 3M</th>
                <th className="py-3.5 px-4 text-right">Dividende</th>
                <th className="py-3.5 px-4 text-center">Score Pricing</th>
                <th className="py-3.5 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-xs font-medium">
              {filteredUnderlyings.map((u) => (
                <tr key={u.ticker} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <span className="px-2.5 py-1 rounded-lg bg-indigo-950 text-indigo-300 border border-indigo-800/80 font-mono font-bold block text-xs w-fit">
                      {u.ticker}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono block mt-1">{u.isin || 'N/A'}</span>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className="font-extrabold text-white text-sm block">{u.name}</span>
                    <span className="text-[11px] text-slate-400 italic line-clamp-1 mt-0.5" title={u.reasoningForRecommendation}>
                      {u.reasoningForRecommendation}
                    </span>
                  </td>

                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <span className="text-slate-200 font-bold block">{u.sector}</span>
                    <span className="text-[10px] text-slate-400 block">{u.region}</span>
                  </td>

                  <td className="py-3.5 px-4 text-right font-mono font-extrabold text-white whitespace-nowrap">
                    {u.spotPrice} {u.currency || 'EUR'}
                  </td>

                  <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-400 whitespace-nowrap">
                    {(u.impliedVol3m * 100).toFixed(1)} %
                  </td>

                  <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-400 whitespace-nowrap">
                    {(u.dividendYield * 100).toFixed(1)} %
                  </td>

                  <td className="py-3.5 px-4 text-center whitespace-nowrap">
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                      u.volatilityScore === 'EXCELLENT_FOR_AUTOCALL'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : u.volatilityScore === 'HIGH'
                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}>
                      {u.volatilityScore === 'EXCELLENT_FOR_AUTOCALL' ? 'EXCELLENT AUTOCALL' : u.volatilityScore}
                    </span>
                  </td>

                  <td className="py-3.5 px-4 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center space-x-1.5">
                      {onSelectStockForPricing && (
                        <button
                          onClick={() => onSelectStockForPricing(u)}
                          className="px-2 py-1.5 rounded-lg bg-indigo-950 hover:bg-indigo-900 text-cyan-300 border border-indigo-700/80 font-bold text-xs transition-all flex items-center gap-1 shadow-xs"
                          title="Pricer un produit structuré sur ce sous-jacent"
                        >
                          <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Pricer</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleOpenEditModal(u)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-all"
                        title="Éditer le sous-jacent"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-indigo-300" />
                      </button>
                      <button
                        onClick={() => handleDelete(u.ticker)}
                        className="p-1.5 rounded-lg bg-red-950/80 hover:bg-red-900/90 text-red-300 border border-red-800/60 transition-all"
                        title="Supprimer de la base"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filteredUnderlyings.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400 text-xs">
                    Aucun sous-jacent trouvé dans la base pour ces critères.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Underlying Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl shadow-slate-950 text-slate-100 space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Database className="w-5 h-5 text-indigo-400" />
                <h2 className="text-base font-extrabold text-white">
                  {editingTicker ? `Modifier le Sous-Jacent : ${editingTicker}` : 'Ajouter un Nouveau Sous-Jacent'}
                </h2>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Ticker Bloomberg * :</label>
                  <input
                    type="text"
                    required
                    value={formData.ticker || ''}
                    onChange={(e) => setFormData({ ...formData, ticker: e.target.value })}
                    placeholder="ex: FP FP, MC FP, NVDA US"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-mono text-cyan-300 font-bold focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Code ISIN :</label>
                  <input
                    type="text"
                    value={formData.isin || ''}
                    onChange={(e) => setFormData({ ...formData, isin: e.target.value })}
                    placeholder="ex: FR0000120271"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Nom Complet de la Société * :</label>
                <input
                  type="text"
                  required
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="ex: TotalEnergies SE"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-bold text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Secteur d'Activité :</label>
                  <input
                    type="text"
                    value={formData.sector || ''}
                    onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                    placeholder="ex: Énergie, Consommation / Luxe, Santé"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Région / Indice :</label>
                  <input
                    type="text"
                    value={formData.region || ''}
                    onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                    placeholder="ex: Europe (France - CAC40)"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Prix Spot :</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.spotPrice ?? 100}
                    onChange={(e) => setFormData({ ...formData, spotPrice: parseFloat(e.target.value) })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Devise :</label>
                  <select
                    value={formData.currency || 'EUR'}
                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-mono text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                    <option value="CHF">CHF</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Volatilité 3M (%) :</label>
                  <input
                    type="number"
                    step="0.1"
                    value={((formData.impliedVol3m || 0.25) * 100).toFixed(1)}
                    onChange={(e) => setFormData({ ...formData, impliedVol3m: (parseFloat(e.target.value) || 25) / 100 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-mono text-amber-300 font-bold focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Rendement Dividende (%) :</label>
                  <input
                    type="number"
                    step="0.1"
                    value={((formData.dividendYield || 0.02) * 100).toFixed(1)}
                    onChange={(e) => setFormData({ ...formData, dividendYield: (parseFloat(e.target.value) || 2) / 100 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-mono text-emerald-400 font-bold focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-semibold mb-1">Score Volatilité Autocall :</label>
                  <select
                    value={formData.volatilityScore || 'MEDIUM'}
                    onChange={(e) => setFormData({ ...formData, volatilityScore: e.target.value as any })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-bold text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="EXCELLENT_FOR_AUTOCALL">EXCELLENT_FOR_AUTOCALL (Optimal pour coupon)</option>
                    <option value="HIGH">HIGH (Élevée)</option>
                    <option value="MEDIUM">MEDIUM (Moyenne)</option>
                    <option value="LOW">LOW (Faible / Défensif)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1">Raisonnement / Recommandation RAG :</label>
                <textarea
                  rows={3}
                  value={formData.reasoningForRecommendation || ''}
                  onChange={(e) => setFormData({ ...formData, reasoningForRecommendation: e.target.value })}
                  placeholder="Explication synthétique pour la recommandation du sous-jacent..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md shadow-indigo-600/30"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl shadow-slate-950 text-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Upload className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-extrabold text-white">Importation de Sous-Jacents par Lot (CSV)</h2>
              </div>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Sélectionnez un fichier CSV contenant la liste des sous-jacents (colonnes : Ticker, ISIN, Nom, Secteur, Région, SpotPrice, Devise, ImpliedVol, DividendYield).
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Fichier CSV :</label>
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2 text-xs text-slate-300 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Aperçu / Éditeur CSV :</label>
              <textarea
                rows={6}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="Paste CSV rows here... Ticker,ISIN,Name,Sector,Region,SpotPrice,Currency,ImpliedVol,DividendYield"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-[11px] text-cyan-300 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {importMessage && (
              <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${importMessage.success ? 'bg-emerald-950 border border-emerald-800 text-emerald-300' : 'bg-red-950 border border-red-800 text-red-300'}`}>
                {importMessage.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span>{importMessage.text}</span>
              </div>
            )}

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
              >
                Annuler
              </button>
              <button
                onClick={handleRunImportCsv}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-600/30"
              >
                Lancer l'Importation CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
