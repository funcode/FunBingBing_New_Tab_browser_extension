/**
 * Image task deduplication helpers for PLAN9.
 * One canonical URL has at most one pending or active task.
 * Urgent navigation promotes an existing pending task to the front.
 */

/**
 * Task priority levels.
 */
export const TASK_PRIORITY = {
  URGENT: 0,   // Current display or explicit navigation request
  NORMAL: 1    // Background prefetch
};

/**
 * Determine whether a new task should be created or an existing one promoted.
 * Returns an action descriptor — callers are responsible for mutating the queue.
 *
 * @param {Map<string, {priority: number, active: boolean}>} taskMap - Current task map
 * @param {string} canonicalUrl - Canonical image URL
 * @param {boolean} urgent - Whether this is an urgent request
 * @returns {'noop'|'create'|'promote'} What to do
 */
export function resolveImageTaskAction(taskMap, canonicalUrl, urgent) {
  const existing = taskMap.get(canonicalUrl);

  if (!existing) {
    return 'create';
  }

  // Task already exists — promote if urgent and not already urgent
  if (urgent && existing.priority !== TASK_PRIORITY.URGENT) {
    return 'promote';
  }

  return 'noop';
}

/**
 * Check whether an active fetch's response should be cached.
 * A response is only cached when its canonical URL still belongs to the
 * latest retention set (image-generation changes stop old queue dispatch).
 *
 * @param {string} canonicalUrl - The URL that was fetched
 * @param {Set<string>} latestRetentionSet - Retention set at commit time
 * @returns {boolean}
 */
export function shouldCacheFetchResponse(canonicalUrl, latestRetentionSet) {
  if (!canonicalUrl || !latestRetentionSet) {
    return false;
  }
  return latestRetentionSet.has(canonicalUrl);
}
