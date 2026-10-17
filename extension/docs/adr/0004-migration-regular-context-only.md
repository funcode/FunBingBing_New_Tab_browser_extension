# Migration remains regular-context only

Status: revised September 24, 2026 by [ADR-0015](./0015-regular-only-new-tab.md); migration inputs aligned with ADR-0015 on October 16, 2026.

Ataraxia supports only regular New Tab. The former incognito self-seeding, separate-runtime and last-window cleanup decisions are superseded. Chrome's New Tab override restriction and the decision to drop that mode are recorded in ADR-0015.

## Active migration contract

- Use `wallpaper_migration_v2_state` and the unsuffixed v2 keys/cache names from ADR-0015. No context-suffixed names exist. The production v1 keys and `funbingbing-wallpaper-cache-v1` listed in ADR-0015 are the only migration inputs; do not discard them before the v2 state is verified and the page has acknowledged its display state.
- Import up to eight valid legacy wallpaper dates and the regular quote cache. Canonicalize image URLs and preserve valid existing v2 data and trivia completion.
- Move product settings to sync using valid sync value, then valid local value, then existing default (ADR-0009). Fresh-read verification precedes removal of local settings; failed writes remain retryable.
- The worker writes and verifies the catalog/quote state, never the display snapshot. The first page applies and acknowledges its page-owned display state before migration completes.
- Resume interrupted migration phases idempotently. Validate actual image cache responses after worker/browser restart; retained metadata does not prove an image cache hit.
- Copy visible v1 cache responses missing from the v2 cache by canonical URL; a failed copy keeps migration retryable. Preserve valid v2 state when v1 and v2 data both exist, merging only missing legacy dates or fields. The first page builds the page-owned display state from the retained v1 display inputs, or writes the explicit empty state, before acknowledging migration; the worker never writes display state. Verify actual state rather than trusting the marker phase. Do not import retired private runtime data.

The former split-incognito design used shared chrome.storage.local with suffixed keys and best-effort windows.onRemoved cleanup. Those were product requirements before ADR-0015; neither private-session cleanup nor a replacement IndexedDB/session backend is required now.
