
importScripts('plan9/pure.js', 'plan9/catalog.js');

const catalogWorker = PLAN9Catalog.createCatalogWorker({ chrome, fetch: (...args) => fetch(...args) });
catalogWorker.install(globalThis);

// The legacy page still uses its regular quote key until the page/migration tickets land.
// Incognito never reads legacy regular state, including base.js's unbounded config cache.
const workerQuoteKey = catalogWorker.contextId === 'incognito' ? catalogWorker.keys.quotes : 'cache_quote_state';
const workerConf = {};
let legacyQuoteUrl;
let syncQuoteUrl;
function updateWorkerQuoteUrl() {
  workerConf.qotd_url = typeof syncQuoteUrl === 'string' ? syncQuoteUrl : legacyQuoteUrl;
}
const confReadyPromise = Promise.all([
  chrome.storage.local.get(catalogWorker.contextId === 'regular' ? [workerQuoteKey, 'qotd_url'] : workerQuoteKey),
  chrome.storage.sync.get('qotd_url')
]).then(([local, sync]) => {
  workerConf.cache_quote_state = local[workerQuoteKey];
  legacyQuoteUrl = local.qotd_url;
  syncQuoteUrl = sync.qotd_url;
  updateWorkerQuoteUrl();
});
function readConf(key) { return workerConf[key]; }
async function writeConf(key, value, epoch = catalogWorker.epoch) {
  if (key === 'lost_quotes' && catalogWorker.contextId === 'incognito') return;
  return catalogWorker.runContextWrite(epoch, async () => {
    await chrome.storage.local.set({ [key === 'cache_quote_state' ? workerQuoteKey : key]: value });
    workerConf[key] = value;
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.qotd_url) { syncQuoteUrl = changes.qotd_url.newValue; updateWorkerQuoteUrl(); }
  if (area === 'local' && changes.qotd_url && catalogWorker.contextId === 'regular') { legacyQuoteUrl = changes.qotd_url.newValue; updateWorkerQuoteUrl(); }
  if (area === 'local' && changes[workerQuoteKey]) workerConf.cache_quote_state = changes[workerQuoteKey].newValue;
});


// on install
chrome.runtime.onInstalled.addListener(function (object) {
	// open manual link
	if (chrome.runtime.OnInstalledReason.INSTALL === object.reason) {
		chrome.tabs.create({ url: "https://cn.bing.com/search?q=quote%20of%20the%20day&mkt=zh-CN&form=QBRE" });
		fetch('https://www.bing.com/favicon.ico', {
			method: "GET",
			cache: 'no-store'
		});
		// open Welcome page
		chrome.tabs.create({
			url: chrome.runtime.getURL('options.html')
		}, function (tab) {
			console.log("Fun Bingbing newtab is installed.");
		});
	}
});

const DEFAULT_LOST_QUOTES_URL = null;
const QUOTE_CACHE_SLOTS = 8;
const LOST_QUOTES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const WALLPAPER_CACHE_NAME = catalogWorker.contextId === 'incognito' ? catalogWorker.keys.cache : 'funbingbing-wallpaper-cache-v1';
const WALLPAPER_CACHE_MAX_ENTRIES = 48;
const WALLPAPER_PREFETCH_CONCURRENCY = 2;

let latestQuoteSyncRequestId = 0;
const wallpaperPrefetchInFlight = new Map();

let lostQuotesCache = null;
let lostQuotesFetchedAt = 0;
let lostQuotesCacheUrl = null;

async function getLostQuotesUrl() {
  await confReadyPromise;
  const configuredUrl = readConf("qotd_url");
  if (typeof configuredUrl === "string" && configuredUrl.trim()) {
    return configuredUrl.trim();
  }
  return DEFAULT_LOST_QUOTES_URL;
}

async function fetchLostQuotes(force = false) {
  const lostQuotesUrl = await getLostQuotesUrl();
  if (!lostQuotesUrl) {
    return {};
  }
  const now = Date.now();
  if (!force && lostQuotesCache && lostQuotesCacheUrl === lostQuotesUrl && (now - lostQuotesFetchedAt) < LOST_QUOTES_CACHE_TTL_MS) {
    return lostQuotesCache;
  }

  const response = await fetch(lostQuotesUrl, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch lost quotes: HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data || typeof data !== "object") {
    throw new Error("Lost quotes payload is invalid");
  }

  lostQuotesCache = data;
  lostQuotesFetchedAt = now;
  lostQuotesCacheUrl = lostQuotesUrl;
  return data;
}

