/**
 * Pure v2 catalog logic for the service worker: source parsing, candidate
 * admission, date rollover and trivia derivation. No chrome.*, DOM or Cache
 * Storage access, so it runs under Node tests.
 */

import { addDays, isValidCalendarDate } from '../helpers/date.js';
import { buildCanonicalUrls, extractImageId, isValidImageIdentity } from '../helpers/image.js';
import { compareMetadataStages, mergeMetadata } from '../helpers/metadata.js';
import {
  canBypassWithReconnect,
  createRetryObject,
  hasUnusedReconnectBypass,
  isRetryEligible,
  recordFailure
} from '../helpers/retry.js';
import { conflictsWithDisplayedIdentity } from '../helpers/stale-work.js';
import {
  canAdmitTriviaResult,
  createInitialTriviaState,
  isValidTriviaState,
  normalizeTriviaId
} from '../helpers/trivia.js';

export const SOURCES = Object.freeze(['imageOfTheDay', 'model', 'archive']);

const HISTORY_DAYS = 7;
const FUTURE_DAYS = 7;

function createSourceState() {
  return { status: 'missing', ...createRetryObject() };
}

export function createEmptyCatalog() {
  return {
    version: 2,
    updatedAt: 0,
    refreshState: {
      date: '',
      generation: 0,
      cachedFutureDepth: 0,
      sources: Object.fromEntries(SOURCES.map(source => [source, createSourceState()])),
      imageFailures: {}
    },
    entries: {}
  };
}

/**
 * Return a usable catalog from a stored value, replacing anything that is not
 * a v2 catalog and filling missing source states.
 */
export function normalizeCatalog(stored) {
  if (!stored || stored.version !== 2 || !stored.refreshState ||
      !stored.entries || typeof stored.entries !== 'object') {
    return createEmptyCatalog();
  }
  const refreshState = stored.refreshState;
  refreshState.sources = refreshState.sources || {};
  for (const source of SOURCES) {
    if (!refreshState.sources[source]) {
      refreshState.sources[source] = createSourceState();
    }
  }
  refreshState.imageFailures = refreshState.imageFailures || {};
  return stored;
}

function isWithinWindow(date, targetDate) {
  return isValidCalendarDate(targetDate) &&
    date >= addDays(targetDate, -HISTORY_DAYS) && date <= addDays(targetDate, FUTURE_DAYS);
}

/**
 * Advance the catalog to a newer target date: increment the refresh generation,
 * rebuild the three source states and drop the entries outside the new
 * target/history/future window, so at most 15 dates remain. Image failure
 * records are left to cache cleanup. Older or equal dates leave the catalog
 * unchanged.
 *
 * @returns {boolean} True when the catalog was rolled
 */
export function rollToTargetDate(catalog, targetDate) {
  const refreshState = catalog.refreshState;
  if (!isValidCalendarDate(targetDate) || targetDate <= refreshState.date) {
    return false;
  }
  refreshState.date = targetDate;
  refreshState.generation += 1;
  refreshState.sources = Object.fromEntries(SOURCES.map(source => [source, createSourceState()]));
  for (const date of Object.keys(catalog.entries)) {
    if (!isWithinWindow(date, targetDate)) {
      delete catalog.entries[date];
    }
  }
  return true;
}

function stringFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => typeof value === 'string' && value !== '')
  );
}

function buildCandidate(date, imageUrl, fields, metadataStage) {
  const imageId = isValidCalendarDate(date) ? extractImageId(imageUrl) : null;
  if (!imageId) {
    return null;
  }
  return { date, imageId, urls: buildCanonicalUrls(imageId), ...stringFields(fields), metadataStage };
}

function parseImageOfTheDay(response) {
  const images = response?.data?.images;
  return (Array.isArray(images) ? images : []).map(image => {
    const landscape = image?.imageUrls?.landscape;
    return buildCandidate(image?.isoDate, landscape?.highDef || landscape?.ultraHighDef, {
      caption: image.caption,
      title: image.title,
      description: image.description,
      descriptionPara2: image.descriptionPara2,
      descriptionPara3: image.descriptionPara3,
      copyright: image.copyright,
      clickUrl: image.clickUrl
    }, 'iotd');
  });
}

