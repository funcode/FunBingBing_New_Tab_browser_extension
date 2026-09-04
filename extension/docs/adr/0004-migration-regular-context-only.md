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
builds its v2 state from the normal refresh path on first use in each incognito
session. This is sound because split-mode incognito storage starts empty and is
discarded when the last incognito window closes — there is no durable browsing state
there that should be imported.

Rejected: switching to `"incognito": "spanning"` would make the single-write
migration correct, but would persist incognito wallpaper history, quotes, and
display state into the regular profile. That is a privacy regression and split mode
is the deliberate choice.

## Consequences

- The migration marker describes regular-context migration only. There is no
  cross-context coordination to implement.
- Context-suffixed key names are the logical ownership boundary in shared extension
  storage and must be retained.
- An incognito session pays a cold start — its first new tab fetches metadata and
  images rather than inheriting the regular context's cache. It only best-effort
  prefetches the next future date, per ADR-0011.
- The v1 Cache Storage copy step is likewise per-context and already hedged
  correctly in PLAN9; no claim is made about whether Cache Storage is shared.
