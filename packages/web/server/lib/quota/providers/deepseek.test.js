import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({
  readOpenCodeCredentials: async () => ({ deepseek: { key: 'test-token' } }),
}));

import { fetchPrices, fetchQuota, isPeak } from './deepseek.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const mockResponse = (body, init = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
  ...init,
});

// Documented payload shape from https://api.deepseek.com/user/balance
const DOCUMENTED_PAYLOAD = {
  is_available: true,
  balance_infos: [
    {
      currency: 'USD',
      total_balance: '7.54',
      granted_balance: '0.00',
      topped_up_balance: '7.54'
    }
  ]
};

describe('DeepSeek quota provider', () => {
  it('builds credits_balance window from documented USD payload (string balance)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(DOCUMENTED_PAYLOAD)));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.providerId).toBe('deepseek');

    const window = result.usage.windows.credits_balance;
    expect(window).toBeDefined();
    expect(window.valueLabel).toBe('$7.54');
    expect(window.usedPercent).toBeNull();
    expect(window.windowSeconds).toBeNull();
    expect(window.resetAt).toBeNull();
  });

  it('falls back to CNY entry when no USD entry is present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '100.00', granted_balance: '0.00', topped_up_balance: '100.00' }
      ]
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usage.windows.credits_balance.valueLabel).toBe('¥100.00');
  });

  it('prefers the USD entry when both USD and CNY are present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '100.00', granted_balance: '0.00', topped_up_balance: '100.00' },
        { currency: 'USD', total_balance: '3.55', granted_balance: '0.00', topped_up_balance: '3.55' }
      ]
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usage.windows.credits_balance.valueLabel).toBe('$3.55');
  });

  it('selects CNY entry when USD balance is zero and CNY balance is positive', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '100.00', granted_balance: '0.00', topped_up_balance: '100.00' },
        { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }
      ]
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usage.windows.credits_balance.valueLabel).toBe('¥100.00');
  });

  it('reports no quota data instead of guessing a currency it does not know', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      is_available: true,
      balance_infos: [{ currency: 'EUR', total_balance: '12.00', granted_balance: '0.00', topped_up_balance: '12.00' }],
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('No quota data in response');
  });

  it('tolerates a numeric total_balance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: 12.5, granted_balance: 0, topped_up_balance: 12.5 }]
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usage.windows.credits_balance.valueLabel).toBe('$12.50');
  });

  it('maps 401 to session-expired error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Session expired — please re-authenticate with DeepSeek');
  });

  it('maps 403 to session-expired error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }));

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Session expired — please re-authenticate with DeepSeek');
  });

  it('reports invalid-response on JSON parse failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    }));

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid response from provider');
  });

  it('reports a normalized timeout error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError')));

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Request timed out');
  });

  it('returns no-quota-data on a 200 payload with no usable balance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: '', granted_balance: '0.00', topped_up_balance: '0.00' }]
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.error).toBe('No quota data in response');
    expect(result.usage).toBeNull();
  });

  it('keeps a literal zero balance as a valid valueLabel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      is_available: true,
      balance_infos: [{ currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }]
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usage.windows.credits_balance.valueLabel).toBe('$0.00');
  });
});

// DeepSeek publishes 0.15 / 0.60 / 0.003 per million for deepseek-flash as the
// off-peak price, and models.dev carries exactly that number.
const CATALOG = {
  metadata: {
    deepseek: {
      models: {
        'deepseek-flash': { cost: { input: 0.15, output: 0.6, cache_read: 0.003 } },
        'deepseek-v4-pro': { cost: { input: 0.66, output: 1.98, cache_read: 0.022 } },
        'no-price': { cost: { input: 0, output: 0 } }
      }
    }
  }
};

const readCatalog = vi.fn().mockResolvedValue(CATALOG);
const at = (iso) => Date.parse(iso);

describe('isPeak', () => {
  it('marks the two weekday windows, start included and end excluded', () => {
    // 2026-11-10 is a Tuesday.
    expect(isPeak(at('2026-11-10T01:00:00Z'))).toBe(true);
    expect(isPeak(at('2026-11-10T03:59:00Z'))).toBe(true);
    expect(isPeak(at('2026-11-10T04:00:00Z'))).toBe(false);
    expect(isPeak(at('2026-11-10T06:00:00Z'))).toBe(true);
    expect(isPeak(at('2026-11-10T09:59:00Z'))).toBe(true);
    expect(isPeak(at('2026-11-10T10:00:00Z'))).toBe(false);
  });

  it('is off-peak outside the windows and all weekend', () => {
    expect(isPeak(at('2026-11-10T00:59:00Z'))).toBe(false);
    expect(isPeak(at('2026-11-10T12:00:00Z'))).toBe(false);
    expect(isPeak(at('2026-11-14T03:00:00Z'))).toBe(false);
    expect(isPeak(at('2026-11-15T07:00:00Z'))).toBe(false);
  });
});

describe('fetchPrices', () => {
  it('doubles the catalogue price inside a peak window', async () => {
    const costs = await fetchPrices({
      modelIds: ['deepseek-flash'],
      now: at('2026-11-10T03:00:00Z'),
      readCatalog
    });

    expect(costs).toEqual({
      'deepseek-flash': { input: 0.3, output: 1.2, cache_read: 0.006 }
    });
  });

  it('leaves the catalogue price alone off-peak', async () => {
    const costs = await fetchPrices({
      modelIds: ['deepseek-flash', 'deepseek-v4-pro'],
      now: at('2026-11-14T03:00:00Z'),
      readCatalog
    });

    expect(costs).toEqual({
      'deepseek-flash': { input: 0.15, output: 0.6, cache_read: 0.003 },
      'deepseek-v4-pro': { input: 0.66, output: 1.98, cache_read: 0.022 }
    });
  });

  it('skips models the catalogue does not price', async () => {
    const costs = await fetchPrices({
      modelIds: ['no-price', 'not-in-catalogue'],
      now: at('2026-11-10T03:00:00Z'),
      readCatalog
    });

    expect(costs).toEqual({});
  });

  it('reads no catalogue when nothing is configured', async () => {
    const catalog = vi.fn();

    const costs = await fetchPrices({ modelIds: [], readCatalog: catalog });

    expect(costs).toEqual({});
    expect(catalog).not.toHaveBeenCalled();
  });
});
