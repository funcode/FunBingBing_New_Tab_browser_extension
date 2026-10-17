
import { createCatalogService } from '../src/worker/catalog-service.js';
import { createImageScheduler } from '../src/worker/image-scheduler.js';
import { createMigrationService } from '../src/worker/migration-service.js';
import { createQuoteService } from '../src/worker/quote-service.js';
import { createTriviaService } from '../src/worker/trivia-service.js';
import { WALLPAPER_CACHE_NAME } from '../src/worker/storage-keys.js';

async function fetchBingJson(url) {
	const response = await fetch(url, { cache: 'no-store' });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return response.json();
}

// Having no listening page is expected; other delivery errors are logged.
function broadcastToPages(message) {
	chrome.runtime.sendMessage(message).catch((error) => {
		if (!String(error?.message).includes('Receiving end does not exist')) {
			console.warn(`Failed to broadcast ${message.type}:`, error);
		}
	});
}

async function fetchWallpaperImage(url) {
	const response = await fetch(url, { cache: 'no-store' });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return response;
}

function fetchTrivia(triviaId) {
	return fetchBingJson(`https://www.bing.com/hp/api/v1/trivia?format=json&id=${encodeURIComponent(triviaId)}&mkt=zh-CN`);
}

const catalogService = createCatalogService({
	storage: chrome.storage.local,
	syncStorage: chrome.storage.sync,
	fetchJson: fetchBingJson,
	broadcast: broadcastToPages,
	scheduleTrivia: (candidates) => scheduleTriviaInBackground(candidates),
	onCatalogChanged: () => reconcileImagesInBackground()
});

const triviaService = createTriviaService({ catalogService, fetchTrivia });

const quoteService = createQuoteService({
	catalogService,
	storage: chrome.storage.local,
	syncStorage: chrome.storage.sync,
	fetch: (url, init) => fetch(url, init),
	// The runtime adapter is the only lease token generator.
	generateToken: () => globalThis.crypto.randomUUID(),
	broadcast: broadcastToPages
});

const imageScheduler = createImageScheduler({
	catalogService,
	syncStorage: chrome.storage.sync,
	openCache: () => caches.open(WALLPAPER_CACHE_NAME),
	fetchImage: fetchWallpaperImage
});

const migrationService = createMigrationService({
	catalogService,
	storage: chrome.storage.local,
	syncStorage: chrome.storage.sync,
	caches
});

// Every worker start runs or resumes the v1-to-v2 migration. Catalog, image
// and quote work wait for it so they start from the migrated state.
const migrated = migrationService.run();

function afterMigration(task) {
	return migrated.then(task);
}

function refreshCatalogInBackground(options) {
	afterMigration(() => catalogService.refresh(options)).catch((error) => {
		console.error("Wallpaper catalog refresh failed:", error);
	});
}

function scheduleTriviaInBackground(candidates) {
	afterMigration(() => triviaService.schedule(candidates)).catch((error) => {
		console.error("Trivia fetch failed:", error);
	});
}

function reconcileImagesInBackground(options) {
	afterMigration(() => imageScheduler.reconcile(options)).catch((error) => {
		console.error("Wallpaper image prefetch failed:", error);
	});
}

chrome.runtime.onStartup.addListener(() => {
	refreshCatalogInBackground();
	reconcileImagesInBackground();
});

self.addEventListener('online', () => {
	refreshCatalogInBackground({ reconnect: true });
	reconcileImagesInBackground({ reconnect: true });
});

// A resolution change drops obsolete pending work and schedules the new final
// resolution; metadata and previews are not fetched again.
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "sync" && "enable_uhd_wallpaper" in changes) {
		reconcileImagesInBackground({ resolutionChanged: true });
	}
});

// on install
chrome.runtime.onInstalled.addListener(function (object) {
	refreshCatalogInBackground();
	reconcileImagesInBackground();
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Pages send `reconnect: true` after the online event or the 15-second connection check.
  if (message && message.type === "refreshWallpaperCatalog") {
    // Image work is derived from the committed catalog without waiting for this refresh.
    reconcileImagesInBackground({ reconnect: message.reconnect === true });
    afterMigration(() => catalogService.refresh({ reconnect: message.reconnect === true })).then(
      () => sendResponse({ ok: true }),
      (error) => {
        console.error("Wallpaper catalog refresh failed:", error);
        sendResponse({ ok: false, error: error.message });
      }
    );
    return true;
  }

  if (message && message.type === "ensureWallpaperCached") {
    afterMigration(() => imageScheduler.ensureWallpaperCached({ date: message.date, resolution: message.resolution })).then(
      sendResponse,
      (error) => {
        console.error("ensureWallpaperCached failed:", error);
        sendResponse({ ok: false, error: error.message });
      }
    );
    return true;
  }

  // Pages send `reconnect: true` when their network status returns online.
  if (message && message.type === "requestQuoteLease") {
    afterMigration(() => quoteService.requestLease({ reconnect: message.reconnect === true })).then(sendResponse, (error) => {
      console.error("Quote lease request failed:", error);
      sendResponse({ granted: false, error: error.message });
    });
    return true;
  }

  // The lease holder submits its scraped quote, or null when scraping failed.
  if (message && message.type === "syncQuotesForImages") {
    afterMigration(() => quoteService.submit({ date: message.date, token: message.token, quote: message.quote })).then(
      sendResponse,
      (error) => {
        console.error("Quote submission failed:", error);
        sendResponse({ ok: false, error: error.message });
      }
    );
    return true;
  }

  // A page asks, before its first selection, whether to hand off its display state.
  if (message && message.type === "migrationStatus") {
    afterMigration(() => migrationService.status()).then(sendResponse, (error) => {
      console.error("Migration status failed:", error);
      sendResponse({ phase: null, error: error.message });
    });
    return true;
  }

  // The first page after verification wrote the v2 display state.
  if (message && message.type === "migrationDisplayStateReady") {
    afterMigration(() => migrationService.acknowledge()).then(sendResponse, (error) => {
      console.error("Migration acknowledgement failed:", error);
      sendResponse({ ok: false, error: error.message });
    });
    return true;
  }

  return false;
});
