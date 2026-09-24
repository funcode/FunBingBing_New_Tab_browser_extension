(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PLAN9Pure = api;
})(globalThis, function () {
  'use strict';

  const IMAGE_SUFFIXES = ['_640x360.jpg', '_1920x1080.jpg', '_UHD.jpg'];
  const SOURCE_SUFFIXES = [...IMAGE_SUFFIXES, ...IMAGE_SUFFIXES.map(suffix => suffix.replace('.jpg', '.webp'))];
  const STAGES = { legacy: 0, archive: 1, preload: 2, media: 3, iotd: 4 };
  const RETRY_DELAYS_MS = [60_000, 180_000, 300_000];
  const CACHE_ORIGIN = 'https://ts1.tc.mm.bing.net';

  function getZhCnTargetDate(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const part = (type) => parts.find((item) => item.type === type).value;
    return part('year') + part('month') + part('day');
  }

  function normalizeImageId(value) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError('Image URL or identity is required');
    let id = value.trim();
    if (/^https?:\/\//i.test(id) || id.startsWith('/')) {
      let url;
      try { url = new URL(id, CACHE_ORIGIN); } catch (_) { throw new TypeError('Malformed image URL'); }
      id = url.searchParams.get('id') || '';
    }
    if (!id.startsWith('OHR.')) throw new TypeError('Image identity must start with OHR.');
    const suffix = SOURCE_SUFFIXES.find((item) => id.endsWith(item));
    if (suffix) id = id.slice(0, -suffix.length);
    else if (/_(?:\d+x\d+|UHD)\.[A-Za-z0-9]+$/i.test(id)) throw new TypeError('Unsupported image suffix');
    if (!/^OHR\.[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new TypeError('Malformed image identity');
    return id;
  }

  function canonicalImageUrl(image, suffix) {
    const identity = normalizeImageId(image);
    if (!IMAGE_SUFFIXES.includes(suffix)) throw new TypeError('Unsupported canonical image suffix');
    return CACHE_ORIGIN + '/th?id=' + encodeURIComponent(identity + suffix);
  }

  function getCanonicalImageUrls(image) {
    return Object.fromEntries(IMAGE_SUFFIXES.map((suffix) => [suffix, canonicalImageUrl(image, suffix)]));
  }

  function mergeMetadata(current, candidate) {
    if (!getEntryIdentity(candidate) || !Object.hasOwn(STAGES, candidate.metadataStage)) return current || null;
    const rank = STAGES[candidate.metadataStage];
    const priorRank = STAGES[current?.metadataStage] ?? -1;
    if (current && current.date !== candidate.date) return current;
    const sameIdentity = current?.imageId === candidate.imageId;
    if (current && !sameIdentity && rank < priorRank) return current;
    const merged = sameIdentity ? { ...current } : { date: candidate.date, imageId: candidate.imageId };
    // Per-field provenance preserves priority when a higher-stage source omits a field.
    const fieldStages = sameIdentity ? { ...current._fieldStages } : {};
    const stateFields = new Set(['metadataStage', '_fieldStages', 'triviaData', 'triviaState', 'triviaAttemptedAt', 'triviaNextRetryAt', 'triviaRetryLevel', 'updatedAt']);
    for (const [key, value] of Object.entries(candidate)) {
      if (stateFields.has(key) || value === undefined || value === null || (value === '' && key !== 'triviaId')) continue;
      const existingRank = fieldStages[key] ?? (merged[key] !== undefined && merged[key] !== null && merged[key] !== '' ? priorRank : -1);
      if (rank >= existingRank) { merged[key] = value; fieldStages[key] = rank; }
    }
    merged.metadataStage = sameIdentity && priorRank > rank ? current.metadataStage : candidate.metadataStage;
    merged._fieldStages = fieldStages;
    if (!sameIdentity || merged.triviaId !== current.triviaId) {
      merged.triviaData = null;
      merged.triviaState = 'missing';
      merged.triviaAttemptedAt = 0;
      merged.triviaNextRetryAt = 0;
      merged.triviaRetryLevel = 0;
    }
    return merged;
  }

  function getEntryIdentity(entry) {
    if (!entry || typeof entry !== 'object') return null;
    try {
      const date = entry.date || entry.isoDate || entry.Ssd || entry.enddate;
      const image = entry.imageId || entry.urlbase || entry.url || entry.imageUrls?.landscape?.highDef || entry.ImageContent?.Image?.Url;
      return isValidDate(date) ? { date, imageId: normalizeImageId(image) } : null;
    } catch (_) { return null; }
  }

  function validateSourceCoverage(source, response, targetDate, committedEntries = []) {
    if (!response || typeof response !== 'object') return { status: 'failed', entries: [] };
    if (source === 'iotd' || source === 'imageOfTheDay') {
      const images = Array.isArray(response.data?.images) ? response.data.images : [];
      const covered = images.some((item) => getEntryIdentity(item)?.date === targetDate);
      return { status: covered ? 'success' : 'missing', entries: images };
    }
    if (source === 'model') {
      const contents = Array.isArray(response.MediaContents) ? response.MediaContents : [];
      const covered = contents.some((item) => item?.Ssd === targetDate && getEntryIdentity({ date: item.Ssd, url: item.ImageContent?.Image?.Url }));
      return { status: covered ? 'success' : 'missing', entries: contents };
    }
    if (source === 'archive') {
      const catalog = Array.isArray(committedEntries) ? committedEntries : Object.values(committedEntries);
      const byDate = new Map(catalog.map((item) => [item.date, item]));
      for (let offset = 0; offset < 8; offset++) {
        const current = byDate.get(addDays(targetDate, -offset));
        if (current?.metadataStage !== 'iotd' || !getEntryIdentity(current)) return { status: 'missing', entries: [] };
      }
      const oldest = byDate.get(addDays(targetDate, -7));
      const matches = (Array.isArray(response.images) ? response.images : []).filter((item) => {
        const identity = getEntryIdentity({ date: item?.enddate, url: item?.urlbase || item?.url });
        return identity?.date === oldest.date && identity.imageId === oldest.imageId;
      });
      return { status: matches.length ? 'success' : 'missing', entries: matches };
    }
    return { status: 'failed', entries: [] };
  }

  function addDays(yyyymmdd, amount) {
    if (!isValidDate(yyyymmdd)) throw new TypeError('Expected YYYYMMDD date');
    const [year, month, day] = [yyyymmdd.slice(0, 4), yyyymmdd.slice(4, 6), yyyymmdd.slice(6, 8)].map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount));
    return date.toISOString().slice(0, 10).replaceAll('-', '');
  }

  function admitStaleCandidate(candidate, existing, displayState, candidateGeneration, currentGeneration, targetDate) {
    const identity = getEntryIdentity(candidate);
    if (!identity) return false;
    if (candidateGeneration === currentGeneration) return true;
    if (displayState && identity.date === displayState.date && identity.imageId !== displayState.imageId) return false;
    const prior = existing && getEntryIdentity(existing);
    if (prior) return prior.date === identity.date && prior.imageId === identity.imageId;
    return isValidDate(targetDate) && identity.date < targetDate && identity.date >= addDays(targetDate, -7) && identity.date !== displayState?.date;
  }

  function mergeStaleMetadata(current, candidate) {
    if (!current) return mergeMetadata(null, candidate);
    if (current.date !== candidate.date || current.imageId !== candidate.imageId) return current;
    const supplement = { date: candidate.date, imageId: candidate.imageId, metadataStage: current.metadataStage };
    for (const [key, value] of Object.entries(candidate)) {
      if (current[key] === undefined || current[key] === null || current[key] === '') supplement[key] = value;
    }
    const merged = mergeMetadata(current, supplement);
    for (const key of Object.keys(supplement)) {
      if (Object.hasOwn(merged._fieldStages, key) && !['date', 'imageId'].includes(key)) merged._fieldStages[key] = STAGES[candidate.metadataStage];
    }
    return merged;
  }

  function admitTriviaResult(entry, resultTriviaId) {
    return Boolean(entry && typeof entry.triviaId === 'string' && entry.triviaId.length > 0 && entry.triviaId === resultTriviaId);
  }

  function nextRetry(retry = {}, now = Date.now()) {
    const retryLevel = Math.min(3, Math.max(0, Number(retry.retryLevel) || 0) + 1);
    return { retryLevel, nextRetryAt: now + RETRY_DELAYS_MS[retryLevel - 1], attemptedAt: now, lastReconnectBypassAt: 0 };
  }

  function resetRetry() { return { retryLevel: 0, nextRetryAt: 0, attemptedAt: 0, lastReconnectBypassAt: 0 }; }

  function canRetry(retry = {}, now = Date.now(), reconnect = false) {
    if (!retry.nextRetryAt || now >= retry.nextRetryAt) return true;
    return reconnect && !retry.lastReconnectBypassAt;
  }

  function markReconnectBypass(retry = {}, now = Date.now()) {
    return { ...retry, lastReconnectBypassAt: now };
  }

  function applyTriviaResult(entry, triviaId, result, now) {
    if (!admitTriviaResult(entry, triviaId)) return entry;
    const retry = result.success ? resetRetry() : nextRetry({ retryLevel: entry.triviaRetryLevel }, now);
    return { ...entry, triviaData: result.success ? result.data ?? null : entry.triviaData ?? null,
      triviaState: result.success ? 'complete' : 'missing', triviaAttemptedAt: now,
      triviaNextRetryAt: retry.nextRetryAt, triviaRetryLevel: retry.retryLevel, updatedAt: now };
  }

  function grantQuoteLease(current, now, generateToken) {
    if (current?.leaseUntil > now || !canRetry(current || {}, now)) return null;
    const token = typeof generateToken === 'function' ? generateToken() : generateToken;
    if (typeof token !== 'string' || !token) throw new TypeError('Lease token is required');
    return { token, leaseUntil: now + 60_000 };
  }

  function acceptsQuoteLease(current, token, now) {
    return Boolean(current && current.token === token && current.leaseUntil > now);
  }

  function normalizeTriviaId(value, isoDate) {
    if (value == null || value === '') return '';
    if (typeof value !== 'string' || !/^HPQuiz_\d{8}_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || !isValidDate(value.slice(7, 15)) || /(?:^|_)\d{8}(?:_|$)/.test(value.slice(16))) return '';
    if (!/^\d{8}$/.test(isoDate) || !isValidDate(isoDate)) return '';
    return value.slice(0, 7) + isoDate + value.slice(15);
  }

  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;
    const y = Number(value.slice(0, 4)), m = Number(value.slice(4, 6)), d = Number(value.slice(6, 8));
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }

  function getRetentionKeys(targetDate, finalSuffix, displayState, entries = {}) {
    if (!IMAGE_SUFFIXES.includes(finalSuffix)) throw new TypeError('Invalid retention options');
    const futureDays = 7;
    const keys = new Set();
    for (let offset = -7; offset <= futureDays; offset++) {
      const date = addDays(targetDate, offset);
      const entry = entries[date];
      if (!entry) continue;
      const urls = getCanonicalImageUrls(entry.imageId);
      keys.add(urls['_640x360.jpg']);
      keys.add(urls[finalSuffix]);
    }
    if (validateDisplayState(displayState)) {
      keys.add(displayState.url);
      keys.add(canonicalImageUrl(displayState.imageId, '_640x360.jpg'));
    }
    return [...keys];
  }

  function cachedFutureDepth(targetDate, isCached, finalSuffix = '_1920x1080.jpg') {
    const max = 7;
    let depth = 0;
    while (depth < max) {
      const date = addDays(targetDate, depth + 1);
      if (!isCached(date, '_640x360.jpg') || !isCached(date, finalSuffix)) break;
      depth++;
    }
    return depth;
  }

  function navigationIndex(entries, displayDate) {
    return Array.isArray(entries) ? entries.findIndex((entry) => entry && entry.date === displayDate) : -1;
  }

  function validateDisplayState(state) {
    if (!state || !isValidDate(state.date) || typeof state.preloadDataUrl !== 'string' || !Number.isFinite(state.updatedAt)) return false;
    if (state.preloadDataUrl && !state.preloadDataUrl.startsWith('data:image/')) return false;
    try {
      return normalizeImageId(state.imageId) === state.imageId &&
        ['_1920x1080.jpg', '_UHD.jpg'].some((suffix) => state.url === canonicalImageUrl(state.imageId, suffix));
    } catch (_) { return false; }
  }

  function selectSharedSetting(syncValue, localValue, isValid, defaultValue) {
    if (isValid(syncValue)) return syncValue;
    if (isValid(localValue)) return localValue;
    return defaultValue;
  }

  function isMigrationVerified(state) {
    return Boolean(state && state.catalogVerified && state.regularQuoteStateVerified && state.sharedSyncSettingsVerified);
  }

  function isMigrationComplete(state) {
    return Boolean(isMigrationVerified(state) && state.displayAcknowledged);
  }

  function deriveImageTasks(entries, targetDate, finalSuffix, displayState) {
    const byDate = new Map((entries || []).map((entry) => [entry.date, entry]));
    const history = [], future = [];
    for (let n = 1; n <= 7; n++) { const entry = byDate.get(addDays(targetDate, -n)); if (entry) history.push(entry); }
    for (let n = 1; n <= 7; n++) { const entry = byDate.get(addDays(targetDate, n)); if (entry) future.push(entry); }
    const tasks = [];
    const append = (entry, suffix) => tasks.push({ url: canonicalImageUrl(entry.imageId, suffix), date: entry.date });
    const target = byDate.get(targetDate);
    if (target) { append(target, '_640x360.jpg'); append(target, finalSuffix); }
    for (const suffix of ['_640x360.jpg', finalSuffix]) for (const entry of history) append(entry, suffix);
    for (const suffix of ['_640x360.jpg', finalSuffix]) for (const entry of future) append(entry, suffix);
    if (displayState && displayState.url) tasks.unshift({ url: displayState.url, date: displayState.date, urgent: true });
    return tasks;
  }

  function promoteImageTask(tasks, url) {
    const list = [...tasks];
    const index = list.findIndex((task) => task.url === url);
    if (index === 0) return list;
    const task = index >= 0 ? list.splice(index, 1)[0] : { url, urgent: true };
    list.unshift({ ...task, urgent: true });
    return list;
  }

  function canonicalizeImageTaskUrl(value) {
    const url = new URL(value, CACHE_ORIGIN);
    const id = url.searchParams.get('id') || '';
    const suffix = SOURCE_SUFFIXES.find((item) => id.endsWith(item));
    if (!suffix) throw new TypeError('Image task requires a supported resolution');
    return canonicalImageUrl(value, suffix.replace('.webp', '.jpg'));
  }

  function dedupeImageTasks(tasks) {
    const byUrl = new Map();
    for (const task of tasks || []) {
      const url = canonicalizeImageTaskUrl(task.url);
      const existing = byUrl.get(url);
      byUrl.set(url, existing ? { ...existing, urgent: Boolean(existing.urgent || task.urgent) } : { ...task, url });
    }
    return [...byUrl.values()].sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
  }

  function canDispatchImageTask(task, currentGeneration, cachedUrls, activeUrls) {
    return task.generation === currentGeneration && !cachedUrls.has(task.url) && !activeUrls.has(task.url);
  }

  function canWriteImageResponse(url, retentionSet) {
    return retentionSet.has(url);
  }

  return {
    addDays, admitStaleCandidate, admitTriviaResult, applyTriviaResult, acceptsQuoteLease, cachedFutureDepth,
    canonicalImageUrl, canonicalizeImageTaskUrl, canDispatchImageTask, canWriteImageResponse, canRetry, dedupeImageTasks, deriveImageTasks, getCanonicalImageUrls, markReconnectBypass,
    getEntryIdentity, getRetentionKeys, getZhCnTargetDate,
    grantQuoteLease, isMigrationComplete, isMigrationVerified, mergeMetadata, mergeStaleMetadata,
    navigationIndex, nextRetry, normalizeImageId, normalizeTriviaId, promoteImageTask,
    resetRetry, selectSharedSetting, validateDisplayState, validateSourceCoverage
  };
});
