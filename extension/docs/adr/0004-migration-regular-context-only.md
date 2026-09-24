# Migration remains regular-context only

Status: revised September 24, 2026 by [ADR-0015](./0015-regular-only-new-tab.md).

Ataraxia supports only regular New Tab. The former incognito self-seeding, separate-runtime and last-window cleanup decisions are superseded. Chrome's New Tab override restriction and the decision to drop that mode are recorded in ADR-0015.

## Active migration contract

- Retain the marker `wallpaper_migration_v2_state_regular` and existing regular v2 keys/cache names; do not rename or discard valid regular state.
- Import up to eight valid legacy wallpaper dates and the regular quote cache. Canonicalize image URLs and preserve valid existing v2 data and trivia completion.
- Move product settings to sync using valid sync value, then valid local value, then existing default (ADR-0009). Fresh-read verification precedes removal of local settings; failed writes remain retryable.
- The worker writes and verifies the catalog/quote state, never the display snapshot. The first page applies and acknowledges its page-owned display state before migration completes.
- Resume interrupted migration phases idempotently. Validate actual image cache responses after worker/browser restart; retained metadata does not prove an image cache hit.
- Only regular v1 cache responses are copied into the regular v2 cache. Do not read/import retired private runtime data.

The former split-incognito design used shared chrome.storage.local with suffixed keys and best-effort windows.onRemoved cleanup. Those were product requirements before ADR-0015; neither private-session cleanup nor a replacement IndexedDB/session backend is required now.
