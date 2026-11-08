import { readOpenCodeCredentials } from '../../opencode/auth.js';
import { getModelsMetadata } from '../../opencode/models-metadata.js';
import {
  getAuthEntry,
  normalizeAuthEntry,
  buildResult,
  toUsageWindow,
  toNumber,
  formatMoney
} from '../utils/index.js';

export const providerId = 'deepseek';
export const providerName = 'DeepSeek';
const aliases = ['deepseek'];
const DEEPSEEK_QUOTA_URL = 'https://api.deepseek.com/user/balance';

export const isConfigured = (auth) => {
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  return Boolean(entry?.key || entry?.token);
};

export const fetchQuota = async () => {
  const auth = await readOpenCodeCredentials();
  const entry = normalizeAuthEntry(getAuthEntry(auth, aliases));
  const apiKey = entry?.key ?? entry?.token;

  if (!apiKey) {
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: false,
      error: 'Not configured'
    });
  }

  const timeoutSignal = AbortSignal.timeout(15_000);

  try {
    const response = await fetch(DEEPSEEK_QUOTA_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Accept-Encoding': 'identity'
      },
      signal: timeoutSignal
    });

    if (!response.ok) {
      return buildResult({
        providerId,
        providerName,
        ok: false,
        configured: true,
        error: response.status === 401 || response.status === 403
          ? 'Session expired — please re-authenticate with DeepSeek'
          : `API error: ${response.status}`
      });
    }

    const payload = await response.json();
    const balanceInfos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : [];
    const positiveBalances = balanceInfos.filter((info) => {
      const num = toNumber(info?.total_balance);
      return typeof num === 'number' && num > 0;
    });
    const balanceInfo = positiveBalances.find((info) => info?.currency === 'USD')
      ?? positiveBalances.find((info) => info?.currency === 'CNY')
      ?? balanceInfos.find((info) => info?.currency === 'USD')
      ?? balanceInfos.find((info) => info?.currency === 'CNY')
      ?? null;
    const rawBalance = balanceInfo?.total_balance;
    const totalBalance = (typeof rawBalance === 'number' || (typeof rawBalance === 'string' && rawBalance.trim() !== ''))
      ? toNumber(rawBalance)
      : null;

    if (totalBalance === null) {
      return buildResult({
        providerId,
        providerName,
        ok: false,
        configured: true,
        error: 'No quota data in response'
      });
    }

    const isCny = balanceInfo?.currency === 'CNY';
    const symbol = isCny ? '¥' : '$';
    const valueLabel = `${symbol}${formatMoney(totalBalance)}`;

    const windows = {
      credits_balance: toUsageWindow({
        usedPercent: null,
        windowSeconds: null,
        resetAt: null,
        valueLabel
      })
    };

    return buildResult({
      providerId,
      providerName,
      ok: true,
      configured: true,
      usage: { windows }
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException && (
      error.name === 'TimeoutError' || (error.name === 'AbortError' && timeoutSignal.aborted)
    );
    const isParseError = error instanceof SyntaxError;
    return buildResult({
      providerId,
      providerName,
      ok: false,
      configured: true,
      error: isTimeout
        ? 'Request timed out'
        : isParseError
          ? 'Invalid response from provider'
          : (error instanceof Error ? error.message : 'Request failed')
    });
  }
};

// Six decimals hold a price exactly ($0.00294 for a $0.003 read).
const perMillion = (value) => Math.round(value * 1e6) / 1e6;

/**
 * DeepSeek bills two prices a day. Peak hours are 01:00 to 04:00 and 06:00 to
 * 10:00 UTC, Monday to Friday; every other hour, including weekends, costs
 * half of that.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing, read 2026-11-08.
 * That page also exempts Chinese public holidays from peak hours for the whole
 * day. This table cannot know them, so a holiday is priced like a weekday and
 * quotes double then, roughly 15 days a year.
 *
 * The windows are minutes of the UTC day, `from` inclusive and `to` exclusive.
 */
const PEAK_WINDOWS_MINUTES = [
  [60, 240],
  [360, 600]
];
const PEAK_FACTOR = 2;

/**
 * Whether `now` falls into a DeepSeek peak window.
 *
 * @param {number} [now] epoch milliseconds, UTC
 * @returns {boolean}
 */
export const isPeak = (now = Date.now()) => {
  const at = new Date(now);
  const weekday = at.getUTCDay();
  // 0 is Sunday and 6 is Saturday: DeepSeek runs off-peak all weekend.
  if (weekday === 0 || weekday === 6) return false;
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return PEAK_WINDOWS_MINUTES.some(([from, to]) => minutes >= from && minutes < to);
};

/**
 * Prices for the models the user configured, for the hour they are asked at.
 *
 * models.dev carries DeepSeek's off-peak number (0.15 / 0.60 / 0.003 per
 * million for `deepseek-flash`, read 2026-11-08), so a peak window is that
 * number doubled and the rest of the day is the catalogue number unchanged.
 * Reading the catalogue instead of copying prices into this file means a
 * DeepSeek price change needs no change here.
 *
 * @param {object} [options]
 * @param {string[]} [options.modelIds] ids to price; anything else is ignored
 * @param {number} [options.now] epoch milliseconds, UTC
 * @param {() => Promise<{metadata: object}>} [options.readCatalog]
 * @returns {Promise<Record<string, {input: number, output: number, cache_read?: number, cache_write?: number}>>}
 */
export const fetchPrices = async ({
  modelIds = [],
  now = Date.now(),
  readCatalog = getModelsMetadata
} = {}) => {
  if (modelIds.length === 0) return {};

  const { metadata } = await readCatalog();
  const models = metadata?.deepseek?.models;
  if (!models || typeof models !== 'object') return {};

  const factor = isPeak(now) ? PEAK_FACTOR : 1;
  const costs = {};
  for (const id of modelIds) {
    const cost = models[id]?.cost;
    if (!cost || !Number.isFinite(cost.input) || !Number.isFinite(cost.output)) continue;
    // An all-zero entry is the catalogue saying it knows no price, not $0.
    if (cost.input === 0 && cost.output === 0) continue;
    const next = {
      input: perMillion(cost.input * factor),
      output: perMillion(cost.output * factor)
    };
    if (Number.isFinite(cost.cache_read)) next.cache_read = perMillion(cost.cache_read * factor);
    if (Number.isFinite(cost.cache_write)) next.cache_write = perMillion(cost.cache_write * factor);
    costs[id] = next;
  }
  return costs;
};
