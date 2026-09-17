import { describe, expect, it } from 'vitest';
import { parseFlexibleDate, monthsBetween, toIsoDateString } from './date-utils';

describe('parseFlexibleDate', () => {
  it('parses an ISO date (YYYY-MM-DD)', () => {
    const date = parseFlexibleDate('2026-12-01');
    expect(date).not.toBeNull();
    expect(toIsoDateString(date!)).toBe('2026-12-01');
  });

  it('parses a French date (DD/MM/YYYY)', () => {
    const date = parseFlexibleDate('01/12/2026');
    expect(date).not.toBeNull();
    expect(toIsoDateString(date!)).toBe('2026-12-01');
  });

  it('parses a French date with dash separators (DD-MM-YYYY)', () => {
    const date = parseFlexibleDate('01-12-2026');
    expect(date).not.toBeNull();
    expect(toIsoDateString(date!)).toBe('2026-12-01');
  });

  it('parses single-digit day/month French dates (D/M/YYYY)', () => {
    const date = parseFlexibleDate('1/3/2026');
    expect(date).not.toBeNull();
    expect(toIsoDateString(date!)).toBe('2026-03-01');
  });

  it('rejects a calendar date that does not exist (31 février)', () => {
    expect(parseFlexibleDate('31/02/2026')).toBeNull();
  });

  it('rejects an out-of-range month or day', () => {
    expect(parseFlexibleDate('01/13/2026')).toBeNull();
    expect(parseFlexibleDate('32/01/2026')).toBeNull();
  });

  it('returns null for garbage / non-date text', () => {
    expect(parseFlexibleDate('trois mois')).toBeNull();
    expect(parseFlexibleDate('not a date')).toBeNull();
  });

  it('returns null for empty or non-string input', () => {
    expect(parseFlexibleDate('')).toBeNull();
    expect(parseFlexibleDate(null as any)).toBeNull();
    expect(parseFlexibleDate(undefined as any)).toBeNull();
  });
});

describe('monthsBetween', () => {
  it('returns 0 for the same date', () => {
    const d = new Date('2026-06-01T00:00:00.000Z');
    expect(monthsBetween(d, d)).toBe(0);
  });

  it('computes ~6 months between 2026-06-01 and 2026-12-01', () => {
    const from = new Date('2026-06-01T00:00:00.000Z');
    const to = new Date('2026-12-01T00:00:00.000Z');
    expect(monthsBetween(from, to)).toBe(6);
  });

  it('computes ~12 months across a full year', () => {
    const from = new Date('2026-01-15T00:00:00.000Z');
    const to = new Date('2027-01-15T00:00:00.000Z');
    expect(monthsBetween(from, to)).toBe(12);
  });

  it('clamps to 0 when the target date is before the reference date', () => {
    const from = new Date('2026-12-01T00:00:00.000Z');
    const to = new Date('2026-06-01T00:00:00.000Z');
    expect(monthsBetween(from, to)).toBe(0);
  });
});