function parseModelItems(items, metadataStage) {
  return (Array.isArray(items) ? items : []).map(item => {
    const content = item?.ImageContent;
    return buildCandidate(item?.Ssd, content?.Image?.Url, {
      title: content?.Title,
      headline: content?.Headline,
      description: content?.Description,
      copyright: content?.Copyright,
      quickFact: content?.QuickFact?.MainText,
      triviaId: content?.TriviaId,
      backstageUrl: content?.BackstageUrl
    }, metadataStage);
  });
}

function parseModel(response) {
  return [
    ...parseModelItems(response?.MediaContents, 'media'),
    ...parseModelItems(response?.PreloadMediaContents, 'preload')
  ];
}

// Archive `quiz` is a search URL carrying the ID in a WQOskey filter.
function parseArchiveTriviaId(quiz, date, log) {
  if (typeof quiz !== 'string' || quiz === '') {
    return '';
  }
  let raw = quiz;
  try {
    raw = decodeURIComponent(quiz);
  } catch {
    // Keep the undecoded value; validation below rejects it if malformed.
  }
  const keyed = raw.match(/WQOskey:"([^"]*)"/);
  const triviaId = normalizeTriviaId(keyed ? keyed[1] : raw, date);
  if (!triviaId) {
    log.warn('[catalog] Discarding malformed Archive trivia ID', { date, quiz });
    return '';
  }
  return triviaId;
}

function parseArchive(response, log) {
  const images = response?.images;
  return (Array.isArray(images) ? images : []).map(image => {
    const candidate = buildCandidate(image?.enddate, image?.urlbase || image?.url, {
      headline: image?.title,
      copyright: image?.copyright
    }, 'archive');
    if (candidate) {
      const triviaId = parseArchiveTriviaId(image.quiz, candidate.date, log);
      if (triviaId) {
        candidate.triviaId = triviaId;
      }
    }
    return candidate;
  });
}

/**
 * Convert a raw source response into catalog candidates. Invalid items are skipped.
 * @param {'imageOfTheDay'|'model'|'archive'} source
 */
export function parseSourceCandidates(source, response, log = console) {
  const parsers = {
    imageOfTheDay: parseImageOfTheDay,
    model: parseModel,
    archive: response => parseArchive(response, log)
  };
  return parsers[source](response).filter(Boolean);
}

// Stale work may only fill empty fields of the same identity; it never
// overwrites a value or raises metadataStage. Filled fields keep their stage.
function fillMissingFields(current, candidate) {
  const next = { ...current, fieldStages: { ...current.fieldStages } };
  for (const [key, value] of Object.entries(candidate)) {
    if (key === 'metadataStage' || isFilled(current[key]) || !isFilled(value)) {
      continue;
    }
    next[key] = value;
    if (candidate.metadataStage !== current.metadataStage) {
      next.fieldStages[key] = candidate.metadataStage;
    }
  }
  if (Object.keys(next.fieldStages).length === 0) {
    delete next.fieldStages;
  }
  return next;
}

function isFilled(value) {
  return value !== undefined && value !== null && value !== '';
}

function isEqualIgnoringUpdatedAt(a, b) {
  const normalize = value => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().filter(key => key !== 'updatedAt')
      .map(key => [key, normalize(value[key])]);
  };
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/**
 * Admit candidates into the catalog in place.
 *
 * - Candidates outside the target/history/future window are ignored.
 * - Archive only supplements an existing entry with the same date and imageId.
 * - Current-generation candidates merge with the same identity, or replace a
 *   different identity when their metadata stage is not lower.
 * - Stale (older generation) candidates may only supplement the same identity or
 *   add a missing historical, non-displayed date. A stale candidate whose date
 *   matches the displayed date with a different imageId is dropped entirely;
 *   other candidates in the batch are still considered.
 *
 * @returns {{changedDates: string[]}}
 */
