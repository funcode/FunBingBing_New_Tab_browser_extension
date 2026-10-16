/**
 * Service-worker trivia fetcher: at most two requests at once, one per
 * complete triviaId. Work comes only from committed catalog entries, and each
 * result commits through the catalog's serial write queue. In-flight state is
 * kept in memory only, so a terminated worker leaves its entries `missing` and
 * retryable on the next qualifying event.
 */

const TRIVIA_CONCURRENCY = 2;

// A quiz payload has a question. Anything else in a successful response, such
// as Bing's empty-string "No content" data, is a failure that stays retryable.
function quizOf(response) {
  const data = response?.data;
  if (!data || typeof data !== 'object' || typeof data.question !== 'string') {
    throw new Error('Trivia response has no quiz payload');
  }
  return data;
}

/**
 * @param {Object} deps
 * @param {{commitTriviaResult: Function}} deps.catalogService
 * @param {(triviaId: string) => Promise<Object>} deps.fetchTrivia - Resolves the parsed
 *   trivia response; rejects on transport, HTTP or parsing failure
 * @param {{warn: Function}} [deps.log]
 */
export function createTriviaService({ catalogService, fetchTrivia, log = console }) {
  const inFlight = new Set();
  const running = new Set();
  let waiting = [];

  async function run({ date, triviaId }) {
    let result;
    try {
      result = { ok: true, data: quizOf(await fetchTrivia(triviaId)) };
    } catch (error) {
      log.warn(`[trivia] ${triviaId} request failed`, error);
      result = { ok: false };
    }
    try {
      await catalogService.commitTriviaResult({ date, triviaId, ...result });
    } catch (error) {
      log.warn(`[trivia] ${triviaId} result was not committed`, error);
    } finally {
      // Released only after the commit, so a new event cannot request it twice.
      inFlight.delete(triviaId);
      pump();
    }
  }

  function pump() {
    while (inFlight.size < TRIVIA_CONCURRENCY && waiting.length > 0) {
      const candidate = waiting.shift();
      if (inFlight.has(candidate.triviaId)) {
        continue;
      }
      inFlight.add(candidate.triviaId);
      const task = run(candidate);
      running.add(task);
      task.finally(() => running.delete(task));
    }
  }

  async function settled() {
    while (running.size > 0) {
      await Promise.all(running);
    }
  }

  /**
   * Replace waiting work with the latest derivation from the committed
   * catalog; requests already in flight continue.
   *
   * @param {Array<{date: string, triviaId: string}>} candidates - Newest first
   * @returns {Promise<void>} Resolves once no trivia request is left
   */
  function schedule(candidates) {
    waiting = candidates.filter(candidate => !inFlight.has(candidate.triviaId));
    pump();
    return settled();
  }

  return { schedule };
}
