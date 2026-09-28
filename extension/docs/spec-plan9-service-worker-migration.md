# Spec: Service Worker-Managed Wallpaper Pipeline (PLAN9)

## Problem Statement

The current new-tab implementation lets page instances participate in wallpaper
metadata retrieval, image downloading, cache mutation, and legacy state updates.
Opening multiple tabs can therefore duplicate work or race on storage. A new tab
may also wait for unrelated metadata, trivia, or quote work before the wallpaper
is ready.

The extension needs one coherent wallpaper pipeline that displays cached content
immediately, preserves navigable history, makes useful offline progress, survives
Manifest V3 service-worker suspension. Product settings remain consistent across
regular pages and the worker through sync storage.

The design must also be honest about browser-controlled behavior. Future
prefetch is event-driven and cannot guarantee seven cached days, and Chromium can
paint a white or black frame before the extension document starts rendering.

## Solution

Move wallpaper metadata retrieval, catalog mutation, image downloading, cache
cleanup, trivia persistence, and quote persistence into the service worker for
each browser context. New-tab pages become read-only consumers of the catalog and
image cache. A page requests missing image work from the worker and exclusively
records the atomic display snapshot that it actually applied.

Use canonical image identities and cache keys so ImageOfTheDay, Model, Archive,
and migrated data converge on the same responses. Maintain one serial image
consumer for regular browsing. After the target wallpaper, prioritize navigable historical
images before invisible future prefetch. Regular future depth remains best-effort
up to seven dates.

Only regular browsing is supported. Keep the existing regular catalog, cache, quote
and display names and retryable v1-to-v2 migration. Product settings remain in
Chrome sync storage for regular pages and the worker.

## Product scope — September 24, 2026