export function admitCandidates(catalog, candidates, { stale, displayState, now }) {
  const targetDate = catalog.refreshState.date;
  const changedDates = [];

  for (const candidate of candidates) {
    if (!isWithinWindow(candidate.date, targetDate)) {
      continue;
    }
    const current = catalog.entries[candidate.date];
    const sameIdentity = Boolean(current) && current.imageId === candidate.imageId;

    if (!sameIdentity) {
      if (candidate.metadataStage === 'archive') {
        continue;
      }
      if (stale) {
        if (current || candidate.date >= targetDate || candidate.date === displayState?.date) {
          continue;
        }
      } else if (current && compareMetadataStages(candidate.metadataStage, current.metadataStage) < 0) {
        continue;
      }
    }
    if (stale && conflictsWithDisplayedIdentity(candidate, displayState)) {
      continue;
    }

    let next;
    if (!sameIdentity) {
      next = { ...candidate, triviaId: candidate.triviaId || '', triviaData: null, ...createInitialTriviaState() };
    } else if (stale) {
      next = fillMissingFields(current, candidate);
    } else {
      next = mergeMetadata(current, candidate);
    }
    if (current && isEqualIgnoringUpdatedAt(current, next)) {
      continue;
    }
    next.updatedAt = now;
    catalog.entries[candidate.date] = next;
    if (!changedDates.includes(candidate.date)) {
      changedDates.push(candidate.date);
    }
  }

  return { changedDates };
}

const LEGACY_IMPORT_DATES = 8;

function isTriviaPayload(data) {
  return Boolean(data) && typeof data === 'object' && isFilled(data.question) && Array.isArray(data.options);
}

// A v1 `bing_images` item as a legacy entry, or null when its date or image
// identity is invalid. A valid trivia payload keeps its completion.
function legacyEntry(image) {
  const landscape = image?.imageUrls?.landscape;
  const candidate = buildCandidate(image?.isoDate, landscape?.highDef || landscape?.ultraHighDef, {
    caption: image.caption,
    title: image.title,
    headline: image.headline,
    description: image.description,
    descriptionPara2: image.descriptionPara2,
    descriptionPara3: image.descriptionPara3,
    copyright: image.copyright,
    clickUrl: image.clickUrl,
    quickFact: image.quickFact
  }, 'legacy');
  if (!candidate) {
    return null;
  }
  const complete = isTriviaPayload(image.triviaData);
  return {
    ...candidate,
    triviaId: normalizeTriviaId(image.triviaId, candidate.date) || '',
    ...createInitialTriviaState(),
    triviaData: complete ? image.triviaData : null,
    triviaState: complete ? 'complete' : 'missing'
  };
}

/**
 * Whether a stored entry is usable under its date key: its date, image
 * identity and canonical URLs agree, and its trivia state is a persisted one.
 */
export function isValidCatalogEntry(entry, date) {
  if (!entry || typeof entry !== 'object' || entry.date !== date || !isValidCalendarDate(date) ||
      !isValidImageIdentity(entry.imageId) || !isValidTriviaState(entry.triviaState)) {
    return false;
  }
  const urls = buildCanonicalUrls(entry.imageId);
  return entry.urls?.preview === urls.preview && entry.urls.highDef === urls.highDef &&
    entry.urls.ultraHighDef === urls.ultraHighDef;
}

// Recover one entry into the catalog in place. A valid entry of another
// identity is kept; the same identity only gains its empty metadata fields,
// and a missing trivia payload is completed only from a valid payload of the
// same trivia ID; a missing or invalid entry is replaced. Returns whether the
// entry changed.
function recoverEntry(catalog, recovered, now) {
  const current = catalog.entries[recovered.date];
  const valid = isValidCatalogEntry(current, recovered.date);
  let next = recovered;
  if (valid) {
    if (current.imageId !== recovered.imageId) {
      return false;
    }
    // Trivia state and stage bookkeeping belong to the existing entry.
    const {
      triviaData, triviaState, triviaAttemptedAt, triviaNextRetryAt, triviaRetryLevel,
      triviaLastReconnectBypassAt, fieldStages, updatedAt, ...metadata
    } = recovered;
    next = fillMissingFields(current, metadata);
    if (next.triviaState === 'missing' && next.triviaId && next.triviaId === recovered.triviaId &&
        triviaState === 'complete' && isTriviaPayload(triviaData)) {
      next = { ...next, triviaData, triviaState: 'complete', triviaRetryLevel: 0, triviaNextRetryAt: 0 };
    }
    if (isEqualIgnoringUpdatedAt(current, next)) {
      return false;
    }
  }
  catalog.entries[recovered.date] = { ...next, updatedAt: now };
  return true;
}

