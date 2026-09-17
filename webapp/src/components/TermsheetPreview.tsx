import React, { useState, useEffect } from 'react';
import { ExtractedProductSpec, PricingResult } from '../types/structured-product';
import {
  DEFAULT_TERMSHEET_TEMPLATES,
  renderTermsheetTemplate,
  TermsheetTemplate
} from '../services/termsheet-template';
import appConfig from '../assets/app-config.json';
import { FileText, Copy, Check, Printer, Edit3, Settings, Eye, RefreshCw, Layout, Sparkles } from 'lucide-react';

interface TermsheetPreviewProps {
  spec?: ExtractedProductSpec | null;
  pricing?: PricingResult | null;
}

function parseMathToNodes(mathString: string): React.ReactNode {
  let clean = mathString
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\mathrm\{([^}]+)\}/g, '$1')
    .replace(/\\geq?/g, '≥')
    .replace(/\\leq?/g, '≤')
    .replace(/\\times/g, '×')
    .replace(/\\pm/g, '±')
    .replace(/\\infty/g, '∞')
    .replace(/\\to|\\rightarrow/g, '→')
    .replace(/\\Delta/g, 'Δ')
    .replace(/\\sigma/g, 'σ');

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const subSupRegex = /_\{([^}]+)\}|_([a-zA-Z0-9]+)|\^\{([^}]+)\}|\^([a-zA-Z0-9]+)/g;
  let match;

  while ((match = subSupRegex.exec(clean)) !== null) {
    if (match.index > lastIndex) {
      parts.push(clean.slice(lastIndex, match.index));
    }
    const subVal = match[1] || match[2];
    const supVal = match[3] || match[4];

    if (subVal !== undefined) {
      parts.push(
        <sub key={`sub-${match.index}`} className="text-[10px] font-sans not-italic font-extrabold text-indigo-800 ml-0.5">
          {subVal}
        </sub>
      );
    }
    if (supVal !== undefined) {
      parts.push(
        <sup key={`sup-${match.index}`} className="text-[10px] font-sans not-italic font-extrabold text-indigo-800 ml-0.5">
          {supVal}
        </sup>
      );
    }
    lastIndex = subSupRegex.lastIndex;
  }

  if (lastIndex < clean.length) {
    parts.push(clean.slice(lastIndex));
  }

  return (
    <span className="font-serif italic font-semibold text-indigo-950 bg-indigo-50/90 px-1.5 py-0.5 rounded border border-indigo-200/80 mx-0.5 inline-flex items-baseline shadow-2xs">
      {parts}
    </span>
  );
}

function renderFormattedText(text: string): React.ReactNode {
  if (!text) return null;

  // Split by $$...$$ or \[...\], $...$ or \(...\), `...`, **...**
  const regex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+?\$|\\\([\s\S]*?\\\)|`.*?`|\*\*[\s\S]*?\*\*)/g;
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    if (!part) return null;

    // 1. Display Math $$...$$ or \[...\]
    if (
      (part.startsWith('$$') && part.endsWith('$$') && part.length >= 4) ||
      (part.startsWith('\\[') && part.endsWith('\\]') && part.length >= 4)
    ) {
      const mathContent = part.slice(2, -2).trim();
      return (
        <div key={`dmath-${idx}`} className="my-3 p-3 bg-slate-900 text-cyan-300 rounded-xl border border-slate-800 text-center font-mono text-sm overflow-x-auto shadow-inner">
          {parseMathToNodes(mathContent)}
        </div>
      );
    }

    // 2. Inline Math $...$ or \(...\)
    if (
      (part.startsWith('$') && part.endsWith('$') && part.length >= 2) ||
      (part.startsWith('\\(') && part.endsWith('\\)') && part.length >= 4)
    ) {
      const mathContent = (part.startsWith('\\(') ? part.slice(2, -2) : part.slice(1, -1)).trim();
      return <React.Fragment key={`imath-${idx}`}>{parseMathToNodes(mathContent)}</React.Fragment>;
    }

    // 3. Bold **...** -> RECURSIVELY parse content so math inside bold tags (e.g. **Initial ($S_0$)**) is rendered
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={`bold-${idx}`} className="font-extrabold text-slate-900">
          {renderFormattedText(part.slice(2, -2))}
        </strong>
      );
    }

    // 4. Inline Code `...`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code key={`code-${idx}`} className="font-mono text-xs text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
          {part.slice(1, -1)}
        </code>
      );
    }

    return part;
  });
}

