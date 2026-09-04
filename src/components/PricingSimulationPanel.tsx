import React from 'react';
import { PricingResult, ExtractedProductSpec } from '../types/structured-product';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  AreaChart,
  Area,
} from 'recharts';
import { TrendingUp, Activity, BarChart3, ShieldAlert, Cpu, Sparkles, Layers, Sliders } from 'lucide-react';

interface PricingSimulationPanelProps {
  spec?: ExtractedProductSpec | null;
  pricing?: PricingResult | null;
  isRecalculating: boolean;
}

export const PricingSimulationPanel: React.FC<PricingSimulationPanelProps> = ({
  spec,
  pricing,
  isRecalculating,
}) => {
  const stock = spec?.commonParams?.underlyings?.[0];
  const defaultDividend = (stock?.dividendYield || 0.025) * 100;

  // Interactive sensitivity controls for Monte Carlo trajectories (Must be called unconditionally at top level)
  const [driftPct, setDriftPct] = React.useState<number>(3.5); // Default risk-free rate 3.5%
  const [dividendPct, setDividendPct] = React.useState<number>(Number(defaultDividend.toFixed(1)));

  // Reset controls when selected underlying stock changes
  React.useEffect(() => {
    if (stock) {
      const newDiv = (stock.dividendYield || 0.025) * 100;
      setDividendPct(Number(newDiv.toFixed(1)));
      setDriftPct(3.5);
    }
  }, [stock?.ticker]);

  // Construct unified, full-width dataset for Recharts XAxis [0 to maturityMonths]
  const chartData = React.useMemo(() => {
    if (!spec || !pricing || !spec.commonParams?.underlyings?.length) return [];
    const timeMonths = pricing.monteCarloPaths?.timeMonths || [];
    const origPaths = pricing.monteCarloPaths?.paths || [];
    if (timeMonths.length === 0) return [];

    const sigma = stock?.impliedVol3m || 0.28;
    const origDrift = 0.035 - (stock?.dividendYield || 0.025) - 0.5 * sigma * sigma;
    const newDrift = (driftPct / 100) - (dividendPct / 100) - 0.5 * sigma * sigma;
    const driftDiff = newDrift - origDrift;

    return timeMonths.map((mVal, stepIdx) => {
      const roundedMonth = Number(mVal.toFixed(1));
      const row: Record<string, any> = { month: roundedMonth };
      const tYears = roundedMonth / 12;

      origPaths.forEach((path, pIdx) => {
        const baseVal = path[stepIdx] ?? 100;
        const adjustedVal = Math.round(baseVal * Math.exp(driftDiff * tYears) * 10) / 10;
        row[`path${pIdx}`] = adjustedVal;
      });

      return row;
    });
  }, [pricing?.monteCarloPaths, driftPct, dividendPct, stock, spec]);

  if (!spec || !pricing || !spec.commonParams?.underlyings?.length) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-10 text-center text-slate-400 space-y-3 shadow-xl backdrop-blur-md">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950/80 border border-indigo-700/60 flex items-center justify-center text-indigo-400 mx-auto shadow-md">
          <BarChart3 className="w-6 h-6 animate-pulse text-cyan-400" />
        </div>
        <h3 className="text-base font-extrabold text-white">Prêt pour la Simulation Quant &amp; Pricing</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
          Saisissez votre demande client en langage naturel ci-dessus ou sélectionnez un exemple prédéfini pour afficher la valorisation, le coupon résolu et les simulations Monte Carlo.
        </p>
      </div>
    );
  }

  const common = spec.commonParams;
  const specific = spec.specificParams || {};
  const autocallBarrier = specific.autocallBarrierPct ?? 100;
  const pdiBarrier = specific.pdiBarrierPct ?? 70;
  const maturityMonths = common.maturityMonths || 36;

  return (
    <div className="space-y-6">
      {/* Top Glass Card with Solved Target Result */}
      <div className="rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-xl shadow-slate-950/50 backdrop-blur-md relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-1.5">
              <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
              <span>Résultat de Valorisation IA &amp; Pricing Quant</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {spec.productTypeName}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Sous-jacent :{' '}
              <span className="font-bold text-slate-200">
                {common.underlyings[0]?.name} ({common.underlyings[0]?.ticker})
              </span>{' '}
              — Spot <span className="font-mono text-cyan-300 font-semibold">{common.underlyings[0]?.spotPrice} {common.underlyings[0]?.currency}</span> (Vol 3m:{' '}
              <span className="font-mono text-indigo-300 font-semibold">{(common.underlyings[0]?.impliedVol3m * 100).toFixed(1)}%</span>)
            </p>
          </div>

          {/* Solved Coupon / Variable Badge */}
          <div className="bg-gradient-to-br from-indigo-950/80 to-slate-900 border border-indigo-500/40 rounded-2xl p-5 shadow-lg shadow-indigo-950/50 flex flex-col items-start lg:items-end min-w-[240px]">
            <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
              {spec.targetToSolve === 'COUPON_RATE' ? 'Coupon à Servir (p.a.)' : 'Variable Résolue'}
            </span>
            <div className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-indigo-300 to-white mt-1 font-mono flex items-center gap-2">
              {isRecalculating ? (
                <span className="text-slate-400 text-lg animate-pulse">Calcul Monte Carlo...</span>
              ) : (
                pricing.solvedTarget.formattedValue
              )}
            </div>
            <span className="text-[11px] text-indigo-200 mt-1 font-medium bg-indigo-900/40 px-2 py-0.5 rounded border border-indigo-700/50">
              Valeur théorique note : {pricing.theoreticalValuePct.toFixed(2)}% (Au Pair)
            </span>
          </div>
        </div>

        {/* Four Key Metrics Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800/80">
          <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/90 hover:border-slate-700 transition-colors">
            <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>Probabilité Rappel</span>
            </div>
            <div className="text-2xl font-bold text-white mt-1 font-mono">
              {pricing.autocallProbabilityPct}%
            </div>
            <span className="text-[11px] text-slate-400">Rappel anticipé estimé</span>
          </div>

          <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/90 hover:border-slate-700 transition-colors">
            <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span>Maturité Moyenne</span>
            </div>
            <div className="text-2xl font-bold text-white mt-1 font-mono">
              {pricing.expectedMaturityYears} ans
            </div>
            <span className="text-[11px] text-slate-400">
              Maturité max : {common.maturityMonths ? `${(common.maturityMonths / 12).toFixed(1).replace('.0', '')} ans` : 'À préciser (Unspecified)'}
            </span>
          </div>

          <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/90 hover:border-slate-700 transition-colors">
            <div className="flex items-center space-x-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span>Risque PDI</span>
            </div>
            <div className="text-2xl font-bold text-amber-400 mt-1 font-mono">
              {pricing.pdiBreachProbabilityPct}%
            </div>
            <span className="text-[11px] text-slate-400">Barrière {pdiBarrier}% à maturité</span>
          </div>

          <div className="bg-slate-950/60 rounded-xl p-4 border border-slate-800/90 hover:border-slate-700 transition-colors">
            <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">
              <BarChart3 className="w-4 h-4 text-indigo-400" />
              <span>Greeks (Vega / Delta)</span>
            </div>
            <div className="text-sm font-bold text-cyan-300 mt-2 font-mono">
              Δ {pricing.sensitivities.delta} | ν {pricing.sensitivities.vega}
            </div>
            <span className="text-[11px] text-slate-400">Sensibilité volatilité &amp; spot</span>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Payoff Diagram & Monte Carlo Simulation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Maturity Payoff Diagram */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-cyan-400" />
                Profil de Remboursement à Maturité (% du Capital)
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Remboursement final en fonction du niveau du sous-jacent (% du Spot initial)
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={pricing.payoffProfile} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="payoffGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="spotLevelPct"
                  stroke="#94a3b8"
                  unit="%"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  label={{ value: 'Spot Sous-jacent (% de S0)', position: 'insideBottom', offset: -5, fill: '#94a3b8', fontSize: 10 }}
                />
                <YAxis
                  stroke="#94a3b8"
                  unit="%"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  domain={[30, 140]}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc', fontSize: '12px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)' }}
                  formatter={(value: any) => [`${value}%`, 'Remboursement Total']}
                  labelFormatter={(label: any) => `Spot à ${label}% du niveau initial`}
                />
                <ReferenceLine x={autocallBarrier} stroke="#818cf8" strokeDasharray="3 3" label={{ value: `Rappel ${autocallBarrier}%`, fill: '#818cf8', fontSize: 10 }} />
                <ReferenceLine x={pdiBarrier} stroke="#f87171" strokeDasharray="3 3" label={{ value: `PDI ${pdiBarrier}%`, fill: '#f87171', fontSize: 10 }} />
                <Area
                  type="monotone"
                  dataKey="redemptionPct"
                  stroke="#818cf8"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#payoffGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400 mt-2 px-2">
            <span className="flex items-center gap-1.5 text-red-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-red-500"></span> Zone de Perte en Capital (&lt;{pdiBarrier}%)
            </span>
            <span className="flex items-center gap-1.5 text-indigo-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-indigo-500"></span> Protection 100% + Coupons (&ge;{pdiBarrier}%)
            </span>
          </div>
        </div>

        {/* Chart 2: Monte Carlo Path Trajectories with Interactive Drift & Dividend Sliders */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  Trajectoires Monte Carlo (Maturité : {maturityMonths} mois / {(maturityMonths / 12).toFixed(1)} ans)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Simulation sur toute la durée du produit ({autocallBarrier}% Rappel | {pdiBarrier}% PDI)
                </p>
              </div>

              <span className="px-2.5 py-1 rounded-lg bg-indigo-950 border border-indigo-800 text-[11px] font-mono font-bold text-cyan-300 self-start sm:self-auto">
                {maturityMonths} MOIS
              </span>
            </div>

            {/* Interactive Drift & Dividend Controls */}
            <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3.5 mb-4 space-y-3 text-xs">
              <div className="flex items-center justify-between font-bold text-slate-200">
                <span className="flex items-center gap-1.5 text-indigo-300">
                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                  Sensibilité Paramétrique Monte Carlo :
                </span>
                <button
                  onClick={() => {
                    setDriftPct(3.5);
                    setDividendPct(Number(defaultDividend.toFixed(1)));
                  }}
                  className="text-[10px] text-slate-400 hover:text-white underline font-normal"
                >
                  Réinitialiser
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                {/* Drift Slider */}
                <div>
                  <div className="flex justify-between items-center text-[11px] mb-1">
                    <span className="text-slate-400">Taux de Dérive μ (Drift) :</span>
                    <span className="font-mono font-bold text-cyan-300">
                      {driftPct > 0 ? '+' : ''}{driftPct.toFixed(1)}% p.a.
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-5.0"
                    max="15.0"
                    step="0.5"
                    value={driftPct}
                    onChange={(e) => setDriftPct(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                  />
                </div>

                {/* Dividend Yield Slider */}
                <div>
                  <div className="flex justify-between items-center text-[11px] mb-1">
                    <span className="text-slate-400">Rendement Dividende q :</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {dividendPct.toFixed(1)}% p.a.
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.0"
                    max="10.0"
                    step="0.1"
                    value={dividendPct}
                    onChange={(e) => setDividendPct(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Monte Carlo Line Chart with 100% Width & Aligned X-Axis Domain */}
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 15, right: 35, left: -5, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis
                    dataKey="month"
                    type="number"
                    domain={[0, maturityMonths]}
                    stroke="#94a3b8"
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    tickFormatter={(m) => {
                      if (m === 0) return 'M0 (Spot)';
                      if (m % 12 === 0) return `${m / 12}y (${m}m)`;
                      return `${m}m`;
                    }}
                    label={{ value: `Durée du Produit (0 à ${maturityMonths} Mois)`, position: 'insideBottom', offset: -15, fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    unit="%"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc', fontSize: '12px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)' }}
                    formatter={(value: any, name: any) => [`${value}%`, `Trajectoire ${String(name).replace('path', '#')}`]}
                    labelFormatter={(m: any) => `Mois ${m} (${(Number(m) / 12).toFixed(1)} ans)`}
                  />
                  <ReferenceLine y={autocallBarrier} stroke="#818cf8" strokeDasharray="4 4" label={{ value: `Rappel ${autocallBarrier}%`, fill: '#818cf8', fontSize: 10, position: 'right' }} />
                  <ReferenceLine y={pdiBarrier} stroke="#f87171" strokeDasharray="4 4" label={{ value: `PDI ${pdiBarrier}%`, fill: '#f87171', fontSize: 10, position: 'right' }} />
                  
                  {/* Render distinct trajectory paths */}
                  {pricing.monteCarloPaths.paths.map((_, idx) => {
                    const colors = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24', '#fb7185', '#c084fc', '#2dd4bf', '#a7f3d0'];
                    return (
                      <Line
                        key={idx}
                        type="monotone"
                        dataKey={`path${idx}`}
                        stroke={colors[idx % colors.length]}
                        strokeWidth={1.8}
                        dot={false}
                        isAnimationActive={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 mt-3 text-center bg-slate-950/60 py-1.5 rounded-lg border border-slate-800">
            Modèle Black-Scholes dynamique avec dérive <span className="font-mono text-cyan-300 font-bold">μ = {driftPct > 0 ? '+' : ''}{driftPct.toFixed(1)}%</span> et dividende <span className="font-mono text-emerald-400 font-bold">q = {dividendPct.toFixed(1)}%</span>.
          </p>
        </div>
      </div>

      {/* Valuation Engine Logs Panel */}
      <div className="bg-slate-950 rounded-2xl p-5 shadow-lg shadow-slate-950/60 font-mono text-xs border border-slate-800 space-y-2">
        <div className="flex justify-between items-center border-b border-slate-800 pb-2">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            VALUATION ENGINE LOGS
          </span>
          <span className="text-[10px] text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            PROCESSOR_ACTIVE
          </span>
        </div>
        <div className="space-y-1 pt-1 opacity-90 text-slate-300">
          <div>[{new Date().toLocaleTimeString('fr-FR')}] <span className="text-emerald-400 font-bold">SUCCESS:</span> Extracted structure ({spec.productTypeName}) via Gemini NLP.</div>
          <div>[{new Date().toLocaleTimeString('fr-FR')}] <span className="text-cyan-400 font-bold">INFO:</span> Underlying mapped to {common.underlyings[0]?.name} ({common.underlyings[0]?.ticker}). Spot: {common.underlyings[0]?.spotPrice} EUR.</div>
          <div>[{new Date().toLocaleTimeString('fr-FR')}] <span className="text-indigo-400 font-bold">INFO:</span> Monte Carlo Pricing running (1,500 path iterations, Forward Start={common.forwardStartMonths}m, Maturity={common.maturityMonths}m).</div>
          <div>[{new Date().toLocaleTimeString('fr-FR')}] <span className="text-emerald-400 font-bold">SOLVED:</span> Target Coupon = {pricing.solvedTarget.formattedValue} (Notes priced Au Pair @ 100.0%).</div>
        </div>
      </div>

      {/* Sensitivity Matrix Table (PDI Barrier vs Volatility vs Coupon) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
              <Sliders className="w-4 h-4 text-indigo-400" />
              Matrice de Sensibilité du Coupon (PDI Barrier vs Volatilité Implicite)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Impact direct de la baisse du PDI et de la hausse de volatilité du sous-jacent sur le coupon p.a.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-800/80 rounded-xl">
          <table className="w-full text-xs text-left text-slate-200">
            <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-widest text-[10px] font-bold border-b border-slate-800">
              <tr>
                <th className="px-4 py-3">Barrière PDI (% du Spot)</th>
                <th className="px-4 py-3">Volatilité Implicite 3m</th>
                <th className="px-4 py-3">Coupon Servit Résolu (p.a.)</th>
                <th className="px-4 py-3">Écart par rapport au pricing de base</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {pricing.sensitivityMatrix.map((item, index) => {
                const isCurrentSetting = item.pdiBarrier === pdiBarrier;
                return (
                  <tr
                    key={index}
                    className={`hover:bg-slate-800/40 transition-colors ${
                      isCurrentSetting ? 'bg-indigo-950/60 font-bold border-l-4 border-indigo-500 text-white' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-mono">
                      PDI {item.pdiBarrier}% {isCurrentSetting && <span className="text-cyan-400 text-[10px] ml-1 font-bold">(Actuel)</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">{item.volatility}% p.a.</td>
                    <td className="px-4 py-3 font-mono text-cyan-400 font-extrabold text-sm">
                      {item.solvedCoupon.toFixed(2)}% p.a.
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-0.5 rounded text-[11px] font-mono ${
                        item.solvedCoupon >= pricing.solvedTarget.solvedValueNumber
                          ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {(item.solvedCoupon - pricing.solvedTarget.solvedValueNumber) >= 0 ? '+' : ''}
                        {(item.solvedCoupon - pricing.solvedTarget.solvedValueNumber).toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

