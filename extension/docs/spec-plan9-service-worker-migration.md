# Spec: Service Worker-Managed Wallpaper Pipeline (PLAN9)

## Problem Statement

The current new-tab implementation lets page instances participate in wallpaper
metadata retrieval, image downloading, cache mutation, and legacy state updates.
Opening multiple tabs can therefore duplicate work or race on storage. A new tab
may also wait for unrelated metadata, trivia, or quote work before the wallpaper
is ready.

The extension needs one coherent wallpaper pipeline that displays cached content
immediately, preserves navigable history, makes useful offline progress, survives
Manifest V3 service-worker suspension, and keeps regular and incognito browsing
state isolated. Shared product settings must nevertheless remain consistent
between those contexts.

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
consumer per context. After the target wallpaper, prioritize navigable historical
images before invisible future prefetch. Regular future depth remains best-effort
up to seven dates; incognito future prefetch is limited to the next date by
ADR-0011.

Regular and split-incognito contexts keep separate catalogs, image caches, quote
state, and display state. Product settings live in Chrome sync storage so both
contexts see the same configuration. The regular context performs a retryable
v1-to-v2 migration; incognito initializes independently.

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
17. As an incognito user, I want at most the next future date prefetched, so that a short-lived private session does not spend bandwidth building a seven-day window.
18. As a user who enables UHD, I want the current UHD wallpaper first, then historical UHD images, then future UHD images allowed for my context, so that visible content is upgraded before speculative content.
19. As a user who changes resolution repeatedly, I want duplicate canonical requests avoided and obsolete work discarded safely, so that toggling does not waste bandwidth.
19. As a user, I want the page to avoid repeated Bing metadata requests when the current source data is already complete, so that opening tabs does not create redundant traffic.
20. As a user, I want temporary Bing failures or missing target-date data to recover later, so that one bad response cannot permanently suppress updates.
21. As a user, I want network reconnection to permit one prompt retry without creating a reconnect storm, so that recovery is responsive but controlled.
22. As a user, I want a suspended service worker to resume from persisted catalog and cache state, so that completed downloads are not repeated.
23. As a user, I want stale asynchronous responses prevented from changing a newer wallpaper identity, so that date rollover and concurrent work cannot corrupt the catalog.
24. As a user opening another regular tab, I want it to initialize from the latest completed context display state available when it reads, without forcing already-open tabs to follow later writes.
25. As a user with multiple tabs, I want an old callback in one tab prevented from overriding a newer action in that same tab, so that local races do not undo navigation.
26. As an incognito user, I want wallpaper history, quotes, display state, and cached images isolated from regular browsing, so that private activity is not persisted into the regular context.
27. As a user, I want product settings shared between regular and incognito windows, so that UHD, quote fallback, search, and widget preferences do not diverge.
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

- Active ADRs are authoritative when PLAN9 and an ADR disagree. The active set is ADR-0001 through ADR-0006 and ADR-0008 through ADR-0010. ADR numbering is not compacted after removal of the superseded ADR-0007.
- The wallpaper market remains fixed to `zh-CN`, and the target date is calculated at the Asia/Shanghai market boundary.
- A wallpaper date is a Bing publication identity, not the user's local calendar date. Display formatting does not perform timezone conversion.

### Ownership and context boundaries

- Each context's worker exclusively writes its wallpaper catalog, Cache Storage, quote cache, and quote lease state.
- Pages read the catalog and Cache Storage. They do not fetch wallpaper images directly and do not write image responses.
- Pages may fetch and parse quote HTML only after obtaining a worker lease; the worker validates and persists the result.
- Pages exclusively write the context's display state. The worker may read it for identity and retention decisions but never writes it.
- Regular and incognito contexts use distinct logical keys and cache names even when Chrome's underlying partition behavior would already separate them.
- Shared product settings use Chrome sync storage. Context-local wallpaper, quote, display, migration, and cache state stay in local storage or Cache Storage.

### Catalog and identity