function normalizeQuotePayload(rawQuote) {
  if (!rawQuote || typeof rawQuote !== "object") {
    return null;
  }

  const text = typeof rawQuote.text === "string"
    ? rawQuote.text.trim().replace(/^[\"'“”‘’]+/, '').replace(/[\"'“”‘’]+$/, '').trim()
    : "";
  if (!text) {
    return null;
  }

  const source = rawQuote.source || "";
  let link = rawQuote.link || "";
  if (!link && source) {
    link = `https://cn.bing.com/search?q=${encodeURIComponent(source)}&form=BTQUOT`;
  }
  if (typeof link === "string" && link.startsWith("/search")) {
    link = `https://cn.bing.com${link}`;
  }

  return {
    text,
    source,
    caption: rawQuote.caption || "",
    link
  };
}

function getDefaultQuoteState() {
  return {
    quotes: {}
  };
}

function getQuoteState() {
  const quoteState = readConf("cache_quote_state");
  if (!quoteState || typeof quoteState !== "object") {
    return getDefaultQuoteState();
  }
  if (!quoteState.quotes || typeof quoteState.quotes !== "object") {
    quoteState.quotes = {};
  }
  return quoteState;
}

function pruneQuoteCache(allQuotes) {
  const dates = Object.keys(allQuotes);
  if (dates.length <= QUOTE_CACHE_SLOTS) return;

  const keep = new Set(
    dates
      .sort()
      .reverse()
      .slice(0, QUOTE_CACHE_SLOTS)
  );

  dates.forEach((date) => {
    if (!keep.has(date)) {
      delete allQuotes[date];
    }
  });
}

function insertQuoteIntoCache(date, quote, quoteState) {
  const normalizedQuote = normalizeQuotePayload(quote);
  if (!date || !normalizedQuote) return null;
  const allQuotes = quoteState.quotes;
  allQuotes[date] = normalizedQuote;
  pruneQuoteCache(allQuotes);
  return normalizedQuote;
}

function computeMissingDates(imageDates, allQuotes) {
  const missing = new Set();
  const quoteMap = allQuotes || {};

  (imageDates || []).forEach((date) => {
    if (typeof date !== "string" || !date.trim()) return;
    const cachedQuote = normalizeQuotePayload(quoteMap[date]);
    if (cachedQuote) return;
    missing.add(date);
  });

  return Array.from(missing);
}

async function pruneWallpaperCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= WALLPAPER_CACHE_MAX_ENTRIES) return;
  const staleKeys = keys.slice(0, keys.length - WALLPAPER_CACHE_MAX_ENTRIES);
  await Promise.all(staleKeys.map((request) => cache.delete(request)));
}

