# Issue 155 architecture sketch

The user can save the configured final photograph visible in the clicked tab. The original Blob and identity survive wallpaper navigation, cache eviction and service-worker restart while that page remains open. This recommendation is based on the live [issue 155](https://github.com/funcode/FunBingBing/issues/155) and its binding [parent issue 154](https://github.com/funcode/FunBingBing/issues/154), read on 2026-11-10. This is a design proposal. No implementation or runtime verification was performed.

## Recommendation

Keep the browser-save operation entirely in the originating extension page. Give a page-side browser-save module one public operation, `saveCapturedImage(capture, folder): Promise<SaveOutcome>`. Its operation closure owns its Blob URL, downloads listener, download ID, reconciliation state and terminal result. The page lives through service-worker stops. The later native integration starts only from the completed-save result and belongs to the worker under issue 157.

| Owner | Benefit | Cost or limit |
| --- | --- | --- |
| Originating page | Already owns the displayed Blob and user gesture; directly survives worker restart; no IPC correlation or persistent image copy | Closing/reloading the page before verified handoff has no continuation guarantee |
| Service worker | Central place for later native work | A suspended worker loses its pending save state; requires recovery journal and page reconnection; Blob still needs a document owner |
| Page source plus worker download tracker | Central download events | Split ownership adds handshakes and duplicate-completion risk without strengthening the required tab-open guarantee |

Choose the first option. Do not create an offscreen document, save queue, worker keepalive, byte serialization or cache export copy for this ticket. The parent assigns native connection and terminal native notifications to the worker, not all browser-save stages.

## Source and data ownership

Existing `scripts/main/wallpaper.js` is the only DOM final-image application boundary. Its `wallpaperView.applyFinal` decodes a Blob, checks `isCurrent()`, paints, and then returns true. Add one page-local retained record after the successful paint in that same synchronous continuation.

```js
// Owned only by wallpaper.js; not persisted or exposed for mutation.
let visibleFinal = null; // or Object.freeze({ date, imageId, url, blob })

// Capture returned synchronously to the actual action click.
// Resolution is validated against current configured final URL.
Capture = {
  date, imageId, resolution: 'highDef' | 'ultraHighDef', blob
};

SaveOutcome =
  { kind: 'complete', save: { downloadId, filename, capture } }
  | { kind: 'denied' }
  | { kind: 'cancelled' }
  | { kind: 'failed', reason }
  | { kind: 'unconfirmed', reason };
```

`Capture` contains the already held immutable Blob. Copy the small metadata values and hold that Blob reference synchronously. Do not retain a mutable catalog entry. Identity/date/resolution provide the safe descriptive filename; no later catalog lookup is needed. The `capture` carried to the page's completed-save boundary proves association with the original bytes. Do not send its Blob in a runtime message. Future worker handoff needs only identity/date/resolution plus the completed browser download ID and actual path.

Clear `visibleFinal` only when a Preview or fallback actually replaces the display. Do not clear it on navigation start, catalog notifications, failed decode or stale application. A previous final remains actionable while the next destination is pending. Clearing the selected record does not alter captures already held by save closures.

The controller view has no resolution field. Reuse `buildCanonicalUrls(imageId)` from `src/helpers/image.js` and `isUhdEnabled` from display-state helpers. The retained URL must equal the canonical URL for the page's current configured resolution. This covers restored snapshots with no catalog entry. Do not infer resolution from the current catalog or add an export getter to the controller.

A synchronous capture check returns unavailable if there is no retained final, its URL does not match configured final resolution, the network-status DOM state is offline, or the requested action is not offered. Current `readConf('enable_uhd_wallpaper')` supplies the shared setting mirror. Setting changes rerender eligibility immediately, without waiting for the controller to load the new resolution. Network events rerender visibility/eligibility. Offline hiding need not destroy the retained Blob; clicks remain prohibited until the picture is visible and otherwise eligible.

Keep this source record independent from action-module initialization. Initialize controls asynchronously after the wallpaper script, and read the record when controls become ready. Never await action imports, permission checks or helper availability in `applyFinal`, `initWallpaper`, or the first-wallpaper startup chain.

## Permission and save boundary

The DOM click handler captures the source and folder before its first async step. Its explanation should already be visible in accessible help text when requesting the permission. Call `chrome.permissions.request({ permissions: ['downloads'] })` directly from that handler before any `await`, storage read, dynamic import or runtime message. Calling it when already granted is harmless. A fresh asynchronous `permissions.contains` check in the click path can lose user activation and is unnecessary. Add only downloads to optional permissions for this slice. [Chrome documents the user-gesture requirement](https://developer.chrome.com/docs/extensions/reference/api/permissions).

If the design uses a separate explanation dialog, capture on the original action click and call `permissions.request` directly from its explicit Continue button gesture. Keep the originally captured source rather than recapturing the newer image. Do not request permission from hover, focus, page initialization or changing the folder.

After grant, create a dedicated operation Blob URL from the captured Blob. Never reuse the wallpaper display URL, which navigation revokes. Attach the download-change observer before calling `downloads.download`. Supply the sanitized relative filename and `conflictAction: 'uniquify'`. Omit `saveAs` so the browser's usual preference controls its prompt. Do not force `saveAs: false` or install a filename override listener. Read the final filename from the completed browser record. [Downloads API reference](https://developer.chrome.com/docs/extensions/reference/api/downloads).

The permission request is part of the UI adapter because it must occur in the gesture. The save module assumes that grant has completed and owns all remaining browser-save complexity. Its Promise resolves once, and one continuation consumes `SaveOutcome`. No second completion callback, event bus publication or worker listener also delivers completion.

## Tracker and state machine

```text
captured -> permission-pending -> denied
                            -> starting -> tracking -> complete
                                          |       -> cancelled/failed
                                          |       -> unconfirmed
                                          -> initiation-failed
```

Each operation owns `id`, `terminal`, `queryRunning`, and `dirty` state. Before initiation, `id` is null and observation is already active. When initiation returns an ID, bind it and immediately request a reconciliation search while observation remains active. An early completion event for an unknown ID need not be buffered because this mandatory search sees the current record. An event for the known ID requests another reconciliation.

Reconciliation queries `downloads.search({ id })` and feeds the record into one terminal function. Coalesce concurrent requests to one active query and one dirty flag. If a relevant event arrives during a query, mark it dirty and re-query before accepting a potentially stale result. There is no polling or timeout while the user legitimately keeps Save As open. Treat callback errors, a missing record or permission loss as failed/unconfirmed observation, never as completion.

Only `state === 'complete'` plus the browser record's nonempty absolute filename can enter complete. `interrupted` enters cancelled for `USER_CANCELED`, otherwise failed. Do not resume or replay the save automatically. `in_progress` keeps listening. A completion event without filename requests search; it does not construct a path. A returned ID alone never advances the boundary.

The terminal function synchronously checks and sets its terminal guard before resolving the Promise, removing the listener and revoking the operation Blob URL. All event/query paths use it. Late events and stale query completions see terminal and do nothing. There is no await between deciding complete and claiming terminal. Exactly once here means one completed-save result for this operation in the live page; it does not promise durable exactly-once native application after arbitrary browser crashes.

A worker stop cannot discard any of this state because no save state resides in that worker. Issue 157 can start a new worker through the single completion continuation. A send failure after possible native execution must not trigger blind retry. Native acceptance and its recovery semantics belong to that ticket.

## Settings and controlled availability

Add `enable_image_download` with existing yes/no convention and default yes, plus `wallpaper_download_folder` default empty string, to the existing shared-setting defaults and migration validator tables. Use `readConf`, `writeConf`, and `SETTINGS_CHANGE_EVENT` from `scripts/base.js`. Do not invent another settings store. The duplicated default tables are existing architecture; extend both and test consistency rather than refactoring all settings for this ticket.

Keep one relative-folder validator shared by options and filename construction. Accept empty as Downloads root. Normalize backslash separators to `/` if accepted, then reject leading separators, drive/UNC paths, any parent segment, controls and platform-invalid filename segments. Reject rather than sanitize traversal. Preserve the last valid stored folder when input is invalid. Apply conservative safe-character sanitization and length bounds to the generated image/date/resolution basename. Browser conflicts and Save As changes remain authoritative.

Desktop availability is local/profile state, not a second synced enable preference. Model the controlled inputs as loading, unavailable or verified. Production starts unavailable without a verified local hint and permission. Deterministic fixtures can provide each state to the same rendering function; no URL parameter or user setting creates a fake verified helper. Real verification, permission acquisition and installer behavior remain in 156. Desktop action execution remains in 157; any completed-save sink used to exercise desktop controls in tests is injected only by fixtures.

Folder enabled state is `downloadEnabled || desktopVerified`, independent of Blob readiness or downloads permission. Both actions Off disables the field without removing its saved value. Pending desktop availability reserves its slot and does not shift Download. Disabling an action affects new captures; in-flight operations keep their captured folder and image.

## UI and tests

Use a sibling action group with its own fixed layout below the clock area, not nested inside the clock. Keep both action slots allocated while the group exists. Use opacity for idle visual hiding and `:focus-within`/hover for reveal. Offered enabled buttons remain keyboard-reachable when visually idle. Disabled/non-offered buttons are disabled or removed from tab order. Both Off hides the whole group. Place status in an aria-live region. An unavailable loading group must not create a dead keyboard tab stop.

Required deterministic checks include the following.

1. Final paint retains exactly that Blob; preview/fallback clear eligibility; stale/failed decode leaves the old final. Pending navigation exports the old visible final. Resolution mismatch and offline-hidden states reject clicks.
2. Click A, navigate to B, change resolution and evict A from cache before permission/save completion. The saved bytes still equal A. Repeat with two tabs showing different images and a newer shared display snapshot.
3. Permission request occurs synchronously in the click gesture. Denial initiates no save. A standalone save does not call any native API.
4. Complete before initiation returns ID; event while initial search is pending; duplicate complete events; overlapping query results; interruption and missing record. Only one complete outcome with the actual filename is emitted.
5. Real extension download byte hash equals captured Blob bytes. Verify default destination, relative folder, changed browser destination, filename conflicts, cancellation and normal completion. Inject controlled access/disk errors at the Downloads API boundary.
6. Hold save initiation or Save As pending, stop and restart the actual extension worker while the originating tab remains open, then finish. Verify original bytes and actual final filename reach one completed-save boundary. This must use an actual browser download, not only a unit stub.
7. All switch/availability combinations, folder logical OR and saved-value retention, cross-page sync updates, clock hidden/shown, keyboard-only discovery/use and unchanged Download bounding box during availability changes.
8. Page/options tests, applicable controller race suites and mandatory `npm run test:e2e`. Assert no export code writes display snapshots, fetches source bytes or starts helper processes, and that action initialization does not delay first wallpaper application.

## Red-flag review

One save module hides browser event ordering, reconciliation and URL lifetime behind one operation. No caller orchestrates listener registration or search. The wallpaper view alone owns visible-image truth, the save closure alone owns its terminal state, and the worker later owns native execution. There is no duplicated save tracker. Settings validation is shared without introducing a generic action framework. The controller, cache retention and display-snapshot writers remain unchanged.

## Shared implementation contract

Suggested files are `src/page/wallpaper-download.js` for `saveCapturedImage(capture, folder)`, `src/helpers/wallpaper-download.js` for relative-folder validation and safe filename construction, and `scripts/main/wallpaper-actions.js` for page gesture handling, capture eligibility and controls. `scripts/main/wallpaper.js` remains the sole writer of the retained final record and exposes a read-only synchronous getter. That getter returns the frozen record or null; controls never mutate it. The actions script loads after wallpaper startup and imports its modules independently. Options wiring belongs in the existing `scripts/option_page/main.js` and `options.html`.

Use sync keys `enable_image_download = 'yes'` and `wallpaper_download_folder = ''`. The local key `desktop_wallpaper_available = false` is the desktop switch itself. Do not add a second independent desktop-enabled key. Live native verification remains absent in this slice. Production desktop controls stay unavailable with guidance that desktop integration is not yet available in this build. They must not set the availability flag true or present an actionable button with no executor. Controlled tests inject verified availability and a test completed-save consumer directly into the same action wiring; these fixtures must not be activated through production URL parameters or user settings. A persisted positive hint alone must not create an enabled no-op desktop action in a build lacking its native executor.

Use page IDs `wallpaper-actions`, `download-image-btn`, `desktop-wallpaper-slot`, `desktop-wallpaper-btn`, and `wallpaper-actions-status`. Use options IDs `enable-image-download-checkbox`, `enable-desktop-wallpaper-checkbox`, `wallpaper-download-folder`, and `wallpaper-download-folder-error`. Keep the desktop slot reserved even when its button is not offered.

The page test seam can inject `{ availability, onCompletedSave }` when constructing action wiring. The production download consumer updates the accessible saved status; the test desktop consumer records the completed save. Invoke this consumer from only the one save-Promise continuation and never from the download event observer. This is the explicit completed-save boundary that issue 157 will connect to its worker handoff.
