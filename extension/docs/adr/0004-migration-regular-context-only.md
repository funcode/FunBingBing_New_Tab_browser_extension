# Migration remains regular-context only

Status: revised September 24, 2026 by [ADR-0015](./0015-regular-only-new-tab.md).

Ataraxia supports only regular New Tab. The former incognito self-seeding, separate-runtime and last-window cleanup decisions are superseded. Chrome's New Tab override restriction and the decision to drop that mode are recorded in ADR-0015.

## Active migration contract

- Use `wallpaper_migration_v2_state` and the unsuffixed regular v2 keys/cache names from ADR-0015. Treat valid suffixed regular state and cache responses as migration inputs; do not discard them before the unsuffixed state is verified.
- Import up to eight valid legacy wallpaper dates and the regular quote cache. Canonicalize image URLs and preserve valid existing v2 data and trivia completion.
- Move product settings to sync using valid sync value, then valid local value, then existing default (ADR-0009). Fresh-read verification precedes removal of local settings; failed writes remain retryable.
- The worker writes and verifies the catalog/quote state, never the display snapshot. The first page applies and acknowledges its page-owned display state before migration completes.
- Resume interrupted migration phases idempotently. Validate actual image cache responses after worker/browser restart; retained metadata does not prove an image cache hit.
- Copy retained regular v2 cache responses from the old suffixed cache, and then visible v1 responses missing from the unsuffixed v2 cache, by canonical URL. Preserve valid unsuffixed state when both names exist; recover missing valid regular data from the suffixed state. The first page transfers a valid suffixed display snapshot to the page-owned unsuffixed key before acknowledging migration; the worker never writes display state. Start a new unsuffixed marker and verify actual state rather than trusting the old marker phase. Do not transfer an old quote lease or import retired private runtime data.

The former split-incognito design used shared chrome.storage.local with suffixed keys and best-effort windows.onRemoved cleanup. Those were product requirements before ADR-0015; neither private-session cleanup nor a replacement IndexedDB/session backend is required now.
