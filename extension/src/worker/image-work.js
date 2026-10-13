/**
 * Pure image-work derivation for the service-worker image scheduler. The work
 * list is rebuilt from the catalog on every qualifying event; no URL list or
 * cursor is persisted.
 */

import { addDays, isValidCalendarDate } from '../helpers/date.js';

const HISTORY_DAYS = 7;
const FUTURE_DAYS = 7;

function finalUrlOf(entry, enableUhd) {
  return enableUhd ? entry.urls.ultraHighDef : entry.urls.highDef;
}

function phaseWork(phase, entries, enableUhd) {
  return [
    ...entries.map(entry => ({ phase, date: entry.date, url: entry.urls.preview })),
    ...entries.map(entry => ({ phase, date: entry.date, url: finalUrlOf(entry, enableUhd) }))
  ];
}

/**
 * Ordered image work for the catalog's target date: target preview and final,
 * historical previews then finals, future previews then finals. History and
 * future run nearest date first. History never depends on Model; future
 * entries only exist once Model contributed them.
 *
 * @param {Object} catalog - Normalized v2 catalog
 * @param {boolean} enableUhd - Whether the configured final resolution is UHD
 * @returns {Array<{phase: 'target'|'history'|'future', date: string, url: string}>}
 */
export function deriveImageWork(catalog, enableUhd) {
  const targetDate = catalog.refreshState.date;
  if (!isValidCalendarDate(targetDate)) {
    return [];
  }
  const entriesAt = offsets => offsets
    .map(offset => catalog.entries[addDays(targetDate, offset)])
    .filter(entry => entry && entry.urls);
  const range = (from, count, step) => Array.from({ length: count }, (_, i) => from + i * step);

  return [
    ...phaseWork('target', entriesAt([0]), enableUhd),
    ...phaseWork('history', entriesAt(range(-1, HISTORY_DAYS, -1)), enableUhd),
    ...phaseWork('future', entriesAt(range(1, FUTURE_DAYS, 1)), enableUhd)
  ];
}
