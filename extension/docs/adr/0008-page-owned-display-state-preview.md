# Page-owned preview data in the display state

An earlier proposal preserved the untagged `wallpaper_preload_data_url` key and
described a worker-owned catalog-to-cache-to-data-URL write sequence. PLAN9's
ownership model instead makes the display state the single page-owned record of
the most recently completed wallpaper application in a context. Keeping the old
key as a second runtime write path would reintroduce the cross-actor race that
the migration is intended to remove.

## Decision

- The page exclusively writes `wallpaper_display_state_v2_<context>`.
- `preloadDataUrl` is part of that object and is written atomically with its
  `date`, `imageId`, and final-resolution `url`. An explicit empty value is a
  valid, internally consistent, recoverable snapshot; atomicity requires that a
  non-empty preview match the snapshot identity, not that a preview always exist.
- During new-tab initialization, the page may render a preview only when its
  `date + imageId` matches the selected entry. That preview is temporary visual
  state until the final-resolution image is decoded and applied.
- Manual date navigation never renders the destination preview. It retains the
  current final-resolution wallpaper and shows `Wallpaper is updating...` until
  the destination final image is decoded and applied.
- Pending navigation is page-local and does not change display state. After the
  final image is applied, the page atomically records its date, identity, final
  URL, and matching preview data URL when available, otherwise an empty preview
  value. Failed navigation leaves the previous snapshot unchanged.
- The worker exclusively writes the catalog and Cache Storage. It never writes
  `wallpaper_preload_data_url` or the v2 display state.
- `boot.js` reads the current context's v2 display state and paints its
  `preloadDataUrl` when present. It trusts the atomic display-state snapshot and
  does not try to infer an identity from the data URL bytes. The legacy untagged
  key is migration input only and is not copied into v2.
- Every new-tab initialization independently checks Cache Storage for the
  committed `date + imageId`, even when `preloadDataUrl` is empty. It displays a
  cached final response immediately and reconstructs the matching preview data
  URL when available. Before persisting that repair, the page fresh-reads display
  state and verifies that `date + imageId + final URL` are still unchanged.
- Preview repair is opportunistic and must not depend solely on receiving the
  cache-completion notification that followed the original display commit. It
  does not delay applying an already cached final image and needs no persisted
  `previewPending` flag.
- The display state is global per context and supplies the initial selection for
  new tabs. Concurrent page writes use atomic last-write-wins semantics for
  future readers; page-local generation tokens reject stale callbacks within the
  page that created them. Existing tabs are not required to follow later writes
  from other tabs.

## Consequences

- The base64 preview remains duplicated in `chrome.storage.local` for fast boot.
- A page can display the gradient fallback briefly while reconstructing a missing
  preview, but the main initialization can immediately apply a cached final image.
- A crash or navigation between final-image commit and preview repair does not
  make the empty preview permanent; the next new-tab initialization retries the
  identity-guarded reconstruction.
- If Tab2 opens before Tab1 completes navigation, Tab2 may initialize from the
  previous committed wallpaper. A tab opened after Tab1 commits initializes from
  Tab1's new `date + imageId` and may briefly show only that image's preview.
- Cross-tab display coordination is intentionally neither lock-based nor a live
  synchronization mechanism. Last-write-wins chooses the persisted starting
  point for later new tabs; it does not force already-open tabs to converge.
