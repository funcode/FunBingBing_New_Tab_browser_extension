/**
 * Service-worker quote owner: the only writer of the context's quote cache and
 * quote scrape lease. A page scrapes Bing's quote HTML only while it holds a
 * lease; the worker validates its submission, falls back to the shared
 * `qotd_url` sync setting for dates still missing, and notifies pages.
 *
 * Quote dates come only from the committed catalog. Quote work never reads or
 * writes the display state.
 */

import { grantQuoteLease, isValidQuoteSubmission, releaseQuoteLease } from '../helpers/quote-lease.js';
import { validateUrlSetting } from '../helpers/migration.js';
import { STORAGE_KEYS } from './storage-keys.js';

export const QUOTE_SLOTS = 8;
const FALLBACK_MAX_BYTES = 64 * 1024;

/**
 * Up to eight committed current and historical dates, latest first.
 * Future entries never take part in quote synchronization.
 */
function quoteDates(catalog) {
  const targetDate = catalog.refreshState.date;
  return Object.keys(catalog.entries)
    .filter(date => date <= targetDate)
    .sort()
    .reverse()
    .slice(0, QUOTE_SLOTS);
}

function quoteLink(link, source) {
  if (typeof link === 'string' && link.startsWith('/search')) {
    return `https://cn.bing.com${link}`;
  }
  return source ? `https://cn.bing.com/search?q=${encodeURIComponent(source)}&form=BTQUOT` : '';
}

/**
 * A quote is a text string with optional source and caption strings. Links
 * are kept only as Bing search paths; otherwise they are derived from the
 * source. Pages render every field as text.
 *
 * @returns {{text: string, source: string, caption: string, link: string}|null}
 */
