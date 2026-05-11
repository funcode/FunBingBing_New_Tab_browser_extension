
importScripts('base.js');

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
const LOST_QUOTES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let latestQuoteSyncRequestId = 0;

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

  const text = rawQuote.text || "";
  if (!text) {
    return null;
  }

  const source = rawQuote.source || "";
  let link = rawQuote.link || "";
  if (!link && source) {
    link = `https://cn.bing.com/search?q=${encodeURIComponent(source)}&form=BTQUOT`;
  }

  return {
    text,
    source,
    caption: rawQuote.caption || "",
    link
  };
}

function getDefaultTracker() {
  return {
    //0 is the initial value, meaning no quotes cached yet. It will be set to 1-8 as quotes are cached, indicating the current slot to overwrite next.
    last: 0,
    "1": null, "2": null, "3": null, "4": null,
    "5": null, "6": null, "7": null, "8": null
  };
}

function insertQuoteIntoCache(date, quote, allQuotes, tracker) {
  const normalizedQuote = normalizeQuotePayload(quote);
  if (!date || !normalizedQuote) return false;
  if (!allQuotes[date]) {
    tracker.last = (tracker.last % 8) + 1;
    const slot = tracker.last;
    const oldKey = tracker[slot];
    if (oldKey && allQuotes[oldKey]) {
      delete allQuotes[oldKey];
    }
    allQuotes[date] = normalizedQuote;
    tracker[slot] = date;
    return true;
  }
  return false;
}

function computeMissingDates(imageDates, bingImages, allQuotes) {
  const missing = new Set();
  const quoteMap = allQuotes || {};
  const imagesByDate = new Map();
  if (Array.isArray(bingImages)) {
    bingImages.forEach((img) => {
      if (img && typeof img.isoDate === "string") {
        imagesByDate.set(img.isoDate, img);
      }
    });
  }

  (imageDates || []).forEach((date) => {
    if (typeof date !== "string" || !date.trim()) return;
    const cachedQuote = normalizeQuotePayload(quoteMap[date]);
    if (cachedQuote) return;
    const img = imagesByDate.get(date);
    const existing = img ? normalizeQuotePayload(img.quoteData) : null;
    if (!existing) missing.add(date);
  });

  return Array.from(missing);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "syncQuotesForImages") {
    (async () => {
      try {
        const { requestId, todayDate, todayQuote, imageDates } = message;
        if (!Number.isFinite(requestId)) {
          sendResponse({ ok: false, error: "invalid requestId" });
          return;
        }

        if (requestId <= latestQuoteSyncRequestId) {
          sendResponse({ ok: false, stale: true });
          return;
        }
        latestQuoteSyncRequestId = Math.max(latestQuoteSyncRequestId, requestId);

        await confReadyPromise;

        let allQuotes = readConf("cache_quote_of_the_day") || {};
        let tracker = readConf("cache_quote_tracker") || getDefaultTracker();
        const storedBingImages = await readStorageKey("bing_images");
        const bingImagesForMissing = Array.isArray(storedBingImages)
          ? storedBingImages
          : [];

        const quoteMapForPatch = {};

        if (todayDate) {
          const inserted = insertQuoteIntoCache(todayDate, todayQuote, allQuotes, tracker);
          const normalizedTodayQuote = normalizeQuotePayload(todayQuote);
          if (inserted || normalizedTodayQuote) {
            quoteMapForPatch[todayDate] = normalizedTodayQuote || allQuotes[todayDate];
          }
        }

        const dates = Array.isArray(imageDates) ? imageDates.filter(d => typeof d === "string" && d.trim()) : [];
        const missingDates = computeMissingDates(dates, bingImagesForMissing, allQuotes);

        if (missingDates.length > 0) {
          try {
            const remote = await fetchLostQuotes();
            missingDates.forEach((date) => {
              const candidate = normalizeQuotePayload(remote[date]);
              if (candidate) {
                quoteMapForPatch[date] = candidate;
                insertQuoteIntoCache(date, candidate, allQuotes, tracker);
              }
            });
          } catch (err) {
            console.error("Failed to fetch lost quotes:", err);
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

        if (requestId !== latestQuoteSyncRequestId) {
          sendResponse({ ok: false, stale: true });
          return;
        }

        await writeConf("cache_quote_of_the_day", allQuotes);
        await writeConf("cache_quote_tracker", tracker);

        const unresolved = computeMissingDates(dates, bingImagesForMissing, allQuotes);
        await writeConf("lost_quotes", unresolved);

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
