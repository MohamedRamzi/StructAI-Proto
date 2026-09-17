import { describe, expect, it, vi, afterEach } from 'vitest';
import { searchInstrument } from './instrument-search';

const CFG = { baseUrl: 'http://svc', apiKey: 'k' };

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init: any) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const body = handler(url, init);
    return { ok: true, json: async () => body } as any;
  }));
}

describe('searchInstrument', () => {
  it('maps the pipeline asset class "RATES" to the corpus "RATE_INDEX"', async () => {
    let sentBody: any;
    stubFetch((_url, init) => { sentBody = JSON.parse(init.body); return { success: true, results: [{ code: 'EUR003M Index', name: 'Euribor 3M' }] }; });
    await searchInstrument('Euribor 3 mois', 'RATES', CFG);
    expect(sentBody.assetClass).toBe('RATE_INDEX');
  });

  it('passes EQUITY through and omits an unknown class', async () => {
    let sentBody: any;
    stubFetch((_url, init) => { sentBody = JSON.parse(init.body); return { success: true, results: [{ code: 'MC FP', name: 'LVMH' }] }; });
    await searchInstrument('LVMH', 'EQUITY', CFG);
    expect(sentBody.assetClass).toBe('EQUITY');
    await searchInstrument('LVMH', 'COMMODITY', CFG);
    expect(sentBody.assetClass).toBeUndefined();
  });

  it('returns null (no throw) when nothing matches', async () => {
    stubFetch(() => ({ success: true, results: [] }));
    expect(await searchInstrument('Société Foobar', 'EQUITY', CFG)).toBeNull();
  });

  it('rejects a hit whose code does not match an explicit-ticker query', async () => {
    stubFetch(() => ({ success: true, results: [{ code: 'MC FP', name: 'LVMH' }] }));
    expect(await searchInstrument('TSLA US', 'EQUITY', CFG)).toBeNull();       // ticker query, mismatched hit
    stubFetch(() => ({ success: true, results: [{ code: 'MC FP', name: 'LVMH' }] }));
    expect(await searchInstrument('un titre du luxe', 'EQUITY', CFG)).not.toBeNull(); // free text, accepted
  });

  it('returns null without calling fetch when there is no api key', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await searchInstrument('LVMH', 'EQUITY', { baseUrl: 'http://svc', apiKey: '' })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
