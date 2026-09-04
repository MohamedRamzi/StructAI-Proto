import React from 'react';
import { Cpu, FileText, Database, ShieldCheck, Sparkles, BookOpen, Activity, Zap } from 'lucide-react';
import { LlmStatusBadge } from './LlmStatusBadge';

interface HeaderProps {
  activeTab: 'workbench' | 'termsheet' | 'analytics' | 'underlyings';
  setActiveTab: (tab: 'workbench' | 'termsheet' | 'analytics' | 'underlyings') => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  return (
    <header className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-slate-100 shadow-lg shadow-slate-950/50">
      {/* Top Institutional Live Ticker Bar */}
      <div className="bg-slate-950/80 border-b border-slate-800/80 px-4 py-1 text-[11px] text-slate-400 font-mono flex items-center justify-between overflow-x-auto">
        <div className="flex items-center space-x-4 shrink-0">
          <div className="flex items-center space-x-1.5 text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-semibold text-slate-200">MONTE CARLO SIMULATOR:</span>
            <span>10 000 PATHS ACTIVE</span>
          </div>
          <span className="text-slate-700 hidden sm:inline">|</span>
          <div className="hidden sm:flex items-center space-x-1 text-cyan-400">
            <Zap className="w-3 h-3 text-cyan-400" />
            <span>Latence NLP: ~140ms</span>
          </div>
        </div>
        <div className="flex items-center space-x-3 shrink-0 text-slate-400">
          <span className="bg-indigo-950/60 border border-indigo-800/50 text-indigo-300 px-2 py-0.5 rounded text-[10px] font-bold">
            MIFID II COMPLIANT
          </span>
          <span className="hidden md:inline text-slate-500">Natixis CIB • SG CIB • BNP Paribas CIB</span>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Branding */}
          <div 
            className="flex items-center space-x-3.5 cursor-pointer group" 
            onClick={() => setActiveTab('workbench')}
          >
            <div className="relative">
              <div className="w-9 h-9 bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 rounded-xl flex items-center justify-center shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform duration-200">
                <div className="w-4 h-4 border-2 border-white rotate-45 rounded-sm"></div>
              </div>
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl font-extrabold tracking-tight text-white group-hover:text-indigo-200 transition-colors">
                  STRUCT<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">AI</span>
                </span>
                <span className="px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-cyan-300 bg-cyan-950/80 border border-cyan-800/60 rounded-full font-mono shadow-xs">
                  100+ DERIVATIVES
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block font-medium">
                Valorisation &amp; Structuration IA de Produits Dérivés
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1 sm:space-x-1.5 bg-slate-950/60 p-1.5 rounded-xl border border-slate-800/80">
            <button
              id="nav-workbench-btn"
              onClick={() => setActiveTab('workbench')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                activeTab === 'workbench'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Workbench</span>
            </button>

            <button
              id="nav-termsheet-btn"
              onClick={() => setActiveTab('termsheet')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                activeTab === 'termsheet'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Termsheet</span>
            </button>

            <button
              id="nav-underlyings-btn"
              onClick={() => setActiveTab('underlyings')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                activeTab === 'underlyings'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Gestion Sous-Jacents</span>
              <span className="md:hidden font-mono">Base DB</span>
            </button>

            <button
              id="nav-analytics-btn"
              onClick={() => setActiveTab('analytics')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                activeTab === 'analytics'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Analytics &amp; Historique</span>
              <span className="md:hidden">Dashboard</span>
            </button>
          </nav>

          {/* Read-only LLM engine status (configured centrally in quotation-service's admin UI) */}
          <div className="flex items-center">
            <LlmStatusBadge />
          </div>
        </div>
      </div>
    </header>
  );
};