function parseMarkdownToReact(markdown: string): React.ReactNode[] {
  const lines = markdown.split('\n');
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableHeader: string[] = [];
  let tableRows: string[][] = [];
  let keyCounter = 0;

  const flushTable = () => {
    if (inTable && tableHeader.length > 0) {
      elements.push(
        <div key={`table-${keyCounter++}`} className="overflow-x-auto my-5 border border-slate-200 rounded-xl shadow-xs">
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[11px]">
                {tableHeader.map((h, i) => (
                  <th key={i} className="py-3 px-4">{renderFormattedText(h.trim())}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {tableRows.map((row, rIdx) => (
                <tr key={rIdx} className={rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="py-2.5 px-4 font-medium">{renderFormattedText(cell.trim())}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      inTable = false;
      tableHeader = [];
      tableRows = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if line is a table line
    if (line.startsWith('|') && line.endsWith('|')) {
      const cells = line.split('|').slice(1, -1);
      // Check if it's separator line like | --- | --- |
      if (cells.every(c => c.trim().match(/^:?-+:?$/))) {
        continue;
      }
      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      flushTable();
    }

    if (!line) {
      continue;
    }

    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${keyCounter++}`} className="text-xl sm:text-2xl font-black text-indigo-950 border-b-2 border-indigo-600 pb-3 mt-2 mb-4 tracking-tight uppercase">
          {renderFormattedText(line.slice(2))}
        </h1>
      );
    } else if (line.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${keyCounter++}`} className="text-lg sm:text-xl font-extrabold text-slate-900 mt-6 mb-3">
          {renderFormattedText(line.slice(3))}
        </h2>
      );
    } else if (line.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${keyCounter++}`} className="text-sm sm:text-base font-extrabold text-indigo-900 mt-5 mb-2.5 flex items-center gap-2 border-l-4 border-indigo-600 pl-3 py-0.5 bg-indigo-50/50 rounded-r-lg">
          {renderFormattedText(line.slice(4))}
        </h3>
      );
    } else if (line === '---' || line === '***') {
      elements.push(
        <hr key={`hr-${keyCounter++}`} className="my-6 border-t border-slate-200" />
      );
    } else if (line.startsWith('- ')) {
      elements.push(
        <div key={`li-${keyCounter++}`} className="flex items-start gap-2.5 my-1.5 text-slate-800 leading-relaxed text-xs sm:text-sm pl-2">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 mt-2 shrink-0"></span>
          <span>{renderFormattedText(line.slice(2))}</span>
        </div>
      );
    } else {
      elements.push(
        <p key={`p-${keyCounter++}`} className="my-2 text-slate-800 leading-relaxed text-xs sm:text-sm">
          {renderFormattedText(line)}
        </p>
      );
    }
  }

  flushTable();
  return elements;
}

export const TermsheetPreview: React.FC<TermsheetPreviewProps> = ({ spec, pricing }) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [selectedTemplate, setSelectedTemplate] = useState<TermsheetTemplate>(DEFAULT_TERMSHEET_TEMPLATES[0]);
  const [customIssuer, setCustomIssuer] = useState<string>('Natixis Structured Issuance SA (Garant : Natixis SA)');
  const [customDisclaimer, setCustomDisclaimer] = useState<string>('');
  const [templateContent, setTemplateContent] = useState<string>(DEFAULT_TERMSHEET_TEMPLATES[0].content);
  const [activeViewMode, setActiveViewMode] = useState<'RENDERED' | 'EDIT_TEMPLATE'>('RENDERED');

  // Auto-select template based on payoff mapping in app-config.json
  useEffect(() => {
    if (!spec) return;
    const payoffId = spec.productTypeId;
    const mapping = (appConfig.termsheetTemplatesByPayoff as Record<string, string>) || {};
    const mappedTemplateId = mapping[payoffId] || appConfig.defaultTermsheetTemplateId || DEFAULT_TERMSHEET_TEMPLATES[0].id;

    const found = DEFAULT_TERMSHEET_TEMPLATES.find((t) => t.id === mappedTemplateId) || DEFAULT_TERMSHEET_TEMPLATES[0];
    setSelectedTemplate(found);
    setTemplateContent(found.content);
    if (found.id === 'natixis_cib_standard') {
      setCustomIssuer('Natixis Structured Issuance SA (Garant : Natixis SA)');
    } else if (found.id === 'sg_cib_phoenix') {
      setCustomIssuer('SG Issuer (Garantie Société Générale)');
    } else if (found.id === 'bnp_cib_standard') {
      setCustomIssuer('BNP Paribas Arbitrage Issuance B.V.');
    } else {
      setCustomIssuer('Émetteur A+ Européen');
    }
  }, [spec?.productTypeId]);

  if (!spec || !pricing || !spec.commonParams?.underlyings?.length) {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3 shadow-xl backdrop-blur-md max-w-4xl mx-auto my-12">
        <div className="w-12 h-12 rounded-2xl bg-indigo-950/80 border border-indigo-700/60 flex items-center justify-center text-indigo-400 mx-auto shadow-md">
          <FileText className="w-6 h-6 animate-pulse text-cyan-400" />
        </div>
        <h3 className="text-base font-extrabold text-white">Aucune Termsheet Générée</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
          Veuillez effectuer une extraction de produit dans le Workbench NLP pour afficher et personnaliser la Termsheet institutionnelle.
        </p>
      </div>
    );
  }

  const common = spec.commonParams;
  const specific = spec.specificParams || {};

  const handleSelectTemplate = (tplId: string) => {
    const found = DEFAULT_TERMSHEET_TEMPLATES.find((t) => t.id === tplId);
    if (found) {
      setSelectedTemplate(found);
      setTemplateContent(found.content);
      if (found.id === 'natixis_cib_standard') {
        setCustomIssuer('Natixis Structured Issuance SA (Garant : Natixis SA)');
      } else if (found.id === 'sg_cib_phoenix') {
        setCustomIssuer('SG Issuer (Garantie Société Générale)');
      } else if (found.id === 'bnp_cib_standard') {
        setCustomIssuer('BNP Paribas Arbitrage Issuance B.V.');
      } else {
        setCustomIssuer('Émetteur A+ Européen');
      }
    }
  };

  const handleCopyText = () => {
    const rendered = renderTermsheetTemplate(templateContent, spec, pricing, customIssuer, customDisclaimer);
    navigator.clipboard.writeText(rendered);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  const renderedMarkdown = renderTermsheetTemplate(templateContent, spec, pricing, customIssuer, customDisclaimer);

  return (
    <div className="space-y-8 pb-12">
      {/* Top Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-xl shadow-slate-950/40 backdrop-blur-md text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 text-xs font-bold uppercase tracking-widest mb-2">
            <FileText className="w-3.5 h-3.5 text-cyan-400" />
            <span>Moteur de Génération de Termsheet à Modèles</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white">
            Termsheet &amp; Personnalisation de Modèle (Template Engine)
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Choix du template institutionnel, surcharge des clauses légales, et édition dynamique des balises Markdown.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleCopyText}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition-all flex items-center gap-2"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
            <span>{copied ? 'Termsheet Copié !' : 'Copier Termsheet'}</span>
          </button>

          <button
            onClick={handlePrint}
            className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-bold transition-all flex items-center gap-2 shadow-md shadow-indigo-600/30"
          >
            <Printer className="w-4 h-4 text-white" />
            <span>Imprimer / PDF</span>
          </button>
        </div>
      </div>

      {/* Template Toolbar & Config Panel */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-lg shadow-slate-950/40 backdrop-blur-md space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <Layout className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-300">Sélection du Modèle :</span>
            <select
              value={selectedTemplate.id}
              onChange={(e) => handleSelectTemplate(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl py-1.5 px-3 text-xs font-bold text-white focus:outline-none focus:border-indigo-500"
            >
              {DEFAULT_TERMSHEET_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveViewMode('RENDERED')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeViewMode === 'RENDERED'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Aperçu Rendu</span>
            </button>
            <button
              onClick={() => setActiveViewMode('EDIT_TEMPLATE')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeViewMode === 'EDIT_TEMPLATE'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Éditer le Code Template</span>
            </button>
          </div>
        </div>

        {/* Quick Customization Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-bold text-slate-300 mb-1">Nom de l'Émetteur / Garant :</label>
            <input
              type="text"
              value={customIssuer}
              onChange={(e) => setCustomIssuer(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 font-mono text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block font-bold text-slate-300 mb-1">Clause de Disclaimer Spécifique :</label>
            <input
              type="text"
              value={customDisclaimer}
              onChange={(e) => setCustomDisclaimer(e.target.value)}
              placeholder="Avertissement légal spécifique ou restriction de distribution..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      </div>

      {/* Main Content Area: Rendered View or Template Editor */}
      {activeViewMode === 'EDIT_TEMPLATE' ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl shadow-slate-950/40 backdrop-blur-md space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Éditeur de Modèle Markdown (Variables : &#123;&#123;SOLVED_COUPON&#125;&#125;, &#123;&#123;UNDERLYING_NAME&#125;&#125;, &#123;&#123;PDI_BARRIER&#125;&#125;)
            </span>
            <button
              onClick={() => setTemplateContent(selectedTemplate.content)}
              className="text-xs font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Réinitialiser au Modèle d'origine</span>
            </button>
          </div>
          <textarea
            value={templateContent}
            onChange={(e) => setTemplateContent(e.target.value)}
            rows={18}
            className="w-full font-mono text-xs p-4 bg-slate-950 text-emerald-300 rounded-xl border border-slate-800 focus:outline-none focus:border-indigo-500 leading-relaxed shadow-inner"
          />
        </div>
      ) : (
        <div className="bg-slate-950 p-4 sm:p-8 rounded-2xl border border-slate-800 shadow-2xl max-w-4xl mx-auto">
          <div className="bg-white text-slate-900 rounded-2xl p-6 sm:p-12 shadow-2xl border border-slate-200">
            {/* Formatted Termsheet Display without raw Markdown characters */}
            <div className="space-y-2">
              {parseMarkdownToReact(renderedMarkdown)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