[ADR-0015](./adr/0015-regular-only-new-tab.md) drops incognito support because Chrome
[does not allow New Tab overrides in incognito windows](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages#incognito).
The target manifest is `"incognito": "not_allowed"`. Remove incognito runtime routing,
state/queue creation, one-day prefetch, and last-window cleanup. Do not add IndexedDB
or session storage to maintain a discontinued mode. Runtime v2 local keys and
Cache Storage use unsuffixed names; production v1 keys and cache responses are migrated. Sync
settings remain unchanged. #116, #117 and #122 track the remaining code changes;
#123 verifies the supported mode and negative incognito behavior. This specification
is a scope update, not a claim that current runtime code has already been changed.

## User Stories

1. As a user, I want a cached current wallpaper to appear without waiting for the network, so that a new tab feels immediate.
2. As a user opening a new tab, I want the selected wallpaper's matching low-resolution preview to appear before a slow final image, so that the page becomes visually useful quickly.
3. As a user opening a new tab, I want the final image to replace its matching preview only once, so that startup does not visibly oscillate between backgrounds.
4. As a first-time user, I want a stable dark fallback while the first wallpaper downloads, so that extension-controlled rendering does not show a pure-black or pale-grey transition.
5. As a light-mode user, I want the extension not to add another flash after its document starts rendering, even though Chromium may show a browser-controlled white frame beforehand.
6. As a dark-mode user, I want the extension background to remain visually consistent with its photographic UI, regardless of the operating-system color preference.
7. As an offline user with cached content, I want the applicable cached wallpaper to display without a network refresh, so that the new tab remains useful.
8. As an offline user without a suitable cached wallpaper, I want a coherent fallback or offline view instead of a broken image, so that failure remains understandable.
9. As a user navigating between dates, I want the current final wallpaper retained with a `Wallpaper is updating...` headline until the requested final image is ready, without rendering the destination preview.
10. As a user, I want previous and next controls to navigate only real current and historical entries, so that navigation never lands on an invisible future placeholder.
11. As a user with only a few history entries, I want navigation to wrap over the entries that actually exist, so that there are no fixed-slot index errors.
12. As a user, I want missing historical images filled before unseen future images, so that content I can navigate to receives network priority.
13. As a user who explicitly navigates to a missing image, I want that request promoted ahead of background work, so that the selected image arrives as soon as the active fetch permits.
14. As a user, I want background downloads to remain serial within my context, so that prefetch does not compete aggressively with foreground activity.
15. As a user, I want future wallpapers cached when browser activity permits, so that some future dates may remain available offline.
16. As a regular-context user, I do not want the extension to claim that seven future days are guaranteed, so that the documented offline behavior matches Manifest V3 execution limits.
18. As a user who enables UHD, I want the current UHD wallpaper first, then historical UHD images, then future UHD images allowed for my context, so that visible content is upgraded before speculative content.
19. As a user who changes resolution repeatedly, I want duplicate canonical requests avoided and obsolete work discarded safely, so that toggling does not waste bandwidth.
19. As a user, I want the page to avoid repeated Bing metadata requests when the current source data is already complete, so that opening tabs does not create redundant traffic.
20. As a user, I want temporary Bing failures or missing target-date data to recover later, so that one bad response cannot permanently suppress updates.
21. As a user, I want network reconnection to permit one prompt retry without creating a reconnect storm, so that recovery is responsive but controlled.
22. As a user, I want a suspended service worker to resume from persisted catalog and cache state, so that completed downloads are not repeated.
23. As a user, I want stale asynchronous responses prevented from changing a newer wallpaper identity, so that date rollover and concurrent work cannot corrupt the catalog.
24. As a user opening another regular tab, I want it to initialize from the latest completed context display state available when it reads, without forcing already-open tabs to follow later writes.
25. As a user with multiple tabs, I want an old callback in one tab prevented from overriding a newer action in that same tab, so that local races do not undo navigation.
26. As a user, I expect incognito New Tab to remain the Chrome-provided page, because Ataraxia supports regular browsing only.
27. As a user, I want all regular pages and the worker to observe the same sync-backed product settings.
28. As a signed-in Chrome user, I accept that shared settings may follow my sync profile to other devices, so that split-context consistency does not require custom messaging.
29. As an upgrading user, I want current wallpaper identity, up to eight historical dates, and the regular quote cache preserved, so that migration does not discard useful state.
30. As an upgrading user, I want existing valid sync settings preserved over old local settings, so that migration does not overwrite newer preferences.
31. As an upgrading user, I want failed sync migration to retain local settings and retry later, so that a transient failure cannot lose configuration.
32. As an upgrading user, I want the first page to establish the v2 display state, so that the actor that knows what was actually applied owns the migration handoff.
33. As a user, I want quote and trivia failures not to delay wallpaper display, so that optional content never becomes part of the critical path.
34. As a user, I want a missing Bing quote to use the configured fallback source, so that quote functionality can recover independently.
35. As a user, I want cache usage bounded by an explicit date-and-resolution policy, so that offline depth does not create unbounded storage growth.
36. As a maintainer, I want actual HD and UHD cache bytes measured without a guessed threshold, so that future storage decisions use evidence.
37. As a maintainer, I want ownership violations and concurrency visible in end-to-end tests, so that later refactors cannot silently restore page/worker races.

## Implementation Decisions

### Authority and market date

- Active ADRs are authoritative when PLAN9 and an ADR disagree. The active set is ADR-0001 through ADR-0006 and ADR-0008 through ADR-0014. ADR-0012 records a deferred concurrency option, not permission to replace the serial scheduler. ADR-0014 describes quote recovery in the legacy implementation; its ownership and recovery behavior must be preserved using the v2 state and lease contracts rather than retaining legacy storage keys after migration. ADR numbering is not compacted after removal of the superseded ADR-0007.
- The wallpaper market remains fixed to `zh-CN`, and the target date is calculated at the Asia/Shanghai market boundary.
- A wallpaper date is a Bing publication identity, not the user's local calendar date. Display formatting does not perform timezone conversion.

### Ownership and context boundaries

- Each context's worker exclusively writes its wallpaper catalog, Cache Storage, quote cache, and quote lease state.
- Pages read the catalog and Cache Storage. They do not fetch wallpaper images directly and do not write image responses.
- Pages may fetch and parse quote HTML only after obtaining a worker lease; the worker validates and persists the result.
- Pages exclusively write the context's display state. The worker may read it for identity and retention decisions but never writes it.
- The only supported runtime context is regular. Use `bing_wallpaper_catalog_v2`, `wallpaper_display_state_v2`, `cache_quote_state_v2`, `quote_scrape_state_v2`, and `wallpaper_migration_v2_state` in local storage, plus `funbingbing-wallpaper-cache-v2` in Cache Storage. Production v1 keys and responses are migration inputs, never active v2 names.
- Shared product settings use Chrome sync storage. Context-local wallpaper, quote, display, migration, and cache state stay in local storage or Cache Storage.

### Terminology

- “Context” refers to the supported regular browsing context. Use “refresh generation” for persisted catalog date rollover.
- `refreshState.generation`, `imagePrefetchGeneration`, and the page-local generation token have separate scopes: catalog admission, runtime image scheduling, and callbacks in the page that created the token. They are not interchangeable.

### Catalog and identity

- The v2 catalog stores target-date refresh state, source status, image failure cooldowns, and entries indexed by publication date.
- Each entry includes a full image identity, canonical preview/HD/UHD URLs, staged metadata, trivia state, and timestamps.
- Metadata stages are monotonic for the same date and identity: legacy, Archive, PreloadMediaContents, MediaContents, then ImageOfTheDay.
- Different sources merge only when both date and full image identity match. A higher metadata stage cannot justify merging fields from a different photograph.
- Archive trivia IDs use the validated `HPQuiz_<YYYYMMDD>_<slug>` form. Only its unique date segment is rewritten to the matched IOTD `isoDate`; arbitrary digit strings are never guessed or replaced. Missing, null, non-string, or empty values become `triviaId: ""` with `triviaState: "missing"`. A non-empty malformed value is cleared, diagnosed, and is not eligible for Trivia work.
- Catalog-root and entry `updatedAt` values are numeric diagnostic timestamps for the latest corresponding commit. Display-state `updatedAt` is the numeric timestamp of the successful final-image application represented by that snapshot. These timestamps do not order cross-tab writes or admit stale work.
- Canonical URLs use the Bing image identity with one of three supported suffixes: preview, HD, or UHD. Equivalent hosts, formats, and unrelated query parameters do not create additional cache keys.
- The Bing CDN host permission is declared explicitly so worker image retrieval does not depend on incidental CORS behavior.

### Source refresh and stale work

- Install/upgrade, browser start, page refresh messages, network reconnect, and relevant setting changes can trigger work.
- ImageOfTheDay, Model, and Archive refresh independently and may commit independently. Optional trivia and image completion are not part of the metadata refresh promise.
- A source is successful only when its response satisfies its coverage rule. A valid response without target coverage is `missing`, not successful.
- Metadata sources, failed image URLs, trivia identities, and quote dates each persist an independent retry level and earliest retry time.
- Consecutive failures use a bounded escalating schedule of 1, 3, and 5 minutes; the third and later failures remain at 5 minutes. Transport/parsing failure and valid responses missing required coverage both advance the level.
- Success resets the corresponding retry level and timestamp. A new target date or changed/removed image, trivia, or quote identity resets the affected retry sequence.
- Backoff expiry does not wake the worker by itself. Network reconnection may bypass one active window per retry object, but does not reset its level; a failed bypass advances the sequence.
- Reconnection means a browser `online` event or the existing 15-second actual-connection check. Both feed the same per-object bypass guard; repeated events cannot bypass the same window more than once. Retry expiry only makes work eligible and neither interrupts an active fetch nor guarantees worker execution.
- Persisted refresh generation protects date rollover. Stale work may fill missing fields for the same date and identity or add safe non-display history; it may not replace an existing identity, modify new refresh state, or change the displayed date. Before a catalog commit, if a stale candidate's `date` equals the current display state's `date` but its `imageId` differs from the display state's `imageId`, the worker drops that entire candidate and merges none of its fields. Other independently valid candidates in the batch may still commit; the worker neither aborts the entire catalog write nor introduces a cross-storage transaction.

### Image scheduler and cache policy

- The regular worker has one image consumer and at most one active wallpaper image fetch.
- Baseline priority is target preview, target final resolution, historical previews, historical final resolutions, future previews, then future final resolutions.
- Historical and future phases run nearest date first. History is derived from catalog and cache state without waiting for Model; Model only contributes future work.
- Explicit current-display or navigation requests are urgent. They promote an existing pending canonical task or insert one at the front, but never interrupt the active fetch or start a second fetch.
- Every task performs an exact cache match before network access. One canonical URL has at most one pending or active task, and callers share its result. The task-map entry remains until cache success or failure bookkeeping completes; dispatch re-checks both the map and `cache.match()`, so a stale-generation response cached before a queue rebuild cannot cause a second network request.
- A historical item whose retry window is still active is skipped for that event and does not permanently block later history or future work.
- Image task generation is in memory. Catalog identity or resolution changes stop old pending dispatch. An active response is cached only when its canonical URL still belongs to the latest retention set.
- A resolution change does not cancel an active old-resolution fetch. If its response no longer belongs to the latest retention set, it is discarded before cache success bookkeeping; transient overlap during the transition is allowed, and the 32-key limit apply after the documented cleanup point before a new future batch.
- Worker restart reconstructs work from the catalog and Cache Storage instead of restoring an in-memory cursor.
- Retain the target, seven historical dates and up to seven future dates: 30 base keys at preview plus configured final resolution, with at most two extra page-display protection responses. The hard maximum after cleanup is 32 keys.
- Future prefetch may reach seven dates but remains best-effort, depending on Model coverage, network success, browser activity, worker lifetime and cache retention.
- `cachedFutureDepth` is diagnostic only, ranging 0..7 for consecutive future dates with both preview and configured final resolution cached. It never suppresses cache checks, retry, repair or prefetch.
- No byte ceiling is enforced. Measure HD and UHD steady-state bytes separately; the accepted roughly 36 MB UHD budget applies to the complete regular retention set.

### Display state and first paint

- Display state is one atomic snapshot containing the displayed date, image identity, final URL, a matching preview data URL or explicit empty value, and update timestamp. An empty preview is valid and recoverable; atomicity requires identity consistency, not preview completeness.
- It records the most recently completed final-image application and supplies the initial selection for new tabs in that context. A pending navigation remains page-local and does not publish its destination.
- During new-tab initialization, a matching preview may render as temporary page state before the selected final image. Manual navigation never renders the destination preview; it retains the current final image and shows `Wallpaper is updating...` until the destination final image is decoded and applied.
- Only a successfully applied final image is committed as the new atomic display snapshot. Failure leaves the previous snapshot unchanged.
- Concurrent page writes use atomic last-write-wins behavior for future readers without a cross-tab lock. Existing tabs are not required to follow later display-state writes from other tabs.
- A tab that reads before another tab completes navigation may remain on the previously committed selection. Tabs opened after the successful commit initialize from the new selection; target-date refresh alone does not overwrite that committed display choice.
- A page-local generation token rejects stale callbacks only within the page that created them.
- The boot path reads the context's v2 display snapshot and may paint its preview before the main wallpaper logic runs. It does not infer identity from data-URL bytes.
- Every new-tab initialization independently checks Cache Storage for the committed `date + imageId`, including when its preview data URL is empty. A cached final image is applied immediately without waiting for preview repair. When a matching preview is cached, the page reconstructs its data URL and persists it only after a fresh read confirms the global `date + imageId + final URL` are unchanged.
- Preview repair is opportunistic and does not rely solely on the original cache-completion notification. If a page rejects a notification after navigating away, that protects the page's current selection and does not mean the cached preview was lost; a later new-tab initialization retries repair from Cache Storage. No persisted `previewPending` state is added.
- The legacy untagged preview key is migration input only and is not copied into v2.
- When image identity changes and no matching preview is available, the page clears the old preview rather than pairing it with the new image.
- The extension document uses one fixed dark Gradient and no light-scheme override or inline black fallback. Chromium's pre-document white or black frame is outside extension control and is evaluated separately.

### Quotes and trivia

- Trivia is fetched only for target and historical entries with a trivia identifier and missing payload. Future entries become eligible when they enter the target/history window.
- Trivia work is derived only from committed catalog entries. A metadata candidate that was not committed, including one rejected by stale-generation admission, cannot directly schedule trivia work.
- The complete `triviaId` is the sole identity of a trivia payload and the in-flight deduplication key. Its embedded date and image-name slug do not make it the full wallpaper identity; no `date + imageId + triviaId` compound identity is used.
- A trivia request captures the catalog date only as an entry locator. Both success and failure commits run through the serialized catalog-write queue, fresh-read the entry, and apply only if its current `triviaId` still matches. A missing entry or changed `triviaId` discards the entire result without modifying payload or retry state. An unchanged `triviaId` remains admissible across refresh-generation rollover.
- Trivia in-flight state is not persisted. Failure keeps the entry retryable with its own persisted bounded backoff level.
- Quote scraping uses a 60-second lease with a worker-generated random token. Expired or replaced tokens cannot submit.
- UUID generation belongs to the Worker/runtime adapter, which calls `globalThis.crypto.randomUUID()` only for an actual grant. Pure lease logic accepts an opaque token or injected `generateToken`; shared browser-targeted modules do not require `node:crypto`.
- A successful quote sync or remote fallback clears the lease immediately. Quote work never blocks wallpaper display.
- The quote fallback URL is a shared sync setting; quote caches and leases remain context-local.
- `qotd_url` is valid only as an absolute HTTPS URL under the same setting-validation rule used during migration. Worker fallback requests use `credentials: "omit"`, `cache: "no-store"`, and `redirect: "error"`; the response body is limited to 64 KiB and must be structured JSON containing a quote text string plus optional source and caption strings, rendered as text rather than HTML. Invalid URL, redirect, size, or payload validation preserves an existing valid Quote and records failure.
- Quote dates are derived from the committed catalog, and pages select quotes by the committed display-state date. Rejected metadata candidates therefore cannot schedule quote work or change which quote a page displays.

### Shared settings

- The shared settings are the search-engine list, current search engine, search-box visibility, top-sites visibility, clock visibility, quote visibility, UHD setting, and quote fallback URL.
- Pages and the worker read and write these settings through Chrome sync storage after migration and react to relevant sync changes.
- Existing storage permission covers sync storage; no additional permission is added.

### Migration

- The regular worker runs v1-to-v2 migration using `wallpaper_migration_v2_state`; no incognito migration or self-seeding path exists. It converts `bing_images` into the v2 catalog and copies missing quote data from `cache_quote_state` into the unsuffixed quote state. The first page continues to consume `wallpaper_date`, `wallpaper_idx`, `wallpaper_url`, and `wallpaper_preload_data_url` as page-owned migration inputs. A new marker starts at `writing` and advances only after verifying actual state. An old quote lease is not carried over. Sync settings remain intact.
- The worker imports up to eight valid legacy wallpaper dates and fills only missing quote data from the legacy regular cache, canonicalizes identities, and preserves valid trivia completion.
- Shared settings migrate with this precedence: valid existing sync value, valid local value, then existing default.
- Sync values are fresh-read and verified before migrated local setting keys are deleted. Failure leaves local values intact and migration retryable.
- The worker writes and verifies the regular catalog and quote state but does not write display state.
- The first regular page consumes verified catalog plus retained legacy display inputs, writes a valid or explicit empty v2 display snapshot, and acknowledges the handoff.
- The worker verifies the page-owned display snapshot before marking migration complete and deleting obsolete display inputs. The first valid acknowledgement while the marker is `verified` completes the handoff; duplicate or late acknowledgements after `complete` are no-ops.
- Valid v2 state always has read priority over residual v1 state. Interrupted phases resume or rebuild idempotently.
- If a partial v2 catalog exists after interruption, migration fresh-reads and validates it, preserves every valid existing entry and field, and merges only missing legacy dates or fields using the existing identity and source-priority rules. It never replaces valid v2 data with a fresh legacy import; invalid or conflicting entries follow the normal validation rules.
- Retained responses from `funbingbing-wallpaper-cache-v1`, then visible legacy responses missing from the unsuffixed v2 cache, are copied by canonical URL. v1 names remain until page-owned migration and cleanup are verified; interrupted transfer is retryable.

## Testing Decisions

Tests should assert externally meaningful state transitions, network behavior,
cache contents, ownership, and visible results. They should not assert private
helper call counts, internal queue array layout, or timing more precise than the
documented ordering and cooldown boundaries.

### Pure-logic seam

- Test target-date calculation under multiple process timezones.
- Test full image identity extraction, canonical URL rebuilding, known suffix validation, and rejection of malformed inputs.
- Test deterministic metadata merge priority and rejection of cross-identity merges under every response order.
- Use a table-driven response-order matrix for IOTD, MediaContents, PreloadMediaContents, and Archive; assert field-level winners, whole-record replacement on identity change, and Archive-success invalidation after an IOTD identity change.
- Test Archive trivia-ID normalization for missing/null/non-string/empty, valid format, malformed format, multiple date-like segments, and invalid dates; malformed values are cleared, diagnosed, and never scheduled.
- Test source coverage rules and the difference between failed, missing, and successful responses.
- Test the complete 1, 3, 5, 5 minute sequence, saturation at level 3, independent retry objects, all reset conditions, restart continuity, and one reconnect bypass per active window.
- Test reconnect through both the browser `online` event and the 15-second actual-connection check: one retry object gets at most one bypass per active window, expiry alone does not wake the worker, and no active fetch is interrupted.
- Test stale-generation admission rules for current, historical, and displayed identities, including whole-candidate rejection on a displayed-identity conflict while independently valid candidates in the same batch still commit.
- Test trivia result admission independently of refresh generation: `triviaId` is the sole work identity, date only locates the latest entry, and an unchanged `triviaId` remains admissible after generation rollover.
- Test retention-set derivation, display protection, the 30-key base/32-key hard maximum, and removal of unreferenced failure records.
- Test scheduler derivation in the exact baseline order: target, history, future. Confirm history is derived without Model and backoff-skipped history does not block future work.
- Test canonical URL deduplication, urgent promotion, active-task sharing, and generation-based write admission. Include an active stale-generation fetch that remains retained, then rebuild the queue after its successful `cache.put()` and assert the rebuilt task is skipped without another network request.
- Test rapid HD/UHD changes with an active obsolete fetch: the fetch is not canceled, an obsolete response is not recorded as success, transient old keys are cleaned before the next future batch, and the post-cleanup retention bound is restored.
- Test `cachedFutureDepth` across complete days, gaps, preview-only hits, resolution changes and stale diagnostic state; the range is 0..7.
- Test navigation over zero through eight entries and display-date lookup without a persisted index.
- Test preview repair from an atomic display snapshot with an explicit empty preview: startup applies the cached final immediately, reconstructs a cached matching preview without an earlier notification, rejects the repair after display identity changes, and retries after a simulated crash before repair. Include the cross-tab sequence where Tab2 navigates away before B's notification: its B callback is rejected, a later tab repairs B if B remains globally current, and B's preview is never written into a subsequently committed C snapshot.
- Test quote lease expiry, replacement, success clearing, and token rejection.
- Load pure lease logic under Node with an injected deterministic token generator; denied grants do not call it, and the browser adapter remains the only `globalThis.crypto.randomUUID()` caller.
- Test display, catalog-root, and entry `updatedAt` assignment on successful commits, preservation on failure/rejection, and independence from last-write-wins, retry, cache, and stale-result decisions.
- Test setting migration precedence and all migration phases through verification and page acknowledgement, including idempotent restart in each phase.
- Test duplicate and late `migrationDisplayStateReady` acknowledgements as one completion/cleanup effect, and restart with a valid partial v2 catalog to assert existing fields are preserved while only missing legacy data is merged.

### Service-worker message seam

- Test catalog refresh messages with mocked metadata responses and observable storage/catalog output.
- Test that repeated refresh messages share work and do not repeat already-successful current-date sources.
- Test that rejected or uncommitted metadata candidates never schedule trivia. Delay trivia success and failure results across entry replacement; both must be discarded when the latest entry's `triviaId` differs, without changing its payload or retry state.
- Test image-cache requests reject arbitrary dates, resolutions, or URLs and accept only canonical URLs derived from the context catalog.
- Test image request ordering and cache effects across target, history, future, urgent navigation, escalating backoff, reconnect bypass, and resolution changes.
- Test worker termination during an unresolved target, historical, and future image fetch: no interrupted attempt becomes a cache success, the next event retries the missing URL, and no same-URL requests overlap across the termination boundary.
- Test that the worker never writes display state and page acknowledgement is required for migration completion.
- Test quote lease grant, quote submission, remote fallback, and update notifications through message contracts.
- Test broadcasts with no listening pages and confirm there are no unhandled message failures.
- Test regular multi-tab behavior and sync setting propagation without creating a second runtime context.
- Test the manifest declares `"incognito": "not_allowed"`; no incognito catalog, queue, lease or lifecycle cleanup is initialized.

### Chrome and Playwright seam

- Load the actual Manifest V3 extension rather than a page-only test harness.
- Warm cache: opening a new tab shows the selected cached wallpaper without waiting for the network. Assert zero Bing metadata requests only when all three source coverage checks have succeeded for the same target date; cached image responses alone must not suppress eligible retries of missing or failed metadata sources.
- Empty boot preview with cached final and preview: the main initialization applies the final immediately and repairs the matching preview data URL without depending on an earlier cache notification; a later new tab can use the repaired boot preview.
- Cold online start: the extension-controlled Gradient appears, followed by one guarded image transition.
- Record dark-mode and light-mode new-tab startup from before document rendering; classify Chromium's pre-document frame separately from extension-controlled rendering.
- New-tab slow connection: the selected image's matching preview appears without waiting for final resolution, followed by one final-image swap.
- Offline startup: display whatever applicable content is actually cached; do not require a guaranteed seven-day future depth.
- Navigation: zero entries disable controls, three entries wrap correctly, and an uncached selection retains the current final image with `Wallpaper is updating...`; its preview is never rendered and display state changes only after the final image is applied.
- Priority: observe target requests first, permitted historical work next and up to seven future dates last. Explicit navigation promotes its task after the active request.
- Resolution change: fetch current resolution first, then historical, then future; previews and metadata are not re-downloaded.
- Worker termination: stop the worker during metadata, history, future prefetch, trivia, and migration phases; the next qualifying event resumes only missing work.
- Stale responses: delay old-date source responses and verify they cannot replace current or historical identities or corrupt refresh state.
- Stale trivia: delay a trivia response, replace the catalog entry's `triviaId`, and verify the late success or failure cannot mutate the replacement entry. Repeat with generation rollover but an unchanged `triviaId` and verify the result remains admissible.
- Concurrency: observe at most one active wallpaper image fetch in the regular worker, including navigation during background work.
- Multiple regular tabs: while Tab1 is still loading navigation from A to B, Tab2 may initialize from committed state A and need not follow Tab1's later commit. A tab opened after B commits initializes from B's exact date, identity, and final URL, allowing only B's matching startup preview. If an existing tab navigates away before B preview repair, its stale B callback is rejected; a later tab repairs B from Cache Storage only if B is still the global snapshot, and never applies B's preview to a subsequently committed C snapshot. Concurrent commits remain atomic, and last-write-wins affects future readers rather than forcing live convergence.
- Unsupported mode: normal New Tab loads Ataraxia; incognito New Tab stays the Chrome-provided page and does not run this extension in incognito. Manually navigating to an extension options/newtab URL is not evidence of incognito New Tab support.
- Migration: cover sync-wins/local-fallback/default-fallback, failed-write retention, page acknowledgement, restart at every phase, interrupted v1-to-v2 transfer, valid unsuffixed precedence, and eventual v1 cleanup. Worker termination or browser restart must still validate actual Cache Storage before display; no private-session lifecycle tests are required.
- Cache eviction simulation: remove retained responses and verify the next event repairs actual misses rather than trusting catalog entries or diagnostic depth.
- Measure HD and UHD retained response bytes for the regular 32-key retention policy without a pass/fail byte threshold.

Prior art includes the existing Node test style for isolated pure helpers and the
project's Playwright approach for loading and observing the real extension. New
test hooks should be added only when state, network, storage, and message seams
cannot expose the required behavior directly.

## Out of Scope

- Supporting Bing markets other than `zh-CN` or selecting a market dynamically.
- Adding alarms or another guaranteed background wakeup mechanism.
- Guaranteeing seven future cached days or preventing Chrome from evicting Cache Storage.
- Adding `unlimitedStorage` or enforcing a guessed byte ceiling.
- Parallel wallpaper image downloads within one context.
- Incognito support, private-session storage backends, last-private-window cleanup, or a workaround for Chrome’s incognito New Tab override restriction.
- Cross-tab locks or live synchronization of already-open tabs; atomic last-write-wins defines the persisted starting point for future readers.
- A light-specific extension fallback, a bundled fallback photograph, or control over Chromium's pre-document frame.
- Persisting in-flight trivia, image queue cursors, or image scheduler generation.
- Preserving v1 compatibility after verified migration completion.
- Adding new markets, resolution variants, portrait images, or dynamic cache-depth settings.

## Further Notes

- ADRs are the final authority over this spec and PLAN9 when wording conflicts.
- The active ADR set intentionally skips ADR-0007 because its untagged, worker-owned preview design was superseded by the page-owned atomic display-state decision in ADR-0008.
- ADR-0002 remains active after ADR-0005 made future depth best-effort; the regular UHD budget is unchanged. ADR-0015 supersedes ADR-0011 and the incognito portions of earlier decisions.
- `cachedFutureDepth` is observability, not truth about current Cache Storage after browser eviction.
- A 1, 3, or 5-minute retry timestamp is the earliest permitted retry, not a timer or guaranteed execution time.
- The user-visible priority principle is current content first, navigable history second, invisible future content last.

---

**Document status**: Ready for implementation  
**Revision**: 17
**Date**: 2026-09-24