- The v2 catalog stores target-date refresh state, source status, image failure cooldowns, and entries indexed by publication date.
- Each entry includes a full image identity, canonical preview/HD/UHD URLs, staged metadata, trivia state, and timestamps.
- Metadata stages are monotonic for the same date and identity: legacy, Archive, PreloadMediaContents, MediaContents, then ImageOfTheDay.
- Different sources merge only when both date and full image identity match. A higher metadata stage cannot justify merging fields from a different photograph.
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
- Persisted refresh generation protects date rollover. Stale work may fill missing fields for the same date and identity or add safe non-display history; it may not replace an existing identity, modify new refresh state, or change the displayed date. Before a catalog commit, if a stale candidate's `date` equals the current display state's `date` but its `imageId` differs from the display state's `imageId`, the worker drops that entire candidate and merges none of its fields. Other independently valid candidates in the batch may still commit; the worker neither aborts the entire catalog write nor introduces a cross-storage transaction.

### Image scheduler and cache policy

- Each context has one image consumer and at most one active wallpaper image fetch. Regular and incognito contexts may progress independently.
- Baseline priority is target preview, target final resolution, historical previews, historical final resolutions, future previews, then future final resolutions.
- Historical and future phases run nearest date first. History is derived from catalog and cache state without waiting for Model; Model only contributes future work.
- Explicit current-display or navigation requests are urgent. They promote an existing pending canonical task or insert one at the front, but never interrupt the active fetch or start a second fetch.
- Every task performs an exact cache match before network access. One canonical URL has at most one pending or active task, and callers share its result.
- A historical item whose retry window is still active is skipped for that event and does not permanently block later history or future work.
- Image task generation is in memory. Catalog identity or resolution changes stop old pending dispatch. An active response is cached only when its canonical URL still belongs to the latest retention set.
- Worker restart reconstructs work from the catalog and Cache Storage instead of restoring an in-memory cursor.
- The base retention set is context-specific: target plus seven historical dates and up to seven future dates for regular context, or up to one future date for incognito. Each retained date has preview and configured final resolution. A page-owned display outside that set can protect up to two additional responses. The hard maximum is 32 keys for regular and 20 for incognito.
- Future prefetch is best-effort. Regular context may reach seven dates; incognito is limited to the next date. Both depend on Model coverage, network success, browser activity, service-worker lifetime, and browser cache retention.
- `cachedFutureDepth` is diagnostic only: it reports consecutive future dates with both preview and configured final resolution at the most recent scan, with a `0..7` regular limit and `0..1` incognito limit. It never suppresses cache checks, retry, repair, or prefetch.
- No byte ceiling is enforced. HD and UHD steady-state bytes are measured separately; the accepted roughly 36 MB UHD budget applies to a complete regular retention set, while incognito has the smaller context-specific set.

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
- Preview repair is opportunistic and does not rely solely on the original cache-completion notification. No persisted `previewPending` state is added.
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
- A successful quote sync or remote fallback clears the lease immediately. Quote work never blocks wallpaper display.
- The quote fallback URL is a shared sync setting; quote caches and leases remain context-local.
- Quote dates are derived from the committed catalog, and pages select quotes by the committed display-state date. Rejected metadata candidates therefore cannot schedule quote work or change which quote a page displays.

### Shared settings

- The shared settings are the search-engine list, current search engine, search-box visibility, top-sites visibility, clock visibility, quote visibility, UHD setting, and quote fallback URL.
- Pages and the worker read and write these settings through Chrome sync storage after migration and react to relevant sync changes.
- Existing storage permission covers sync storage; no additional permission is added.

### Migration

- Only the regular context runs v1-to-v2 migration. Incognito self-seeds and never waits for the regular migration marker.
- The worker imports up to eight valid legacy wallpaper dates and the regular quote cache, canonicalizes identities, and preserves valid trivia completion.
- Shared settings migrate with this precedence: valid existing sync value, valid local value, then existing default.
- Sync values are fresh-read and verified before migrated local setting keys are deleted. Failure leaves local values intact and migration retryable.
- The worker writes and verifies the regular catalog and quote state but does not write display state.
- The first regular page consumes verified catalog plus retained legacy display inputs, writes a valid or explicit empty v2 display snapshot, and acknowledges the handoff.
- The worker verifies the page-owned display snapshot before marking migration complete and deleting obsolete display inputs.
- Valid v2 state always has read priority over residual v1 state. Interrupted phases resume or rebuild idempotently.
- Visible legacy cache responses may be copied into the regular v2 cache by canonical URL before the old cache is removed.