function prefetchWallpaperUrl(cache, url, epoch) {
  const taskKey = epoch + ":" + url;
  const existing = wallpaperPrefetchInFlight.get(taskKey);
  if (existing) return existing;
  const task = (async () => {
    const cached = await cache.match(url);
    if (cached) return 'cached';
    if (await catalogWorker.runContextWrite(epoch, () => true) === false) return 'failed';

    const response = await fetch(url, {
      mode: 'cors',
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error(`Wallpaper prefetch failed with status ${response.status}`);
    }

    const admitted = await catalogWorker.runContextWrite(epoch, () => cache.put(url, response.clone()));
    if (admitted === false) return 'failed';
    return 'fetched';
  })();

  wallpaperPrefetchInFlight.set(taskKey, task);
  const clearInFlight = () => {
    if (wallpaperPrefetchInFlight.get(taskKey) === task) {
      wallpaperPrefetchInFlight.delete(taskKey);
    }
  };
  task.then(clearInFlight, clearInFlight);
  return task;
}

async function prefetchWallpapers(urls, epoch = catalogWorker.epoch) {
  const uniqueUrls = [...new Set(
    (Array.isArray(urls) ? urls : [])
      .filter((url) => typeof url === 'string' && /^https:\/\//i.test(url))
  )];
  const results = { fetched: 0, cached: 0, failed: 0 };
  const cache = await catalogWorker.runContextWrite(epoch, () => caches.open(WALLPAPER_CACHE_NAME));
  if (cache === false) return { ...results, requested: uniqueUrls.length };
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < uniqueUrls.length) {
      if (await catalogWorker.runContextWrite(epoch, () => true) === false) break;
      const url = uniqueUrls[nextIndex++];
      try {
        const result = await prefetchWallpaperUrl(cache, url, epoch);
        results[result] += 1;
      } catch (err) {
        results.failed += 1;
        console.warn('Wallpaper prefetch failed:', url, err);
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(WALLPAPER_PREFETCH_CONCURRENCY, uniqueUrls.length) },
      runWorker
    )
  );

  await catalogWorker.runContextWrite(epoch, () => pruneWallpaperCache(cache));
  return { ...results, requested: uniqueUrls.length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "prefetchWallpapers") {
    (async () => {
      try {
        const result = await prefetchWallpapers(message.urls);
        sendResponse({ ok: true, ...result });
      } catch (error) {
        console.error("Error prefetching wallpapers:", error);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message && message.type === "syncQuotesForImages") {
    const epoch = catalogWorker.epoch;
    (async () => {
      try {
        const {
          requestId,
          todayDate,
          todayQuote,
          imageDates
        } = message;
        if (!Number.isFinite(requestId)) {
          sendResponse({ ok: false, error: "invalid requestId" });
          return;
        }

        if (requestId <= latestQuoteSyncRequestId) {
          sendResponse({ ok: false, stale: true });
          return;
        }
        console.log(`[${new Date().toISOString()}] Handling syncQuotesForImages requestId=${requestId}, todayDate=${todayDate}, imageDates=${JSON.stringify(imageDates)}`);
        latestQuoteSyncRequestId = Math.max(latestQuoteSyncRequestId, requestId);

        await confReadyPromise;

        const quoteState = getQuoteState();
        const allQuotes = quoteState.quotes;

        const quoteMapForPatch = {};

        const shouldFetchTodayFallback = Boolean(
          todayDate
            && todayQuote
            && (typeof todayQuote.caption !== "string" || !todayQuote.caption.trim())
        );

        if (todayDate && !shouldFetchTodayFallback) {
          const todayCandidate = insertQuoteIntoCache(todayDate, todayQuote, quoteState);
          if (todayCandidate) {
            quoteMapForPatch[todayDate] = todayCandidate;
          }
        }

        const dates = Array.isArray(imageDates) ? imageDates.filter(d => typeof d === "string" && d.trim()) : [];
        const missingDates = computeMissingDates(dates, allQuotes);
        const blankCaptionDates = dates.filter((date) => {
          const cachedQuote = normalizeQuotePayload(allQuotes[date]);
          return cachedQuote && (typeof cachedQuote.caption !== "string" || !cachedQuote.caption.trim());
        });
        const datesToFetch = Array.from(new Set([
          ...missingDates,
          ...blankCaptionDates,
          ...(shouldFetchTodayFallback ? [todayDate] : [])
        ]));

        if (datesToFetch.length > 0) {
          try {
            console.log(`[${new Date().toISOString()}] Fetching lost quotes for dates: ${datesToFetch.join(", ")}`);
            const remote = await fetchLostQuotes(
              shouldFetchTodayFallback || blankCaptionDates.length > 0
            );
            datesToFetch.forEach((date) => {
              const candidate = insertQuoteIntoCache(date, remote[date], quoteState);
              if (candidate) {
                quoteMapForPatch[date] = candidate;
              }
            });
          } catch (err) {
            console.error("Failed to fetch lost quotes:", err);
          }
        }

        // Keep today's Bing quote if the configured fallback has no usable entry.
        const cachedTodayQuote = todayDate ? normalizeQuotePayload(allQuotes[todayDate]) : null;
        if (shouldFetchTodayFallback && todayDate && !quoteMapForPatch[todayDate] && !cachedTodayQuote) {
          const todayCandidate = insertQuoteIntoCache(todayDate, todayQuote, quoteState);
          if (todayCandidate) {
            quoteMapForPatch[todayDate] = todayCandidate;
          }
        }

        // Include cached quotes for dates that had them already
        dates.forEach((date) => {
          if (!quoteMapForPatch[date]) {
            const cached = normalizeQuotePayload(allQuotes[date]);
            if (cached) {
              quoteMapForPatch[date] = cached;
            }
          }
        });

        // Prevent an older syncQuotesForImages request from writing results after a newer request has already started.
        if (requestId !== latestQuoteSyncRequestId) {
          sendResponse({ ok: false, stale: true });
          return;
        }

        if (await writeConf("cache_quote_state", quoteState, epoch) === false) {
          sendResponse({ ok: false, stale: true });
          return;
        }

        //It is useless now. Kept for debugging purposes. May drop it in future.
        const unresolved = computeMissingDates(dates, allQuotes);
        await writeConf("lost_quotes", unresolved, epoch);

        const updatedDates = Object.keys(quoteMapForPatch);
        if (updatedDates.length > 0) {
          chrome.runtime.sendMessage({ type: "quotesUpdated", requestId, updatedDates });
        }

        sendResponse({ ok: true, stale: false, updatedDates, missingDates: unresolved });
      } catch (error) {
        console.error("Error handling syncQuotesForImages:", error);
        sendResponse({ ok: false, error: error.message });
      }
    })();

    return true;
  }

  return false;
});