/**
 * Merge the newest eight valid dates of the v1 `bing_images` array into the
 * catalog in place, as `legacy` entries. Valid v2 data is never replaced.
 * Once the catalog has a target date, dates outside its window are skipped,
 * so a resumed migration does not restore dates a rollover dropped.
 *
 * @param {Object} catalog
 * @param {*} images - Stored v1 `bing_images` value
 * @param {number} now
 * @returns {{dates: string[], changedDates: string[]}} The imported dates, and
 *   those whose entry changed
 */
export function importLegacyImages(catalog, images, now) {
  const targetDate = catalog.refreshState.date;
  const byDate = new Map();
  for (const entry of (Array.isArray(images) ? images : []).map(legacyEntry)) {
    if (entry && !byDate.has(entry.date) &&
        (!isValidCalendarDate(targetDate) || isWithinWindow(entry.date, targetDate))) {
      byDate.set(entry.date, entry);
    }
  }
  const dates = [...byDate.keys()].sort().reverse().slice(0, LEGACY_IMPORT_DATES);
  const changedDates = dates.filter(date => recoverEntry(catalog, byDate.get(date), now));
  return { dates, changedDates };
}

// Target and historical entries with a trivia ID and a missing payload.
function missingTriviaEntries(catalog) {
  const targetDate = catalog.refreshState.date;
  if (!isValidCalendarDate(targetDate)) {
    return [];
  }
  const oldestDate = addDays(targetDate, -HISTORY_DAYS);
  return Object.values(catalog.entries).filter(entry => entry.date >= oldestDate &&
    entry.date <= targetDate && entry.triviaId && entry.triviaState === 'missing');
}

// An entry's trivia fields as a retry object.
function triviaRetryOf(entry) {
  return {
    attemptedAt: entry.triviaAttemptedAt || 0,
    nextRetryAt: entry.triviaNextRetryAt || 0,
    retryLevel: entry.triviaRetryLevel || 0,
    lastReconnectBypassAt: entry.triviaLastReconnectBypassAt || 0
  };
}

/**
 * Record a reconnect bypass, in place, for each missing trivia payload whose
 * active backoff window has not been bypassed yet. The level is kept.
 *
 * @returns {boolean} True when a bypass was recorded
 */
export function recordTriviaReconnect(catalog, now, reconnectTime) {
  let changed = false;
  for (const entry of missingTriviaEntries(catalog)) {
    if (canBypassWithReconnect(triviaRetryOf(entry), now, reconnectTime)) {
      entry.triviaLastReconnectBypassAt = reconnectTime;
      changed = true;
    }
  }
  return changed;
}

/**
 * Trivia work derived only from the committed catalog: target and historical
 * entries with a trivia ID, missing payload, and an expired retry window or a
 * reconnect bypass whose attempt has not recorded a result.
 *
 * @returns {Array<{date: string, triviaId: string}>} Newest first
 */
export function deriveTriviaCandidates(catalog, now) {
  return missingTriviaEntries(catalog)
    .filter((entry) => {
      const retry = triviaRetryOf(entry);
      return isRetryEligible(retry, now) || hasUnusedReconnectBypass(retry);
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(entry => ({ date: entry.date, triviaId: entry.triviaId }));
}

/**
 * Apply one trivia result in place. The date only locates the latest entry;
 * the result applies only while that entry still carries the same triviaId,
 * whatever the refresh generation. Success stores the payload as complete and
 * resets the retry sequence; failure keeps the entry missing and backs off.
 *
 * @param {Object} catalog
 * @param {{date: string, triviaId: string, ok: boolean, data?: Object|null}} result
 * @param {number} now
 * @returns {{changed: boolean, changedDates?: string[]}}
 */
export function applyTriviaResult(catalog, { date, triviaId, ok, data }, now) {
  const entry = catalog.entries[date];
  if (!canAdmitTriviaResult(entry, triviaId)) {
    return { changed: false };
  }
  if (ok) {
    entry.triviaData = data ?? null;
    entry.triviaState = 'complete';
    entry.triviaRetryLevel = 0;
    entry.triviaNextRetryAt = 0;
  } else {
    const retry = recordFailure(triviaRetryOf(entry), now);
    entry.triviaRetryLevel = retry.retryLevel;
    entry.triviaNextRetryAt = retry.nextRetryAt;
  }
  entry.triviaAttemptedAt = now;
  entry.updatedAt = now;
  // Only a new payload changes what pages render.
  return { changed: true, changedDates: ok ? [date] : [] };
}