## Testing Decisions

Tests should assert externally meaningful state transitions, network behavior,
cache contents, ownership, and visible results. They should not assert private
helper call counts, internal queue array layout, or timing more precise than the
documented ordering and cooldown boundaries.

### Pure-logic seam

- Test target-date calculation under multiple process timezones.
- Test full image identity extraction, canonical URL rebuilding, known suffix validation, and rejection of malformed inputs.
- Test deterministic metadata merge priority and rejection of cross-identity merges under every response order.
- Test source coverage rules and the difference between failed, missing, and successful responses.
- Test the complete 1, 3, 5, 5 minute sequence, saturation at level 3, independent retry objects, all reset conditions, restart continuity, and one reconnect bypass per active window.
- Test stale-generation admission rules for current, historical, and displayed identities, including whole-candidate rejection on a displayed-identity conflict while independently valid candidates in the same batch still commit.
- Test trivia result admission independently of refresh generation: `triviaId` is the sole work identity, date only locates the latest entry, and an unchanged `triviaId` remains admissible after generation rollover.
- Test context-specific retention-set derivation, display protection, 32-key regular maximum, 20-key incognito maximum, and removal of unreferenced failure records.
- Test scheduler derivation in the exact baseline order: target, history, future. Confirm history is derived without Model and backoff-skipped history does not block future work.
- Test canonical URL deduplication, urgent promotion, active-task sharing, and generation-based write admission.
- Test `cachedFutureDepth` across complete days, gaps, preview-only hits, resolution changes, stale diagnostic state, and the `0..1` incognito cap.
- Test navigation over zero through eight entries and display-date lookup without a persisted index.
- Test preview repair from an atomic display snapshot with an explicit empty preview: startup applies the cached final immediately, reconstructs a cached matching preview without an earlier notification, rejects the repair after display identity changes, and retries after a simulated crash before repair.
- Test quote lease expiry, replacement, success clearing, and token rejection.
- Test setting migration precedence and migration state transitions through verification and page acknowledgement.

### Service-worker message seam

- Test catalog refresh messages with mocked metadata responses and observable storage/catalog output.
- Test that repeated refresh messages share work and do not repeat already-successful current-date sources.
- Test that rejected or uncommitted metadata candidates never schedule trivia. Delay trivia success and failure results across entry replacement; both must be discarded when the latest entry's `triviaId` differs, without changing its payload or retry state.
- Test image-cache requests reject arbitrary dates, resolutions, or URLs and accept only canonical URLs derived from the context catalog.
- Test image request ordering and cache effects across target, history, future, urgent navigation, escalating backoff, reconnect bypass, and resolution changes.
- Test that the worker never writes display state and that page acknowledgement is required for migration completion.
- Test quote lease grant, quote submission, remote fallback, and update notifications through message contracts.
- Test broadcasts with no listening pages and confirm there are no unhandled message failures.
- Test regular and incognito worker instances against separate logical state while reading the same sync settings; incognito must not enqueue future dates beyond `targetDate + 1`.

### Chrome and Playwright seam

