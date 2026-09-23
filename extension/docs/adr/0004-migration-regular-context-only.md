# Migration is regular-context only; incognito self-seeds

Shared product settings are the exception: [ADR-0009](./0009-shared-settings-use-storage-sync.md)
migrates them to `chrome.storage.sync`, which is visible to both contexts. Chrome's
extension `chrome.storage.local` API is also physically shared between regular and
incognito processes; PLAN9 keeps runtime records logically isolated with explicit
context-suffixed keys.

`manifest.json` sets `"incognito": "split"`, which gives the incognito context its
own extension process and event stream. The processes cannot communicate directly,
but they can address the shared extension storage APIs. Cache Storage remains a
separate browser storage-partition concern and is not assumed to be cross-context.

PLAN9 originally specified a single `chrome.storage.local.set()` from the regular
worker carrying both contexts' v2 state, plus a shared `wallpaper_migration_v2_state`
marker coordinating the two. That would make one process responsible for another
process's runtime state and would allow migration bookkeeping to blur the privacy
boundary, even though the underlying extension storage API is shared.

We therefore scope migration to the regular context only. The incognito worker
builds missing v2 state from its own normal refresh path, never from regular v1
state. Split mode does not make `chrome.storage.local` session-only: Chrome
[documents that local and sync storage are shared](https://developer.chrome.com/docs/extensions/reference/manifest/incognito).
Context suffixes prevent accidental mixing but do not automatically erase records
when the last incognito window closes. That persistence is acceptable here because
the records contain wallpaper views, quote data, retry state, and previews rather
than browsing history, credentials, or private page content.

## Consequences

- The migration marker is named `wallpaper_migration_v2_state_regular` and describes
  regular-context migration only. There is no cross-context coordination to
  implement. Incognito initialization must not read, interpret, wait for, or mutate
  this marker (or any v1 migration key); it uses an explicit allowlist of its own
  context-suffixed v2 keys and shared sync settings.
- The context gate is applied before storage access. Incognito must not use a
  full-storage scan such as `chrome.storage.local.get(null)` to discover migration
  state, and must self-seed independently while the regular marker is in any phase.
- Context-suffixed key names are the logical ownership boundary in shared extension
  storage and must be retained.
- When its own catalog or image responses are absent, incognito fetches missing
  metadata and images rather than importing regular state. Surviving local
  records alone do not establish an image cache hit. It only best-effort
  prefetches the next future date, per ADR-0011.
- Only the regular migration copies visible v1 Cache Storage responses into its
  v2 cache. Incognito does not inspect or import v1 cache data; no claim is made
  about whether the browser physically shares Cache Storage.

## Persistence and verification

Incognito wallpaper state remains in context-suffixed `chrome.storage.local`
keys during the active session. The design promises logical isolation and correct
recovery. When the last incognito window is removed, the incognito worker performs
best-effort cleanup of its catalog, quote, lease, retry, display, and Cache Storage
state. A later incognito session therefore normally starts empty, but cleanup is not
a prerequisite for correctness: if the worker is terminated or the browser exits
before cleanup completes, the next session may encounter retained records. Missing
image responses are still detected through exact `cache.match()` checks and repaired
by the normal worker flow.

Do not move these records to IndexedDB or `chrome.storage.session` solely to obtain
session cleanup. The `windows.onRemoved` cleanup path keeps the existing storage
model and is sufficient for this low-sensitivity wallpaper state, while preserving
worker-restart recovery when a session remains active.

Tests must verify that regular and incognito workers read and write only their own
logical keys, that one context cannot replace the other's catalog or display state,
and that worker restart preserves recoverable state. The incognito worker listens
for `chrome.windows.onRemoved`, queries remaining incognito windows, and clears its
context-specific records and Cache Storage only after the last incognito window is
gone. Cleanup must be idempotent and serialized with initialization: closing one
of several incognito windows preserves state; a new incognito window during cleanup
causes initialization to win or safely rebuilds from empty state. Tests must also
cover worker termination and browser exit before cleanup, where the next session
may find stale records but must validate actual cache responses before displaying
them. Regular windows and regular state remain unaffected.
