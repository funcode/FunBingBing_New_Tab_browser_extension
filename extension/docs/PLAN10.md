# Fix Cached-Startup Quote Synchronization

## Summary

Ensure every startup path that displays an already-available current wallpaper also sends a quote-sync request. This allows the worker to fetch `qotd_url` when today’s quote is missing or has a blank caption, without delaying wallpaper display.

## Implementation Changes

- Add a new standalone async helper named `requestQuoteSyncForCachedCatalog()` near `buildQuoteSyncPayload()` in `scripts/main/wallpaper.js`.
  - Keep `buildQuoteSyncPayload()` pure and unchanged; it only builds the message payload.
  - Fresh-read `bing_images` and `cache_quote_state` with `readStorageKey()` rather than relying on `readConf()` or caller cache refreshes.
  - Derive `todayDate` and `imageDates` from the committed catalog.
  - Pass the cached value through unchanged: `null` when today is absent, or the stored quote object whether its caption is blank or complete.
  - Call `fireQuoteSync(payload)` after the caller has attempted to display the cached wallpaper. Return whether a payload was dispatched so a later full refresh can avoid sending a duplicate request.
  - Return without sending when there is no usable catalog/date from which to build a payload.

- Invoke the helper in all cached-display startup branches:
  - `cache_date == getDateString()` after the `changeWallpaper()` attempt, regardless of success. This branch does not enter the full refresh path, so quote synchronization must not be gated on the display result.
  - `isTodayWallpaperReady()` after the `changeWallpaper(0)` attempt, regardless of success, before returning on success.
  - The cross-tab lock/wait path after the waiting tab's `changeWallpaper(0)` attempt, regardless of success. If display fails, continue into `runWallpaperFetchRefresh()` with a `quoteSyncAlreadyRequested` handoff.
  - Historical navigation does not sync; navigation back to catalog index 0 syncs after the update attempt regardless of its result.

- Do not call the helper from `quoteTask()`, caption extraction, or `handleBingDataResults()`. `runWallpaperFetchRefresh()` keeps its own payload unless a cached-startup handoff already dispatched one, and dispatches it after the wallpaper update attempt regardless of success.

- Keep quote synchronization fire-and-forget so a slow or failed remote request never blocks the cached wallpaper.

## Test Plan

Use a mocked response for the configured endpoint in deterministic Playwright tests. Keep a separate optional smoke check for the real endpoint; do not make the regression suite depend on external network data or the current date.

Add separate Playwright cases:

1. **Blank-caption success:** seed today’s catalog and quote with `caption: ""`, set `qotd_url` to `https://quotes-of-the-day.s3.ap-east-1.amazonaws.com/latest.json`, open the cached-today path, fulfill the intercepted endpoint with a complete quote, and verify the endpoint request, persisted quote, and updated caption. Verify the wallpaper is displayed before the asynchronous quote update.
2. **No cached quote:** omit `cache_quote_state[todayDate]`, verify the helper sends `todayQuote: null`, and verify the worker fetches and persists the remote quote.
3. **Valid cached quote:** seed a complete quote, verify synchronization completes without an endpoint request or replacement, and verify the quote remains unchanged.
4. **Remote failure:** fail the intercepted endpoint and verify the existing cached Bing quote remains unchanged rather than being overwritten by an unusable value.
5. **Cross-tab wait path:** use two pages in one persistent regular-context Chromium session. Delay page A’s refresh while it owns the local refresh lock, open page B, let page A commit today’s wallpaper, then verify page B observes the storage change, displays `changeWallpaper(0)`, and invokes cached-catalog quote synchronization. Do not use separate browser contexts for this case.

Assert stable observable outcomes rather than exact request IDs, private helper call counts, or fragile timing. A message-contract assertion may verify the stable fields `type`, `todayDate`, `todayQuote`, and `imageDates`, but it does not replace the browser-level result checks.

## Acceptance Criteria

- A cached-today new tab whose selected entry is today always sends a quote-sync request after the display attempt, including when image application fails.
- Returning to today through navigation sends a quote-sync request after the update attempt; historical-to-historical navigation sends none.
- Missing or blank-caption today quotes are repaired from `qotd_url`.
- The page displays the cached wallpaper immediately.
- `quotesUpdated` is handled after `currentImageDate` is established.
- Existing refresh-path quote payload construction remains unchanged; only its
  dispatch timing and cached-startup deduplication handoff are adjusted.
- No changes are made to `qotd_url` storage ownership in this fix; the existing local-versus-sync setting migration remains a separate issue.
- A cached-startup handoff prevents the full refresh path from dispatching a duplicate quote-sync request after a failed cached display.