- Load the actual Manifest V3 extension rather than a page-only test harness.
- Warm cache: opening a new tab shows the current wallpaper without Bing metadata requests.
- Empty boot preview with cached final and preview: the main initialization applies the final immediately and repairs the matching preview data URL without depending on an earlier cache notification; a later new tab can use the repaired boot preview.
- Cold online start: the extension-controlled Gradient appears, followed by one guarded image transition.
- Record dark-mode and light-mode new-tab startup from before document rendering; classify Chromium's pre-document frame separately from extension-controlled rendering.
- New-tab slow connection: the selected image's matching preview appears without waiting for final resolution, followed by one final-image swap.
- Offline startup: display whatever applicable content is actually cached; do not require a guaranteed seven-day future depth.
- Navigation: zero entries disable controls, three entries wrap correctly, and an uncached selection retains the current final image with `Wallpaper is updating...`; its preview is never rendered and display state changes only after the final image is applied.
- Priority: with target, historical, and future misses present, observe target requests first, all permitted historical work next, and future work last. Explicit navigation promotes its task after the active request. Regular may enqueue up to seven future dates; incognito may enqueue only `targetDate + 1`.
- Resolution change: fetch current resolution first, then historical, then future; previews and metadata are not re-downloaded.
- Worker termination: stop the worker during metadata, history, future prefetch, trivia, and migration phases; the next qualifying event resumes only missing work.
- Stale responses: delay old-date source responses and verify they cannot replace current or historical identities or corrupt refresh state.
- Stale trivia: delay a trivia response, replace the catalog entry's `triviaId`, and verify the late success or failure cannot mutate the replacement entry. Repeat with generation rollover but an unchanged `triviaId` and verify the result remains admissible.
- Concurrency: observe at most one active wallpaper image fetch per context, including navigation during background work.
- Multiple regular tabs: while Tab1 is still loading navigation from A to B, Tab2 may initialize from committed state A and need not follow Tab1's later commit. A tab opened after B commits initializes from B's exact date, identity, and final URL, allowing only B's matching startup preview. Concurrent commits remain atomic, and last-write-wins affects future readers rather than forcing live convergence.
- Regular plus incognito: verify separate catalogs, caches, quotes, and display states, while both contexts observe the same sync-backed settings; verify that incognito retains at most one future date and two future responses.
- Migration: cover existing sync wins, local fallback, default fallback, sync write failure, page-owned display acknowledgement, restart at every phase, and final legacy cleanup.
- Cache eviction simulation: remove retained responses and verify the next event repairs actual misses rather than trusting catalog entries or diagnostic depth.
- Measure HD and UHD retained response bytes for both context policies without a pass/fail byte threshold.

Prior art includes the existing Node test style for isolated pure helpers and the
project's Playwright approach for loading and observing the real extension. New
test hooks should be added only when state, network, storage, and message seams
cannot expose the required behavior directly.

## Out of Scope

- Supporting Bing markets other than `zh-CN` or selecting a market dynamically.
- Adding alarms or another guaranteed background wakeup mechanism.
- Guaranteeing seven future cached days in regular context, guaranteeing even one future cached day in incognito, or preventing Chrome from evicting Cache Storage.
- Adding `unlimitedStorage` or enforcing a guessed byte ceiling.
- Parallel wallpaper image downloads within one context.
- Coordinating regular and incognito runtime wallpaper state.
- Cross-tab locks or live synchronization of already-open tabs; atomic last-write-wins defines the persisted starting point for future readers.
- A light-specific extension fallback, a bundled fallback photograph, or control over Chromium's pre-document frame.
- Persisting in-flight trivia, image queue cursors, or image scheduler generation.
- Preserving v1 compatibility after verified migration completion.
- Adding new markets, resolution variants, portrait images, or dynamic cache-depth settings.

## Further Notes

- ADRs are the final authority over this spec and PLAN9 when wording conflicts.
- The active ADR set intentionally skips ADR-0007 because its untagged, worker-owned preview design was superseded by the page-owned atomic display-state decision in ADR-0008.
- ADR-0002 remains active despite ADR-0005 changing the regular seven-day benefit from guaranteed to best-effort; it records the still-accepted regular-context UHD storage budget. ADR-0011 defines the smaller incognito policy.
- `cachedFutureDepth` is observability, not truth about current Cache Storage after browser eviction.
- A 1, 3, or 5-minute retry timestamp is the earliest permitted retry, not a timer or guaranteed execution time.
- The user-visible priority principle is current content first, navigable history second, invisible future content last.

---

**Document status**: Ready for implementation  
**Revision**: 11  
**Date**: 2026-08-21
