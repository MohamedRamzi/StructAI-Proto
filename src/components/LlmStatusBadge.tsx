import React, { useEffect, useState } from 'react';
import { Cpu, ExternalLink } from 'lucide-react';

interface LlmStatus {
  provider: string;
  modelName: string;
  adminUrl: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  'inference-service': 'vLLM',
};

/**
 * Read-only "Moteur LLM: ..." indicator — replaces the old LlmEngineSelector
 * modal (which let every browser session pick its own LLM provider/model).
 * That configuration is now centralized and admin-managed in inference-service
 * (see inference-service/public/admin/); this badge just displays what's
 * currently active (fetched via GET /api/llm-status, proxied by server.ts)
 * and links out to the admin UI to change it.
 */
export const LlmStatusBadge: React.FC = () => {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/llm-status')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          setStatus({ provider: data.provider, modelName: data.modelName, adminUrl: data.adminUrl });
        } else {
          setUnavailable(true);
          if (data.adminUrl) setStatus({ provider: '', modelName: '', adminUrl: data.adminUrl });
        }
      })
      .catch(() => setUnavailable(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex items-center space-x-2 bg-slate-950/60 border border-slate-800/80 rounded-xl px-3 py-1.5">
      <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
      {unavailable ? (
        <span className="text-xs font-semibold text-rose-400">Service NLP indisponible</span>
      ) : status ? (
        <span className="text-xs font-semibold text-slate-200">
          {PROVIDER_LABELS[status.provider] || status.provider}
          {status.modelName ? <span className="text-slate-500 font-mono"> · {status.modelName}</span> : null}
        </span>
      ) : (
        <span className="text-xs font-semibold text-slate-500">Chargement…</span>
      )}
      {status?.adminUrl && (
        <a
          href={status.adminUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center space-x-1 text-[11px] font-bold text-indigo-300 hover:text-indigo-200 border-l border-slate-800 pl-2 ml-1"
        >
          <span>Administrer</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
};
