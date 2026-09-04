import { describe, expect, it } from 'vitest';
import { extractJsonFromText } from './llm-client.js';

describe('extractJsonFromText', () => {
  it('parses a raw JSON string directly', () => {
    expect(extractJsonFromText('{"a": 1}')).toEqual({ a: 1 });
  });

  it('strips <think>...</think> reasoning blocks before parsing (Qwen/DeepSeek style)', () => {
    const raw = '<think>Let me reason about this...</think>\n{"a": 1}';
    expect(extractJsonFromText(raw)).toEqual({ a: 1 });
  });

  it('extracts JSON from a ```json fenced code block', () => {
    const raw = 'Here is the result:\n```json\n{"a": 1}\n```\nDone.';
    expect(extractJsonFromText(raw)).toEqual({ a: 1 });
  });

  it('extracts JSON from a generic fenced code block without a language tag', () => {
    const raw = '```\n{"a": 1}\n```';
    expect(extractJsonFromText(raw)).toEqual({ a: 1 });
  });

  it('extracts a JSON object embedded in surrounding prose via brace matching', () => {
    const raw = 'Sure, here is the spec: {"a": 1, "b": [1, 2]} — hope that helps!';
    expect(extractJsonFromText(raw)).toEqual({ a: 1, b: [1, 2] });
  });

  it('extracts a JSON array embedded in surrounding prose via bracket matching', () => {
    const raw = 'Results: [1, 2, 3] end.';
    expect(extractJsonFromText(raw)).toEqual([1, 2, 3]);
  });

  it('returns null for empty or non-string input', () => {
    expect(extractJsonFromText('')).toBeNull();
    expect(extractJsonFromText(null as any)).toBeNull();
    expect(extractJsonFromText(undefined as any)).toBeNull();
  });

  it('returns null when no valid JSON can be decoded', () => {
    expect(extractJsonFromText('this is not json at all')).toBeNull();
  });
});
