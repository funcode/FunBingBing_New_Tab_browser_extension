(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./helpers.js') : root.PLAN9Pure);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PLAN9Catalog = api;
})(globalThis, function (P) {
  'use strict';

  const SOURCE_URLS = {
    imageOfTheDay: 'https://www.bing.com/hp/api/v1/imageoftheday?format=json&mkt=zh-CN',
    model: 'https://cn.bing.com/hp/api/model?mkt=zh-CN',
    archive: 'https://www.bing.com/HPImageArchive.aspx?format=js&n=1&mkt=zh-CN&idx=7'
  };
  const FIELDS = ['caption', 'title', 'headline', 'description', 'descriptionPara2', 'descriptionPara3', 'copyright', 'clickUrl', 'backstageUrl', 'quickFact', 'triviaId'];
  const emptySource = () => ({ status: 'missing', attemptedAt: 0, nextRetryAt: 0, retryLevel: 0, lastReconnectBypassAt: 0 });
  const sourceStates = () => Object.fromEntries(Object.keys(SOURCE_URLS).map(name => [name, emptySource()]));
  const canRetry = P.canRetry;
  const nextRetry = P.nextRetry;

  function contextKeys(contextId) {
    const key = name => P.getWallpaperContextId(name, contextId);
    return {
      catalog: key('bing_wallpaper_catalog_v2'), display: key('wallpaper_display_state_v2'),
      quotes: key('cache_quote_state_v2'), quoteLease: key('quote_scrape_state_v2'),
      cache: 'funbingbing-wallpaper-cache-v2-' + contextId,
      ...(contextId === 'regular' ? { migration: key('wallpaper_migration_v2_state') } : {})
    };
  }

  function makeEntry(date, image, metadataStage, fields) {
    try {
      if (!/^\d{8}$/.test(date || '') || P.addDays(date, 0) !== date) return null;
      const imageId = P.normalizeImageId(image);
      const urls = P.getCanonicalImageUrls(imageId);
      return { date, imageId, metadataStage, urls: { preview: urls['_640x360.jpg'], highDef: urls['_1920x1080.jpg'], ultraHighDef: urls['_UHD.jpg'] }, ...fields };
    } catch (_) { return null; }
  }

  function candidates(source, payload, catalog, logger) {
    if (source === 'imageOfTheDay') {
      return (Array.isArray(payload?.data?.images) ? payload.data.images : []).filter(item => item && typeof item === 'object').map(item => makeEntry(item.isoDate, item.imageUrls?.landscape?.highDef, 'iotd', Object.fromEntries(FIELDS.filter(key => typeof item[key] === 'string').map(key => [key, item[key]])))).filter(Boolean);
    }
    if (source === 'model') {
      const parse = (items, stage) => (Array.isArray(items) ? items : []).map(item => {
        if (!item || typeof item !== 'object') return null;
        const content = item.ImageContent || {};
        const image = content.Image?.Url;
        if (typeof image !== 'string' || !image.startsWith('https://')) return null;
        let id;
        try { id = new URL(image).searchParams.get('id') || ''; } catch (_) { return null; }
        if (!/_(640x360|1920x1080|UHD)\.(jpg|webp)$/.test(id)) return null;
        return makeEntry(item.Ssd, image, stage, {
          title: content.Title, headline: content.Headline, description: content.Description,
          copyright: content.Copyright, backstageUrl: content.BackstageUrl,
          quickFact: content.QuickFact?.MainText, triviaId: P.normalizeTriviaId(content.TriviaId, item.Ssd)
        });
      }).filter(Boolean);
      return [...parse(payload?.MediaContents, 'media'), ...parse(payload?.PreloadMediaContents, 'preload')];
    }
    const coverage = P.validateSourceCoverage('archive', payload, catalog.refreshState.date, Object.values(catalog.entries));
    if (coverage.status !== 'success') return [];
    return coverage.entries.map(item => {
      let quizId = item.quiz;
      if (typeof quizId === 'string' && quizId.startsWith('/search?')) {
        const filters = new URL(quizId, 'https://www.bing.com').searchParams.get('filters') || '';
        quizId = /^WQOskey:"(HPQuiz_[^"]+)"$/.exec(filters)?.[1] || '';
      }
      const triviaId = P.normalizeTriviaId(quizId, item.enddate);
      if (typeof item.quiz === 'string' && item.quiz && !triviaId) logger.warn('Invalid Archive trivia ID', { date: item.enddate });
      return makeEntry(item.enddate, item.urlbase || item.url, 'archive', { headline: item.title, copyright: item.copyright, triviaId });
    }).filter(Boolean);
  }

  function createCatalogWorker({ chrome, fetch, now = Date.now, logger = console, caches = globalThis.caches }) {
    const contextId = chrome.extension?.inIncognitoContext ? 'incognito' : 'regular';
    const keys = contextKeys(contextId);
    let writes = Promise.resolve();
    let contextEpoch = 0;
    let inactive = false;
    let cleanupTask;
    const refreshes = new Map();
    const reconnectFollowups = new Map();
    const activeReconnects = new Set();
    const triviaInFlight = new Map();
    const triviaCommitFailures = new Set();
    let triviaScan = Promise.resolve();
    const serialized = work => {
      const result = writes.then(work);
      writes = result.catch(() => {});
      return result;
    };
    const readCatalog = async () => (await chrome.storage.local.get(keys.catalog))[keys.catalog];
    async function broadcast(updatedDates) {
      if (!updatedDates.length) return;
      try { await chrome.runtime.sendMessage({ type: 'wallpaperCatalogUpdated', updatedDates }); }
      catch (error) { if (!/Receiving end does not exist|Could not establish connection/.test(error.message || '')) logger.warn('Catalog broadcast failed', error); }
    }
    async function save(catalog, changed = []) {
      catalog.updatedAt = now();
      await chrome.storage.local.set({ [keys.catalog]: catalog });
      await broadcast(changed);
    }
    const windowIdentity = catalog => Array.from({ length: 8 }, (_, offset) => {
      const entry = catalog.entries[P.addDays(catalog.refreshState.date, -offset)];
      return entry?.metadataStage === 'iotd' ? entry.date + ':' + entry.imageId : '';
    }).join('|');

    async function commitSource(source, payload, captured, failed) {
      await serialized(async () => {
        if (inactive || captured.epoch !== contextEpoch) return;
        const catalog = await readCatalog();
        if (!catalog) return;
        const display = (await chrome.storage.local.get(keys.display))[keys.display];
        const current = catalog.refreshState.generation === captured.generation && catalog.refreshState.date === captured.date;
        const changed = [];
        const beforeWindow = windowIdentity(catalog);
        for (const candidate of failed ? [] : candidates(source, payload, catalog, logger)) {
          const existing = catalog.entries[candidate.date];
          if (!P.admitStaleCandidate(candidate, existing, display, captured.generation, catalog.refreshState.generation, catalog.refreshState.date)) continue;
          if (!current && candidate.date >= catalog.refreshState.date && !existing) continue;
          const merged = current ? P.mergeMetadata(existing, candidate) : P.mergeStaleMetadata(existing, candidate);
          if (!merged || JSON.stringify(merged) === JSON.stringify(existing)) continue;
          if (!existing || existing.imageId !== merged.imageId || existing.triviaId !== merged.triviaId) {
            Object.assign(merged, { triviaData: null, triviaState: 'missing', triviaAttemptedAt: 0, triviaNextRetryAt: 0, triviaRetryLevel: 0 });
          }
          for (const key of FIELDS) if (typeof merged[key] !== 'string') merged[key] = '';
          merged.updatedAt = now();
          catalog.entries[candidate.date] = merged;
          changed.push(candidate.date);
        }
        if (current) {
          let status = 'failed';
          if (!failed) {
            if (source === 'imageOfTheDay') status = candidates(source, payload, catalog, logger).some(entry => entry.date === captured.date) ? 'success' : 'missing';
            else if (source === 'model') status = candidates(source, payload, catalog, logger).some(entry => entry.date === captured.date && entry.metadataStage === 'media') ? 'success' : 'missing';
            else status = P.validateSourceCoverage('archive', payload, captured.date, Object.values(catalog.entries)).status;
          }
          const prior = catalog.refreshState.sources[source];
          catalog.refreshState.sources[source] = status === 'success'
            ? { ...emptySource(), status, attemptedAt: now() }
            : { ...nextRetry(prior, now()), status };
          const archive = catalog.refreshState.sources.archive;
          if (source !== 'archive' && archive.status === 'success' && beforeWindow !== windowIdentity(catalog)) {
            catalog.refreshState.sources.archive = { ...emptySource(), status: 'missing' };
          }
        }
        if (current || changed.length) await save(catalog, changed);
      });
      scheduleTrivia();
    }

    async function runTrivia(entry, epoch) {
      let data, failed = false;
      try {
        const response = await fetch('https://www.bing.com/hp/api/v1/trivia?format=json&id=' + encodeURIComponent(entry.triviaId) + '&mkt=zh-CN');
        if (!response.ok) throw Error('Trivia HTTP ' + response.status);
        const payload = await response.json();
        if (!payload || !Object.hasOwn(payload, 'data')) throw Error('Invalid Trivia response');
        data = payload.data;
      } catch (_) { failed = true; }
      await serialized(async () => {
        const catalog = await readCatalog();
        if (inactive || epoch !== contextEpoch || !catalog) return;
        const latest = catalog.entries[entry.date];
        if (!P.admitTriviaResult(latest, entry.triviaId)) return;
        catalog.entries[entry.date] = P.applyTriviaResult(latest, entry.triviaId, { success: !failed, data }, now());
        await save(catalog, [entry.date]);
      });
    }
    function scheduleTrivia() {
      triviaScan = triviaScan.then(async () => {
        const catalog = await readCatalog();
        if (!catalog || inactive) return;
        for (const entry of Object.values(catalog.entries).sort((a, b) => b.date.localeCompare(a.date))) {
          if (triviaInFlight.size >= 2) break;
          if (entry.date > catalog.refreshState.date || entry.date < P.addDays(catalog.refreshState.date, -7) || !entry.triviaId || entry.triviaState === 'complete' || entry.triviaNextRetryAt > now() || triviaInFlight.has(entry.triviaId) || triviaCommitFailures.has(entry.triviaId)) continue;
          const task = runTrivia(entry, contextEpoch);
          triviaInFlight.set(entry.triviaId, task);
          const release = () => {
            if (triviaInFlight.get(entry.triviaId) !== task) return false;
            triviaInFlight.delete(entry.triviaId);
            return true;
          };
          task.then(() => { if (release()) scheduleTrivia(); }, error => {
            if (!release()) return;
            triviaCommitFailures.add(entry.triviaId);
            logger.warn('Trivia commit failed', error);
          });
        }
      }).catch(error => logger.warn('Trivia scan failed', error));
    }

    function refresh({ reconnect = false, followup = false } = {}) {
      if (cleanupTask) return cleanupTask.then(() => refresh({ reconnect }));
      const date = P.getZhCnTargetDate(new Date(now()));
      if (reconnect && !followup && reconnectFollowups.has(date)) return reconnectFollowups.get(date);
      if (refreshes.has(date)) {
        const active = refreshes.get(date);
        if (!reconnect || activeReconnects.has(date)) return active;
        const epoch = contextEpoch;
        const pending = active.catch(() => {}).then(() => epoch === contextEpoch ? refresh({ reconnect: true, followup: true }) : { ok: true, inactive: true });
        reconnectFollowups.set(date, pending);
        const clearPending = () => { if (reconnectFollowups.get(date) === pending) reconnectFollowups.delete(date); };
        pending.then(clearPending, clearPending);
        return pending;
      }
      triviaCommitFailures.clear();
      const task = (async () => {
        if (inactive) {
          if (!(await chrome.windows.getAll()).some(window => window.incognito)) return { ok: true, inactive: true };
          inactive = false;
        }
        const epoch = contextEpoch;
        await chrome.storage.sync.get(['enable_uhd_wallpaper', 'qotd_url']);
        const prepared = await serialized(async () => {
          if (inactive || epoch !== contextEpoch) return null;
          let catalog = await readCatalog();
          if (!catalog || catalog.version !== 2) catalog = { version: 2, updatedAt: 0, refreshState: { date: '', generation: 0, cachedFutureDepth: 0, sources: sourceStates(), imageFailures: {} }, entries: {} };
          let dirty = false;
          if (catalog.refreshState.date !== date) {
            catalog.refreshState = { ...catalog.refreshState, date, generation: catalog.refreshState.generation + 1, cachedFutureDepth: 0, sources: sourceStates() };
            dirty = true;
          }
          const sources = Object.keys(SOURCE_URLS).filter(name => {
            const value = catalog.refreshState.sources[name];
            if (value.status === 'success' || !canRetry(value, now(), reconnect)) return false;
            if (now() < value.nextRetryAt) { value.lastReconnectBypassAt = now(); dirty = true; }
            return true;
          });
          if (dirty) await save(catalog);
          return { date, generation: catalog.refreshState.generation, sources, epoch };
        });
        if (!prepared) return { ok: true, inactive: true };
        const sourceTasks = {};
        for (const source of prepared.sources) sourceTasks[source] = (async () => {
          let payload, failed = false;
          try {
            const response = await fetch(SOURCE_URLS[source], { cache: 'no-store' });
            if (!response.ok) throw Error('Metadata HTTP ' + response.status);
            payload = await response.json();
          } catch (_) { failed = true; }
          // Archive validates the matching IOTD window; transport still starts in parallel.
          if (source === 'archive' && sourceTasks.imageOfTheDay) await sourceTasks.imageOfTheDay;
          await commitSource(source, payload, prepared, failed);
        })();
        await Promise.all(Object.values(sourceTasks));
        scheduleTrivia();
        return { ok: true, contextId, date };
      })();
      refreshes.set(date, task);
      if (reconnect) activeReconnects.add(date);
      const clear = () => { if (refreshes.get(date) === task) { refreshes.delete(date); activeReconnects.delete(date); } };
      task.then(clear, clear);
      return task;
    }

    function cleanupIncognito() {
      if (contextId !== 'incognito') return Promise.resolve(false);
      if (cleanupTask) return cleanupTask;
      const task = serialized(async () => {
        // Recheck inside the write queue: another private window may have opened.
        if ((await chrome.windows.getAll()).some(window => window.incognito)) return false;
        if (contextId === 'incognito') {
          inactive = true;
          contextEpoch++;
          refreshes.clear();
          reconnectFollowups.clear();
          activeReconnects.clear();
          triviaInFlight.clear();
          triviaCommitFailures.clear();
        }
        const privateKeys = contextKeys('incognito');
        await chrome.storage.local.remove([privateKeys.catalog, privateKeys.quotes, privateKeys.quoteLease, privateKeys.display]);
        await caches.delete(privateKeys.cache);
        return true;
      });
      cleanupTask = task;
      const clear = () => { if (cleanupTask === task) cleanupTask = null; };
      task.then(clear, clear);
      return task;
    }

    function install(eventTarget) {
      const trigger = options => { refresh(options).catch(error => logger.warn('Catalog refresh failed', error)); };
      if (contextId === 'incognito') chrome.windows?.onRemoved.addListener(() => { cleanupIncognito().catch(error => logger.warn('Incognito cleanup failed', error)); });
      chrome.runtime.onInstalled.addListener(() => trigger());
      chrome.runtime.onStartup.addListener(() => trigger());
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== 'refreshWallpaperCatalog') return false;
        refresh({ reconnect: message.reason === 'reconnect' }).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
        return true;
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && ('enable_uhd_wallpaper' in changes || 'qotd_url' in changes)) trigger();
      });
      eventTarget?.addEventListener('online', () => trigger({ reconnect: true }));
    }
    return {
      refresh, install, cleanupIncognito, keys, contextId,
      get epoch() { return contextEpoch; },
      runContextWrite(epoch, work) {
        return serialized(() => inactive || epoch !== contextEpoch ? false : work());
      }
    };
  }
  return { createCatalogWorker, contextKeys };
});
