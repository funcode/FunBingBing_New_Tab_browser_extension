/**
 * Date helpers for PLAN9 wallpaper pipeline.
 * All dates are in YYYYMMDD format for the zh-CN market (Asia/Shanghai timezone).
 */

const BING_MARKET = "zh-CN";
const BING_MARKET_TIME_ZONE = "Asia/Shanghai";

/**
 * Get the target date for the zh-CN Bing market: the Asia/Shanghai date of a
 * moment, regardless of process timezone.
 * @param {Date} [now] - The moment; defaults to the current time
 * @returns {string} Date in YYYYMMDD format
 */
export function getZhCnTargetDate(now = new Date()) {

  // Format date in Asia/Shanghai timezone
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BING_MARKET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;

  return `${year}${month}${day}`;
}

/**
 * Validate that a YYYYMMDD string is a real calendar date.
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isValidCalendarDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{8}$/.test(dateStr)) {
    return false;
  }
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(4, 6));
  const day = Number(dateStr.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

/**
 * Format a YYYYMMDD date string for display as YYYY/MM/DD.
 * Does not construct a Date object or perform timezone conversion.
 * @param {string} dateStr - Date in YYYYMMDD format
 * @returns {string} Date in YYYY/MM/DD format
 */
export function formatDateForDisplay(dateStr) {
  if (typeof dateStr !== 'string' || dateStr.length !== 8) {
    throw new Error('Invalid date format: expected YYYYMMDD');
  }

  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);

  return `${year}/${month}/${day}`;
}

/**
 * Add days to a YYYYMMDD date string.
 * @param {string} dateStr - Date in YYYYMMDD format
 * @param {number} days - Number of days to add (can be negative)
 * @returns {string} New date in YYYYMMDD format
 */
export function addDays(dateStr, days) {
  if (typeof dateStr !== 'string' || dateStr.length !== 8) {
    throw new Error('Invalid date format: expected YYYYMMDD');
  }

  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(4, 6), 10) - 1; // 0-indexed
  const day = parseInt(dateStr.slice(6, 8), 10);

  const date = new Date(Date.UTC(year, month, day));
  date.setUTCDate(date.getUTCDate() + days);

  const newYear = date.getUTCFullYear();
  const newMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const newDay = String(date.getUTCDate()).padStart(2, '0');

  return `${newYear}${newMonth}${newDay}`;
}