export function normalizeQuote(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const { text, source = '', caption = '', link } = raw;
  if (typeof text !== 'string' || typeof source !== 'string' || typeof caption !== 'string') {
    return null;
  }
  const cleaned = text.trim().replace(/^["'“”‘’]+/, '').replace(/["'“”‘’]+$/, '').trim();
  if (!cleaned) {
    return null;
  }
  return { text: cleaned, source: source.trim(), caption: caption.trim(), link: quoteLink(link, source.trim()) };
}

// A blank caption is recovered like a missing quote (ADR-0014).
function needsQuote(quote) {
  return !quote || !quote.caption;
}

// A captioned candidate wins; an unusable one never replaces a cached quote.
function chooseQuote(cached, candidates) {
  const usable = candidates.filter(Boolean);
  return usable.find(quote => quote.caption) || cached || usable[0] || null;
}

function isSameQuote(a, b) {
  return Boolean(a && b) && a.text === b.text && a.source === b.source &&
    a.caption === b.caption && a.link === b.link;
}

export function pruneQuotes(quotes) {
  for (const date of Object.keys(quotes).sort().reverse().slice(QUOTE_SLOTS)) {
    delete quotes[date];
  }
}

async function readBounded(response, limit) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('Quote fallback response exceeds 64 KiB');
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * @param {Object} deps
 * @param {{read: Function}} deps.catalogService
 * @param {{get: Function, set: Function}} deps.storage - chrome.storage.local-shaped area
 * @param {{get: Function}} deps.syncStorage - chrome.storage.sync-shaped area holding `qotd_url`
 * @param {typeof fetch} deps.fetch
 * @param {() => string} deps.generateToken - Called only for a granted lease
 * @param {() => number} [deps.now]
 * @param {(message: Object) => void} [deps.broadcast]
 * @param {{warn: Function}} [deps.log]
 */
export function createQuoteService({
  catalogService,
  storage,
  syncStorage,
  fetch: fetchImpl,
  generateToken,
  now = Date.now,
  broadcast = () => {},
  log = console
}) {
  // Lease grants and quote commits run one at a time against fresh reads.
  let chain = Promise.resolve();

  function serialize(task) {
    const run = chain.then(task);
    chain = run.catch(() => {});
    return run;
  }

  async function readDates() {
    const { catalog } = await catalogService.read();
    return quoteDates(catalog);
  }

  async function readQuoteState() {
    const stored = await storage.get([STORAGE_KEYS.quoteState, STORAGE_KEYS.quoteLease]);
    const quotes = stored[STORAGE_KEYS.quoteState]?.quotes;
    return {
      quotes: quotes && typeof quotes === 'object' ? quotes : {},
      lease: stored[STORAGE_KEYS.quoteLease] ?? null
    };
  }

  // Any failure leaves the cached quotes as they are.
  async function fetchFallbackQuotes() {
    const { qotd_url: url } = await syncStorage.get('qotd_url');
    if (!validateUrlSetting(url)) {
      return {};
    }
    try {
      const response = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = JSON.parse(await readBounded(response, FALLBACK_MAX_BYTES));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Quote fallback payload is not an object');
      }
      return payload;
    } catch (error) {
      log.warn('[quotes] Quote fallback failed', error);
      return {};
    }
  }

  /**
   * Grant a 60-second scrape lease for the latest committed date when a
   * committed date needs a quote, no lease is active and the date's backoff
   * window has expired. A reconnect may bypass one active window.
   *
   * @param {{reconnect?: boolean}} [options]
   * @returns {Promise<{granted: false}|{granted: true, date: string, token: string, scrape: boolean}>}
   *   `scrape` tells the holder whether the latest date itself needs Bing's quote
   */
  function requestLease({ reconnect = false } = {}) {
    return serialize(async () => {
      const dates = await readDates();
      const { quotes, lease } = await readQuoteState();
      if (!dates.some(date => needsQuote(normalizeQuote(quotes[date])))) {
        return { granted: false };
      }
      const date = dates[0];
      const { granted, state } = grantQuoteLease(lease, date, now(), generateToken, reconnect ? now() : 0);
      if (!granted) {
        return { granted: false };
      }
      await storage.set({ [STORAGE_KEYS.quoteLease]: state });
      return { granted: true, date, token: state.token, scrape: needsQuote(normalizeQuote(quotes[date])) };
    });
  }

  /**
   * Accept the lease holder's scraped quote, or its empty result, for the
   * lease date. Committed dates still missing a quote fall back to qotd_url.
   * The lease is cleared, and the date backs off while any quote is missing.
   *
   * @param {{date: string, token: string, quote: Object|null}} submission
   * @returns {Promise<{ok: false, rejected: true}|{ok: true, updatedDates: string[]}>}
   */
  async function submit({ date, token, quote }) {
    const accepted = await serialize(async () =>
      isValidQuoteSubmission((await readQuoteState()).lease, { date, token }, now()));
    if (!accepted) {
      return { ok: false, rejected: true };
    }
    const scraped = normalizeQuote(quote);
    const scrapedFor = day => (day === date ? scraped : null);

    const dates = await readDates();
    const { quotes: cachedQuotes } = await readQuoteState();
    const needsFallback = dates.some(day =>
      needsQuote(chooseQuote(normalizeQuote(cachedQuotes[day]), [scrapedFor(day)])));
    const remote = needsFallback ? await fetchFallbackQuotes() : {};

    return serialize(async () => {
      const { quotes, lease } = await readQuoteState();
      const updatedDates = [];
      for (const day of dates) {
        const cached = normalizeQuote(quotes[day]);
        if (!needsQuote(cached)) {
          continue;
        }
        const next = chooseQuote(cached, [scrapedFor(day), normalizeQuote(remote[day])]);
        if (next && !isSameQuote(next, cached)) {
          quotes[day] = next;
          updatedDates.push(day);
        }
      }
      pruneQuotes(quotes);

      const writes = {};
      if (updatedDates.length > 0) {
        writes[STORAGE_KEYS.quoteState] = { quotes };
      }
      // A lease replaced in the meantime belongs to its new holder.
      if (lease?.token === token) {
        const complete = dates.every(day => !needsQuote(normalizeQuote(quotes[day])));
        writes[STORAGE_KEYS.quoteLease] = releaseQuoteLease(lease, complete, now());
      }
      if (Object.keys(writes).length > 0) {
        await storage.set(writes);
      }
      if (updatedDates.length > 0) {
        broadcast({ type: 'quotesUpdated', updatedDates });
      }
      return { ok: true, updatedDates };
    });
  }

  return { requestLease, submit };
}
