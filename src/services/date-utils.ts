/**
 * Small date-parsing helpers used to resolve an ABSOLUTE forward-start /
 * first-fixing date (e.g. "première fixation le 01/12/2026") into the
 * `forwardStartMonths` count the quant engine actually prices with. Kept
 * deterministic and separate from the LLM: date arithmetic from "today" is
 * more reliable done here than asked of a model.
 */

/**
 * Parses a date string in either ISO (YYYY-MM-DD) or French (DD/MM/YYYY or
 * DD-MM-YYYY) format. Returns null if the string is empty, malformed, or
 * encodes a calendar date that doesn't exist (e.g. 31/02/2026).
 */
export function parseFlexibleDate(input: string): Date | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return buildUtcDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const frenchMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (frenchMatch) {
    return buildUtcDate(Number(frenchMatch[3]), Number(frenchMatch[2]), Number(frenchMatch[1]));
  }

  return null;
}

function buildUtcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  // JS Date normalizes overflowing days (e.g. 31/02 -> 03/03) instead of throwing;
  // reject those instead of silently accepting a shifted date.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

/**
 * Whole number of months between two dates, using an average month length
 * (365.2425 / 12 days) — consistent with the quant engine treating
 * "months" as a fixed fraction of a year (see forwardStartMonths / 12 in
 * quant-pricer.ts) rather than calendar-exact months. Clamped to 0 when
 * `to` is not after `from` (a forward start can't be negative).
 */
export function monthsBetween(from: Date, to: Date): number {
  const AVG_DAYS_PER_MONTH = 365.2425 / 12;
  const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
  const months = Math.round(diffDays / AVG_DAYS_PER_MONTH);
  return Math.max(0, months);
}

/** Formats a Date (assumed UTC-midnight, as produced by parseFlexibleDate) as YYYY-MM-DD. */
export function toIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
