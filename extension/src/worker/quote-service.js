/**
 * Service-worker quote owner: the only writer of the context's quote cache and
 * quote scrape lease. A page scrapes Bing's quote HTML only while it holds a
 * lease; the worker validates its submission, falls back to the shared
 * `qotd_url` sync setting for dates still missing, and notifies pages.
 *
 * Quote dates come only from the committed catalog. Quote work never reads or
 * writes the display state.
 */

import {
  grantQuoteLease,
  hasActiveLease,
  isValidQuoteSubmission,
  recordQuoteAttempt,
  releaseQuoteLease
} from '../helpers/quote-lease.js';
import { validateUrlSetting } from '../helpers/migration.js';
import { getNavigableDates } from '../helpers/retention.js';
import { STORAGE_KEYS } from './storage-keys.js';

export const QUOTE_SLOTS = 8;
const FALLBACK_MAX_BYTES = 64 * 1024;

/**
 * Up to eight committed current and historical dates, latest first: the
 * navigable dates. Future entries never take part in quote synchronization.
 */
function quoteDates(catalog) {
  return getNavigableDates(catalog, catalog.refreshState.date).slice(0, QUOTE_SLOTS);
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

function missingDates(quotes, dates) {
  return dates.filter(date => needsQuote(normalizeQuote(quotes[date])));
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
   * Grant a 60-second scrape lease for the latest committed date when no lease
   * is active and a committed date needing a quote is out of its own backoff
   * window. A reconnect may bypass one active window of each such date.
   *
   * @param {{reconnect?: boolean}} [options]
   * @returns {Promise<{granted: false}|{granted: true, date: string, token: string, scrape: boolean}>}
   *   `scrape` tells the holder whether the latest date itself is attempted with Bing's quote
   */
  function requestLease({ reconnect = false } = {}) {
    return serialize(async () => {
      const dates = await readDates();
      const { quotes, lease } = await readQuoteState();
      const missing = missingDates(quotes, dates);
      if (missing.length === 0) {
        return { granted: false };
      }
      const date = dates[0];
      const { granted, state, dueDates } = grantQuoteLease(lease, date, missing, now(), generateToken, reconnect ? now() : 0);
      if (!granted) {
        return { granted: false };
      }
      await storage.set({ [STORAGE_KEYS.quoteLease]: state });
      return { granted: true, date, token: state.token, scrape: dueDates.includes(date) };
    });
  }

  // Fill the dates still needing a quote from `candidatesFor(day)` and return
  // the dates whose quote changed.
  function mergeQuotes(quotes, dates, candidatesFor) {
    const updatedDates = [];
    for (const day of dates) {
      const cached = normalizeQuote(quotes[day]);
      if (!needsQuote(cached)) {
        continue;
      }
      const next = chooseQuote(cached, candidatesFor(day));
      if (next && !isSameQuote(next, cached)) {
        quotes[day] = next;
        updatedDates.push(day);
      }
    }
    pruneQuotes(quotes);
    return updatedDates;
  }

  async function commit(quotes, updatedDates, lease) {
    const writes = {};
    if (updatedDates.length > 0) {
      writes[STORAGE_KEYS.quoteState] = { quotes };
    }
    if (lease) {
      writes[STORAGE_KEYS.quoteLease] = lease;
    }
    if (Object.keys(writes).length > 0) {
      await storage.set(writes);
    }
    if (updatedDates.length > 0) {
      broadcast({ type: 'quotesUpdated', updatedDates });
    }
  }

  /**
   * Accept the lease holder's scraped quote, or its empty result, for the
   * lease date. The scrape commits at once. Committed dates still missing a
   * quote then fall back to qotd_url; a lease still held through the fallback
   * is revalidated before that commit. Filling the lease date, by either
   * commit, clears the lease. Each date keeps its own retries: a filled date
   * resets them, and the fallback backs off each date it leaves missing.
   *
   * @param {{date: string, token: string, quote: Object|null}} submission
   * @returns {Promise<{ok: false, rejected: true}|{ok: true, updatedDates: string[]}>}
   */
  async function submit({ date, token, quote }) {
    const scraped = normalizeQuote(quote);
    const fillsTarget = (quotes, updatedDates) =>
      updatedDates.includes(date) && !needsQuote(normalizeQuote(quotes[date]));

    const first = await serialize(async () => {
      const { quotes, lease } = await readQuoteState();
      if (!isValidQuoteSubmission(lease, { date, token }, now())) {
        return null;
      }
      const dates = await readDates();
      const updatedDates = mergeQuotes(quotes, dates, day => [day === date ? scraped : null]);
      const missing = missingDates(quotes, dates);
      const complete = missing.length === 0;
      const released = complete || fillsTarget(quotes, updatedDates);
      await commit(quotes, updatedDates, released ? releaseQuoteLease(lease, missing) : null);
      return { updatedDates, released, complete };
    });
    if (!first) {
      return { ok: false, rejected: true };
    }
    if (first.complete) {
      return { ok: true, updatedDates: first.updatedDates };
    }

    const remote = await fetchFallbackQuotes();
    return serialize(async () => {
      const { quotes, lease } = await readQuoteState();
      // A lease that expired or was replaced during the fallback cannot commit.
      if (!first.released && !isValidQuoteSubmission(lease, { date, token }, now())) {
        return { ok: false, rejected: true };
      }
      const dates = await readDates();
      const updatedDates = mergeQuotes(quotes, dates, day => [normalizeQuote(remote[day])]);
      const missing = missingDates(quotes, dates);
      let next = null;
      if (!first.released) {
        next = releaseQuoteLease(recordQuoteAttempt(lease, missing, now()), missing);
      } else if (!hasActiveLease(lease, now())) {
        // Released by the scrape commit; a lease granted since then records
        // its own attempt.
        next = recordQuoteAttempt(lease, missing, now());
      }
      await commit(quotes, updatedDates, next);
      return { ok: true, updatedDates: [...first.updatedDates, ...updatedDates] };
    });
  }

  return { requestLease, submit };
}
