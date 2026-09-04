import fs from 'fs';
import path from 'path';

/**
 * Canonical system prompt for LLM-based extraction of structured product
 * specifications from natural language client requests, loaded from
 * QuotationPrompt.md (this service's root) — a single, human-editable
 * Markdown file so the extraction rules can be tuned without touching
 * TypeScript.
 *
 * Resolved relative to process.cwd() so it works identically whether the
 * service is launched via `tsx src/server.ts` (dev) from this directory, or
 * via `npm --prefix quotation-service run dev` from the repo root (npm still
 * sets cwd to this package's directory for the script it runs).
 */
const PROMPT_FILE_PATH = path.join(process.cwd(), 'QuotationPrompt.md');

export function loadQuotationPromptFromDisk(): string {
  return fs.readFileSync(PROMPT_FILE_PATH, 'utf-8').trim();
}

export const FINANCIAL_PARSER_SYSTEM_PROMPT = loadQuotationPromptFromDisk();
