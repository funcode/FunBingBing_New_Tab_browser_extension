# Worker-owned quote fallback recovery for blank captions

## Context

Bing can return a quote with usable text and source metadata but an empty author
caption. The page may display and cache that quote as today's or a historical
quote. Cached wallpaper startup, including a tab waiting for another tab's
refresh, previously had no quote-sync event, so the configured `qotd_url`
fallback was not consulted.

The page's in-memory configuration can also lag behind values committed by
another tab. Quote recovery therefore needs to use the committed catalog and
quote cache as its input.

## Decision

- The page owns a standalone `requestQuoteSyncForCachedCatalog()` coordinator.
  It fresh-reads `bing_images` and `cache_quote_state` with
  `readStorageKey()`, derives today's date from the first committed catalog
  entry, and passes that date's cached quote through unchanged to the pure
  `buildQuoteSyncPayload()` helper. An absent quote is represented by `null`; a
  blank-caption quote is not filtered on the page.
- Cached startup paths dispatch the resulting `syncQuotesForImages` message
  after their cached-display attempt when the selected catalog entry is today,
  regardless of display success. The cross-tab waiting path passes a
  `quoteSyncAlreadyRequested` handoff to a subsequent full refresh so it does
  not dispatch a duplicate request.
- The existing full refresh path keeps its own quote synchronization, dispatching
  after its wallpaper update attempt unless a cached-startup handoff already
  sent a request. The cached-catalog coordinator is called after an attempt to
  display today's wallpaper, including when navigation returns to today, but
  not when navigating between historical dates. It is not called from Bing
  caption extraction, quote parsing, or catalog result handling.
- The background worker owns quote validity and fallback policy. It treats
  missing dates and blank-caption entries among the requested catalog dates as
  fallback candidates, forcing a fresh lookup through the configured `qotd_url`
  when a blank caption is present. It validates the response, preserves an
  already-valid cached quote when the fallback is unusable, and notifies pages
  only after a cache update.
- Quote synchronization is fire-and-forget from the page so wallpaper display
  is not blocked by remote quote latency. Request IDs and the active display date
  prevent stale responses from repainting the wrong wallpaper.

## Consequences

- A blank Bing caption can be repaired after an attempt to display today's
  wallpaper on cached startup, after cross-tab waiting, or after navigation
  returns to today, even if image application fails. Navigating between
  historical wallpapers does not initiate another quote sync.
- A temporary fallback failure no longer replaces a valid cached quote with the
  blank Bing value. If no valid quote exists, the blank value remains the
  best-effort fallback until a later sync event.
- Fresh storage reads avoid suppressing recovery because a page-local config
  cache is stale.
- Quote recovery remains event-driven; this decision does not add a background
  timer or guarantee recovery while offline.

## Related decisions

- [ADR-0009: Shared settings use `chrome.storage.sync`](./0009-shared-settings-use-storage-sync.md)
  defines the shared ownership of `qotd_url`.
- [ADR-0010: Bounded escalating retry backoff](./0010-bounded-escalating-retry-backoff.md)
  defines retry state and reset behavior for quote fetches.
