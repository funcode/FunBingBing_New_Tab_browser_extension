# Spec: Cached-Startup Quote Synchronization (PLAN10)

## Problem Statement

When a new tab opens and today's wallpaper is already available locally, the
page restores the cached wallpaper but does not request quote synchronization.
If today's cached quote is missing or has a blank caption, the background worker
therefore never gets an opportunity to use the configured quote fallback URL.

This is especially visible after Bing returns a quote with text and author data
but an empty author caption. The wallpaper displays normally, while the quote
remains incomplete for the rest of the day. The same gap can occur when one tab
waits for another tab to finish the daily wallpaper refresh.

## Solution

Every startup path that displays a committed, already-available wallpaper must
also request quote synchronization using the committed catalog and the current
quote cache. The request is asynchronous and must not delay wallpaper display.

The page sends the cached quote state to the service worker without deciding
whether the quote is valid. The worker remains responsible for detecting missing
or blank-caption quotes, fetching the configured fallback source, preserving a
valid existing quote when fallback data is unusable, and notifying pages after
an update.

## User Stories

1. As a user opening a new tab with today's wallpaper cached, I want the wallpaper to appear immediately, so that quote recovery does not delay startup.
2. As a user whose cached quote has a blank caption, I want the configured fallback quote to be fetched automatically, so that the quote is complete without manual refresh.
3. As a user with no cached quote for today's catalog date, I want the worker to receive an explicit missing value, so that it can fetch today's fallback quote.
4. As a user with a complete cached quote, I want startup synchronization to leave it unchanged, so that healthy cached data is not replaced unnecessarily.
5. As a user whose fallback endpoint is unavailable, I want my existing valid quote preserved, so that a temporary network failure does not degrade the display.
6. As a user opening multiple tabs during a daily refresh, I want a waiting tab to display the newly committed wallpaper and then synchronize its quote, so that the tab that did not perform the refresh still recovers missing quote data.
7. As a user opening a tab after another tab has committed today's wallpaper, I want synchronization to use the latest catalog and quote cache, so that stale in-memory page state cannot suppress recovery.
8. As a user, I want quote updates to repaint the quote currently associated with the displayed date, so that an asynchronous response cannot update the wrong wallpaper.
9. As a user, I want cached wallpaper display to remain independent of quote network latency, so that a slow fallback endpoint does not block interaction.
10. As a user, I want a normal full wallpaper refresh to keep its existing quote synchronization behavior, so that cached-startup repair does not create duplicate requests.
11. As a user, I want a cached display failure to remain recoverable, so that quote synchronization is not silently omitted merely because an image load failed in a branch that does not enter a full refresh.
12. As a maintainer, I want quote validity and fallback policy centralized in the worker, so that page startup code does not duplicate cache and retry rules.
13. As a maintainer, I want the cached-startup request to be based on committed catalog dates, so that rejected or stale metadata cannot schedule quote work.
14. As a maintainer, I want the synchronization contract observable in a browser test, so that ordering regressions can be detected without asserting private function calls.

## Implementation Decisions

- Add one standalone asynchronous coordinator named `requestQuoteSyncForCachedCatalog` in the page wallpaper module.
- Keep `buildQuoteSyncPayload` as a pure payload builder. It must not read storage or dispatch messages.
- The coordinator must fresh-read the committed wallpaper catalog and quote-cache state through the existing asynchronous storage-read primitive. It must not depend on a caller having refreshed the in-memory configuration cache.
- The coordinator derives the current date and eligible image-date list from the committed catalog. It must not derive dates from the browser's local calendar date or from an uncommitted Bing response.
- The coordinator passes the cached value for the current date through unchanged: an explicit null for an absent quote, or the stored quote object whether its caption is blank or complete.
- If the catalog has no usable current date or eligible dates, the coordinator returns without dispatching a message.
- In the cached-today startup branch, call the coordinator after the wallpaper display attempt completes, regardless of whether that attempt succeeds. This branch does not automatically enter the full refresh path.
- In the branch that observes today's wallpaper already ready, call the coordinator after `changeWallpaper(0)` succeeds and before returning.
- In the cross-tab waiting branch, call the coordinator only after the waiting tab successfully applies `changeWallpaper(0)`. If that display fails, continue into the normal full refresh path and do not issue the cached-catalog request from the waiting branch.
- Do not call the coordinator from Bing caption extraction, quote parsing, catalog result handling, or the full refresh coordinator. The full refresh path retains its existing payload construction and dispatch.
- Dispatch remains fire-and-forget. Quote synchronization must not become part of the wallpaper display critical path.
- The worker continues to decide whether a fetch is needed, including blank-caption detection, missing-date detection, forced refresh for blank captions, fallback response validation, cache preservation, and update notification.
- The page must establish the active display date before a worker update notification can be used to repaint the quote.
- This change does not alter the ownership or migration of the quote fallback URL between local and sync storage.

## Testing Decisions

- Use a browser-level Playwright seam with the unpacked extension because the bug depends on page startup, service-worker messaging, storage propagation, and visible repainting.
- Intercept the configured fallback endpoint and fulfill it with a deterministic fixture. The real endpoint may be covered by an optional smoke check, but the regression suite must not depend on external network availability or the current calendar date.
- Test blank-caption recovery separately: seed a committed catalog and blank-caption quote, open the cached-today path, verify the wallpaper appears first, fulfill the endpoint, then verify the request, persisted complete quote, and non-empty visible caption.
- Test missing-quote recovery separately: omit the current date from the quote cache, verify the message carries an explicit null value, and verify the worker persists the fallback quote.
- Test the complete-quote case separately: verify synchronization completes without a fallback request or quote replacement.
- Test endpoint failure separately: fail the fallback request and verify an existing valid cached quote remains unchanged.
- Test cross-tab coordination with two pages in one persistent regular-context Chromium session. Delay page A's refresh while it owns the local refresh lock, open page B, let page A commit today's wallpaper, and verify page B waits, displays the committed wallpaper, and then requests cached-catalog synchronization. Do not use separate browser contexts for this test.
- Assert observable behavior: endpoint request, stable message fields when a message-contract assertion is useful, storage contents, visible quote caption, and wallpaper-first startup behavior. Do not assert exact request IDs, private helper call counts, or fragile millisecond timing.
- No existing automated test harness was found for this module; the browser scenario is the primary regression seam. A focused message-contract test may supplement it if a test harness is added.

## Out of Scope

- Reworking the existing full wallpaper refresh quote synchronization path.
- Moving `qotd_url` between `chrome.storage.local` and `chrome.storage.sync`, or changing its migration precedence.
- Changing the remote JSON schema, quote normalization rules, quote-cache retention policy, or worker retry policy.
- Guaranteeing that a remote quote is available while offline.
- Adding a background timer or alarm to retry quote synchronization without a page startup or other existing event.

## Further Notes

- The configured regression endpoint is `https://quotes-of-the-day.s3.ap-east-1.amazonaws.com/latest.json`.
- The endpoint fixture should contain the target catalog date and a complete text, source, link, and caption so the test verifies the full replacement path.
- A valid cached quote must win over an unusable fallback response; the blank-caption Bing quote is retained only when no valid replacement is available.
- The refresh-path behavior when image application fails is a separate concern and must not be silently changed as part of this cached-startup fix.
