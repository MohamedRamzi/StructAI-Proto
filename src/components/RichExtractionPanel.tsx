import React from 'react';
import { AlertTriangle, Info, Layers3 } from 'lucide-react';
import { QuoteBundle } from '../services/llm-parser';

/**
 * Renders a quote that inference-service's routed pipeline parsed into a rich
 * per-family schema (rates/v1, fx/v1, credit/v1, ...) for which the app has no
 * local pricer yet: the extracted structure + routing, with a clear "pricing
 * indisponible" banner instead of the Monte Carlo grid.
 */
export const RichExtractionPanel: React.FC<{ quote: QuoteBundle }> = ({ quote }) => {
  const routing = quote.routing;
  const missing = quote.missingFields || [];

  return (
    <div key="rich-extraction-panel" className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-slate-900/90 border border-amber-500/40 rounded-2xl p-5 shadow-xl shadow-slate-950/40 backdrop-blur-md space-y-4">
        <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
          <Layers3 className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-bold text-white">{quote.label}</h3>
          <span className="ml-auto px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800 font-mono">
            {quote.schemaVersion || 'schéma riche'}
          </span>
        </div>

        <div className="flex items-start gap-2.5 bg-amber-950/40 border border-amber-800/60 rounded-xl p-3.5 text-xs text-amber-100 leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>{quote.degradationReason || 'Pricing indisponible pour cette famille de produit — la structure est extraite mais aucun moteur de valorisation local ne la couvre.'}</span>
        </div>

        {routing && (
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Chip label="Classe" value={routing.assetClass || '—'} />
            <Chip label="Famille" value={routing.productFamily || '—'} />
            <Chip label="Pré-prompt" value={routing.promptKey} mono />
            <Chip label="Précision scope" value={String(routing.scopePrecision)} />
            {routing.routerConfidence != null && <Chip label="Confiance routeur" value={routing.routerConfidence.toFixed(2)} />}
          </div>
        )}

        {missing.length > 0 && (
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              <Info className="w-3.5 h-3.5 text-cyan-400" />
              Champs à préciser
            </div>
            <ul className="text-xs text-slate-300 space-y-1">
              {missing.map((m) => (
                <li key={m.field}>
                  <span className="font-mono text-cyan-300">{m.label || m.field}</span> — {m.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md">
        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3">Structure extraite</div>
        <div className="overflow-x-auto">
          <JsonTree value={quote.richExtraction ?? {}} />
        </div>
      </div>
    </div>
  );
};

const Chip: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/70 border border-slate-800">
    <span className="text-slate-500">{label}</span>
    <span className={`font-bold text-slate-200 ${mono ? 'font-mono' : ''}`}>{value}</span>
  </span>
);

/** Minimal recursive JSON renderer — no external dep, read-only. */
const JsonTree: React.FC<{ value: any; depth?: number }> = ({ value, depth = 0 }) => {
  if (value === null || value === undefined) return <span className="text-slate-500">null</span>;
  if (typeof value !== 'object') {
    const color = typeof value === 'number' ? 'text-cyan-300' : typeof value === 'boolean' ? 'text-amber-300' : 'text-emerald-300';
    return <span className={`font-mono ${color}`}>{typeof value === 'string' ? `"${value}"` : String(value)}</span>;
  }

  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  if (entries.length === 0) return <span className="text-slate-500 font-mono">{Array.isArray(value) ? '[]' : '{}'}</span>;

  return (
    <ul className={`space-y-0.5 ${depth > 0 ? 'ml-4 border-l border-slate-800 pl-3' : ''}`}>
      {entries.map(([k, v]) => (
        <li key={k} className="text-xs leading-relaxed">
          <span className="font-mono text-slate-400">{k}</span>
          <span className="text-slate-600">: </span>
          <JsonTree value={v} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
};
