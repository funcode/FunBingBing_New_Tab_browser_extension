# Wallpaper Actions

Tracking issue: [#154 — Spec: independent wallpaper download and Windows/macOS desktop actions](https://github.com/funcode/FunBingBing/issues/154)

Status: published; testing boundaries confirmed. Runtime implementation pending.

Labels: ready-for-agent, agent-ready, enhancement.
Project: funcode’s project, FunBingBing view — Todo.

## Problem Statement

Users viewing a wallpaper in Ataraxia's Supported New Tab cannot save the picture or apply it as their Windows/macOS desktop wallpaper directly from that page. They must find the correct image, download it, locate the saved file, and use operating-system settings themselves. A user can also have several tabs showing different pictures, making a shared selection an unreliable source for either action.

Adding desktop integration must preserve fast new-tab startup and the existing wallpaper display contract. It must remain optional, provide a useful standalone download action without a native companion, and avoid running a companion merely because a tab opens or the pointer enters the controls.

## Solution

Offer an independent wallpaper-action group with two separately configurable actions: **Download image** and **Set as desktop wallpaper**. Initially position the group in the area below the clock, while keeping its structure, positioning, visibility, and lifetime independent of the clock and other components.

Both actions capture the picture actually visible in the clicked tab at its configured **Final resolution**, save it through the browser's download manager, and respect the completed download's actual destination. Suggest the browser's Downloads directory by default, with an optional relative subfolder. The desktop action then asks a separately installed native helper to apply that completed file directly to all connected displays using proportional Fill. It creates no helper-owned image copy.

Setup supplies an image-download switch, a verified desktop-integration switch, a shared folder control, installer guidance, and **Check again**. Persist **Last-known helper availability** locally after explicit successful verification. Ordinary tab openings, hover, keyboard focus, and browser restarts read that hint without launching the helper. Users manage downloaded files themselves; this feature adds no storage cap or automatic cleanup.

## User Stories

1. As a Supported New Tab user, I want a Download image action beside the desktop action, so that I can save the photograph without opening another website.
2. As a user, I want independent setup switches for image downloading and desktop application, so that I can enable either action without enabling the other.
3. As a new user, I want image downloading enabled by default and desktop integration off until verified, so that saving is discoverable without implying that native software is already available.
4. As a user with no helper installed, I want the enabled Download image action to work independently, so that native installation is optional for saving pictures.
5. As a user who enables only desktop application, I want its required file save to remain functional, so that disabling the standalone Download button does not break desktop application.
6. As a user who disables both actions, I want their group hidden, so that unused controls do not occupy the wallpaper or keyboard navigation.
7. As a user, I want the shared download-folder control enabled whenever either action is enabled, so that I can configure the destination for whichever action I use.
8. As a user who disables both actions, I want the inactive folder control to retain its value, so that re-enabling an action restores my previous destination suggestion.
9. As a user, I want Downloads to be the default destination, so that the feature works without requiring folder customization.
10. As a user, I want to specify a relative subfolder under the browser's Downloads directory, so that I can organize saved wallpapers.
11. As a user whose browser asks where to save, I want my final destination choice respected, so that an explicit Save As choice takes precedence over the suggested folder.
12. As a user, I want the desktop action to use the actual completed download's filename, so that browser renaming, filename conflicts, and destination choices do not make it apply the wrong file.
13. As a user, I want an action to capture the photograph visible in the tab I clicked, so that it cannot accidentally use another tab's selection.
14. As a user who navigates immediately after clicking, I want the operation to retain its original photograph, so that later navigation cannot change the requested save or desktop image.
15. As a user with multiple tabs showing different photographs, I want each tab's actions to use its own visible picture, so that a newer shared display record cannot retarget an older tab's action.
16. As an HD user, I want both actions to use HD, so that saving does not silently trigger a UHD upgrade.
17. As a UHD user, I want both actions to use the configured UHD image, so that the exported photograph matches my chosen Final resolution.
18. As a user seeing only a Preview, I want the actions disabled with an explanatory loading state, so that a Preview is never silently exported.
19. As a user seeing a fallback background, I want image actions unavailable, so that the feature does not save an unrelated or nonexistent picture.
20. As a user changing resolution, I want eligibility to reflect the visible picture at the configured Final resolution, so that a pending resolution change cannot silently export the wrong resolution.
21. As a user, I want the action group independent of the clock and other components, so that those components can be hidden or rearranged without breaking the actions.
22. As a user, I want the initial action group below the clock area without moving the clock, so that the existing composition remains familiar.
23. As a user who hides the clock, I want the action group available in the same location, so that clock visibility does not control wallpaper actions.
24. As a user, I want enabled actions revealed by pointer hover or keyboard focus and hidden while idle, so that the photograph stays unobstructed.
25. As a keyboard user, I want reachable controls, explicit accessible names, and understandable status feedback, so that I can use the feature without a pointer.
26. As a user, I want the download button to remain stationary while availability loads or an explicit helper check completes, so that a newly revealed desktop action cannot move the target under my pointer.
27. As a user saving for the first time, I want an explanation before the optional downloads-permission request, so that I understand why the browser is asking for access.
28. As a user who declines downloads permission, I want a clear explanation and no attempted tracked save or desktop change, so that denial is respected.
29. As a user downloading a picture, I want normal browser download prompts, progress, conflict handling, and cancellation, so that saving behaves consistently with my browser.
30. As a user, I want a descriptive filename reflecting the selected picture and resolution, so that I can recognize saved wallpapers.
31. As a user applying desktop wallpaper, I want saving to finish before the helper receives the file, so that the OS never reads an incomplete download.
32. As a user who cancels a download, I want no desktop application to follow, so that cancellation stops the requested save-before-apply flow.
33. As a user whose save fails because of access or disk conditions, I want the desktop left unchanged and the save problem explained, so that a failed prerequisite is not reported as a successful wallpaper change.
34. As a user, I want the downloaded file to be the desktop's source without another helper-owned image copy, so that the feature avoids duplicate stored images.
35. As a user whose desktop operation fails after saving, I want the downloaded file retained, so that the successful save remains mine to use or remove.
36. As a user, I want no feature-level storage cap, quota accounting, threshold warning, or automatic file cleanup, so that I control downloaded-file storage myself.
37. As a user, I want setup guidance to explain that moving or deleting an applied file may affect wallpaper persistence, so that I can make informed cleanup decisions.
38. As a user without the helper, I want installer guidance discoverable in Setup even though the desktop button is hidden, so that I can enable the feature.
39. As a Windows or macOS user, I want an installer that registers the native helper with Chrome and Edge, so that the browsers can launch it when authorized.
40. As a user enabling desktop integration, I want Native Messaging permission requested through my explicit setup action, so that hover and tab opening cannot produce permission prompts.
41. As a user turning Enable desktop wallpaper on, I want one compatible-helper verification before the switch stays on, so that its persisted availability has been checked.
42. As a user whose enable check fails or whose native permission is denied, I want the switch left off with guidance, so that setup does not falsely claim readiness.
43. As a user turning desktop integration off, I want the flag cleared and desktop action hidden without launching the helper, so that disabling it is immediate and inexpensive.
44. As a user who turns the switch off during a pending check, I want late responses ignored, so that old asynchronous work cannot turn the switch back on.
45. As a user who has verified the helper, I want that Last-known helper availability remembered across browser sessions, so that later tab openings do not require another native process.
46. As a user opening tabs, hovering, or using keyboard focus, I want those events to read the saved availability hint only, so that discovering the controls does not launch the helper.
47. As a user without a positive availability hint, I want setup to remain explicit rather than automatically probing on each session or hover, so that failed detection does not create repeated background work.
48. As a user who installs, repairs, or updates the helper, I want Check again to perform a fresh explicit verification, so that I can refresh availability without changing the wallpaper.
49. As a user whose helper has been removed or become incompatible, I want actual use or rechecking to clear the stale hint and show setup guidance, so that the interface recovers from outdated installation state.
50. As a user whose compatible helper reports an OS wallpaper error, I want integration to remain enabled, so that a wallpaper-setting failure is not confused with missing software.
51. As a user whose save or notification fails, I want that failure kept separate from helper availability, so that unrelated errors do not hide a working desktop action.
52. As a user with connected displays, I want one desktop action to apply the same photograph to all of them, so that a monitor chooser is unnecessary.
53. As a user with displays of different shapes, I want proportional Fill with cropping, so that the image fills each display without distortion.
54. As a macOS user, I want the limitation regarding all Spaces explained, so that connected-display support is not mistaken for a promise to update every virtual desktop.
55. As a user starting a desktop change from several tabs or browsers, I want only one Ataraxia desktop operation at a time for my OS user, so that our helper instances do not race.
56. As a user whose desktop request overlaps another, I want a Busy result without queuing, so that an old request cannot unexpectedly change my desktop later.
57. As a user saving an image while a desktop operation is busy, I want standalone downloads to remain independent, so that native contention does not disable ordinary saving.
58. As a user whose displays update only partly, I want the successful changes retained and the partial result reported, so that the feature does not attempt an unexpected rollback.
59. As a user encountering a failed or partial desktop result, I want retries to be explicit, so that background retry logic cannot overwrite a later wallpaper choice.
60. As a user whose final acknowledgement is lost after possible OS mutation, I want an unconfirmed-result message asking me to check the desktop, so that the feature does not invent success or definite failure.
61. As a user who closes the originating tab after helper acceptance of the completed file, I want the operation to continue through the background connection, so that I need not keep the tab open.
62. As a user, I want browser shutdown's completion limitation stated accurately, so that the tab-close guarantee is not extended to the entire browser exiting.
63. As a user, I want optional system notifications for desktop success, partial failure, or failure, so that I can receive results after the originating tab closes.
64. As a user who declines notifications, I want desktop application to remain usable with inline feedback when the tab is open, so that notification consent is optional.
65. As a user whose OS suppresses notifications, I want the desktop result preserved independently of notification delivery, so that an applied wallpaper is not reported as failed merely because no banner appeared.
66. As a user receiving a Busy rejection, I want inline feedback rather than a system notification, so that contention does not create unnecessary notification traffic.
67. As a user, I want the helper to start only for explicit verification or an actual desktop operation and exit after that job, so that no permanent daemon or login item is necessary.
68. As a user uninstalling the helper, I want my downloaded wallpapers left in place, so that removing integration does not remove user-owned files.
69. As a user with open tabs and Setup, I want settings and availability changes reflected consistently, so that stale controls cannot silently remain enabled after I disable them.
70. As a user on another browser profile or device, I want local helper availability kept separate from shared preferences, so that one installation does not claim readiness everywhere.
71. As a user opening a new tab, I want the existing wallpaper startup path preserved, so that action settings and native integration do not delay the first usable background.
72. As a maintainer, I want browser-level tests through the real loaded extension and focused race checks at existing boundaries, so that tests demonstrate user-visible behavior without mirroring implementation details.
73. As a maintainer, I want real Windows/macOS helper and installer acceptance evidence in Chrome and Edge, so that mocked native responses or headless page results are not mistaken for visible desktop integration.

## Implementation Decisions

### Controls, setup, and setting ownership

- Provide a self-contained wallpaper-action group with its own markup, positioning, hover/focus region, and lifecycle. It must not be mounted inside the clock or depend on another component's events to become usable. Its initial visual location is below the clock area; later relocation must not require changing the clock. No user-facing drag or position chooser is included.
- Provide independent **Enable image download** and **Enable desktop wallpaper** switches. Preserve the established defaults: image download on; desktop integration off until verified. The download switch controls only the standalone Download image action.
- The desktop switch represents the persisted **Last-known helper availability** flag rather than a second independent enabled preference. It is on only after compatible verification and while native messaging permission remains granted.
- Enable the shared Download folder control when either setup switch is on. Disable it when both are off while preserving its saved value. Its default is the browser's Downloads root, represented by no relative subfolder. Folder editing depends on the switch states, not on picture loading or whether downloads permission has already been granted.
- Use the existing shared-settings mechanism for the image-download preference and relative folder suggestion. Observe changes in open pages and the background coordinator. Keep helper availability local to the extension installation/browser profile, persistent across sessions, and outside synced settings.
- Offer only the actions enabled in Setup. When both are off, hide the group and remove its controls from keyboard navigation. Idle visual hiding retains a keyboard entry point that reveals the enabled controls on focus. Disabled or non-offered actions are excluded from keyboard navigation. Revealing the group on hover or keyboard focus must not move the clock; reserve the desktop action's position while its availability is loading or explicitly being checked.
- Enable an offered action only when the visible picture is available at the configured **Final resolution**. Preview-only, fallback, and pending-resolution states are not exportable. A current final image that remains visible while another navigation is pending is still the visible selection; do not substitute the pending destination.
- Turning off the standalone download action does not prevent an enabled desktop action from saving its required file. Turning desktop integration off clears its availability flag and prevents new desktop actions; the switch-off itself does not launch a helper. An operation started by a valid click while enabled continues through saving and native application even if the switch is turned off during saving, subject to the existing permission, save, and helper checks. Off is not cancellation; browser download cancellation still prevents application. Explain this in Setup. Late verification or operation callbacks must not undo a later manual switch-off.
- Provide installer guidance and **Check again** in Setup regardless of whether the desktop action is currently shown. Folder customization is relative to the browser's configured Downloads directory; reject absolute destinations and parent-directory traversal in the setting. Browser/user Save As decisions can select a different final destination.

### Visible-image capture and saved-file flow

- Capture the clicked tab's visible final-image **Identity**, publication date, configured resolution, and image bytes before the first asynchronous handoff. Use the existing successful final-image application boundary as the source of this immutable capture. Retaining its existing immutable Blob together with the displayed identity, date, and resolution satisfies byte capture: the click handler snapshots those references before asynchronous work. This does not require synchronously reading all bytes, another stored image copy, or a persistent export queue.
- Do not infer a tab's visible image from the shared persisted display record or from a later catalog read. Other tabs may have published a different initial selection for future tabs without changing this tab.
- Preserve the captured selection and bytes through later navigation, resolution changes, cache eviction, and background work. Export must not refetch a remote URL merely to retrieve bytes already available for the visible final image.
- Keep export completion separate from wallpaper display mutation. It must not repaint the page, replace the selected image, or write a new display snapshot. Any page-side asynchronous changes must continue to obey the existing generation-token and queued-write contracts.
- Request optional downloads permission from the first actual action's user gesture, with an explanation. If declined, explain that the tracked-save flow cannot proceed. This permission request does not require helper installation or native messaging permission for Download image.
- Both actions use the browser download manager with a descriptive safe filename and the shared relative folder suggestion. Normal browser prompts, filename conflicts, progress, and cancellation remain browser-managed.
- Respect the actual completed destination, including an explicit user override outside the suggested folder. Obtain the final absolute filename from the browser's completed download record; never reconstruct it from an assumed OS home or Downloads location.
- The desktop flow is: capture the visible final image, obtain save permission if needed, save through the browser, confirm completion and actual filename, then request native application of that existing file. Starting a download or allocating a download identifier is not evidence of completion.
- Begin observing download changes before initiating the browser download. Once initiation returns its download ID, reconcile that ID with the current download record through the Downloads API search operation while observation remains active. Completion may precede ID tracking. Event and query results must converge on one terminal decision for that operation: only a confirmed complete record with the actual filename can advance to native application, and it can do so at most once. Interrupted, failed, or unconfirmed saves cannot advance. This is a preventive implementation constraint, not a reproduced bug. See the [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads).
- Cancellation, access failure, disk-full failure, or an unconfirmed save must prevent OS application. Explain a failed prerequisite without claiming that the wallpaper was applied.
- Use the saved file directly as the OS image source. The helper creates no stored image copy and does not rename, move, or automatically delete that user-owned file. Browser-managed intermediate download files do not count as helper copies.
- A failed, Busy, partial, or unconfirmed desktop operation does not delete the successfully downloaded file.
- Add no wallpaper-storage quota, cap setting, usage ledger, threshold notification, or automatic cleanup. Downloaded-file management belongs to the user. Ordinary browser/OS save errors and image-input validation still apply. Existing extension image-cache retention remains a separate responsibility.

### Persistent helper availability and permission handling

- Persist Last-known helper availability through the extension's local storage interface after a successful compatible response. The extension writes this hint; neither an installer marker file nor direct editing of a browser-profile database is part of the design.
- Turning the desktop switch on requests optional native messaging permission if required and performs one explicit helper verification. Only compatible success sets the flag and leaves the switch on. Permission denial or verification failure leaves it off with relevant setup or troubleshooting guidance.
- Check again performs a fresh explicit verification and never changes the wallpaper. Coalesce concurrent explicit checks within an extension/profile.
- New tabs, hover, focus, worker suspension/restart, browser restart, and extension reload/update do not trigger native verification. They read the persisted hint and current permission. No automatic session refresh, polling, or periodic expiry is introduced.
- A missing or cleared hint stays unavailable until a successful explicit setup verification. A persisted positive hint may be stale after helper removal or upgrade; accept this visibility tradeoff.
- Incompatibility, an unreachable helper, or revocation of native messaging permission clears the hint and updates Setup and open action groups. A compatible responding helper's Busy or OS-application error does not clear availability. Download and notification errors do not imply that a verified helper is absent.
- Validate compatibility over an actual desktop operation's native connection. Do not launch a separate preflight ping process before every operation.
- Disabling the desktop switch prevents a pending older verification or operation response from restoring availability. Concurrent response handling must preserve the newest explicit setup intent.
- Optional notifications permission is requested through explicit setup. Denial does not disable desktop application. Optional downloads permission remains tied to actual save use. No hover event produces any permission prompt.

### Native helper, lifecycle, and platform behavior

- Provide separately installed Windows/macOS native helpers using Chrome/Edge Native Messaging. The extension owns the controls, captured selection, browser save, and result notification; the helper validates an existing saved image and performs the OS operation.
- Install the helper executable and browser-specific registration through an appropriate native installer. Register the published Ataraxia extension origins for both stores, with separate development registration. A browser extension installation alone does not install the companion.
- Start the helper only for explicit setup verification, Check again, or an actual desktop operation. Verification returns a compatibility result and exits. An operation returns its result and exits. No permanent daemon, service, scheduled startup process, or login item is required.
- The background coordinator owns the native connection and terminal notification. Use one short-lived native connection when acceptance and terminal results are separate messages; release it after the job ends.
- Use finite waits for helper verification and operation responses, with durations chosen during implementation. Expiry ends the pending UI state and disconnects that operation's native port without automatic reconnect or replay. Preserve the saved file and report an unconfirmed result whenever OS mutation cannot be excluded. A missing terminal response after a compatible helper response does not by itself clear Last-known helper availability. Failure to establish compatibility remains a separate availability condition. Apply the existing closed-connection cleanup contract to the timed-out job.
- Before acknowledging operation acceptance, the helper must own the same-user operation lock and have validated that the browser-completed saved image is available. Acceptance is not a request to create a helper-owned image file. Subsequent processing must not rely on the originating page, its Blob URL, or its message port remaining open.
- Permit at most one Ataraxia native desktop operation at a time for the same OS user across tabs, browser profiles, Chrome, and Edge. Enforce this in the helper through a nonblocking OS interprocess lock; a worker-local flag is insufficient. Reject overlaps as Busy without a queue. This lock does not claim control over other users, unrelated wallpaper applications, or browser download writes. Save As timing does not require a global reservation, a queue, or a latest-click-wins protocol; the lock protects overlapping OS operations without imposing click order on separate completed saves.
- Apply the same photograph to all targeted connected displays using documented platform APIs and proportional Fill/cropping. Use checked Windows desktop-wallpaper API results and macOS desktop-image API results per screen, invoking AppKit operations on the appropriate main thread. No monitor chooser or fit-mode setting is added.
- Complete Windows success also requires the requested Fill configuration to succeed or already be in effect. Check the [separate Windows positioning call](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-idesktopwallpaper-setposition) as well as per-display image application; an already-satisfied positioning result is successful.
- Do not promise application to every macOS Space. Connected displays and all virtual desktops are distinct scopes; explain the limitation in setup guidance.
- Distinguish complete success, partial changes, definite failure, Busy, and an unconfirmed result. Complete success requires successful OS application results for all targeted displays, not merely a sent request or received filename.
- Keep successful display changes on partial failure and allow an explicit retry. Perform no automatic rollback or replay.
- If communication ends after OS mutation may have occurred and the terminal result is unknown, report **Couldn't confirm the result; check your desktop**. Preserve the downloaded file and do not reinterpret this as confirmed success or definite failure.
- Once the helper accepts the completed saved image, closing its originating tab does not cancel the job; the background native connection owns continuation. Closing the entire browser carries no completion guarantee. Do not claim the same guarantee for earlier save stages unless their background handoff has been verified.
- Return and flush the terminal response, release the operation lock, and exit normally. Handle closed native input/connection cleanup. No process-name killing or orphaned always-on process is part of normal operation.
- Accept source files only from the extension's browser-completed download flow, validate saved-image requests, and permit only the intended extension origins. The helper does not accept shell commands or arbitrary output-write operations.
- Ship appropriately signed Windows/macOS installers and helpers, with macOS notarization as appropriate for direct distribution. Verify installation, upgrade, and uninstall behavior. Uninstall must leave downloaded user-owned wallpaper files intact. Record tested OS/browser versions before making release-support claims; exact build tooling and packaging are implementation choices constrained by this behavior.

### Feedback and startup performance

- Send system notifications for desktop success, partial failure, and failure when permitted. Keep progress and fallback feedback available in an open originating tab. Busy rejections use inline feedback.
- Notification permission or OS presentation settings may prevent visible delivery. Notification creation or permission does not prove the user saw a banner, and notification failure does not change the desktop result.
- Keep normal download progress and destination UI with the browser. Distinguish a failed browser save from an OS wallpaper error and from an unconfirmed native result.
- Keep setting/availability reads and the action group outside the existing first-wallpaper critical path. Preserve existing page-owned display state, preview identity, worker-owned image cache, and cache-retention contracts. Do not launch a helper during boot or UI discovery.
- The desktop switch controls integration availability; it does not start a resident process or stop a wallpaper setting already maintained by the OS.
- Setup guidance must explain the direct-file persistence tradeoff: moving or deleting a saved wallpaper can affect the desktop image. There is no private retained copy or automatic storage-management promise.

## Testing Decisions

The user confirmed these testing boundaries: the existing real-extension browser boundary as the primary feature test, supported by current page/controller race checks, and real Windows/macOS native-helper/installer acceptance for the OS side effect.

- Prefer external behavior over internal helper call counts or tests that repeat implementation structure. Verify rendered controls, persisted setup state, saved-file bytes and actual path, native requests/results, process launches, and visible platform outcomes.
- Reuse the existing Playwright harness that loads the actual MV3 extension into a persistent Chromium profile and controls catalog/image fixtures and worker restarts. Extend its boundary to the real Setup and action flows. Use a controlled native-bridge response boundary for deterministic unavailable, incompatible, Busy, partial, and lost-result scenarios rather than mocking each page/controller dependency.
- Reuse existing classic-page script and options-page tests for focused UI wiring and permission/write ordering. Reuse controller interleaving tests for any new awaited dependency that could mutate page display state. Add focused setup races for a held enable check followed by manual Off and an operation switched Off during saving: it continues through successful save and native application, while the flag and switch stay Off and new desktop actions remain unavailable.
- Test every action-switch combination and the folder-control logical OR, default Downloads root, custom relative subfolder, saved-value retention while both switches are off, settings propagation, clock independence, hover/focus, keyboard access, and stable action placement.
- Compare saved bytes to the clicked visible final image, including HD/UHD, two tabs with different pictures, navigation after clicking, a pending destination while the previous final is still visible, Preview-only/fallback states, and resolution changes.
- Exercise real browser downloads for permission grant/denial, save initiation versus completion, saved bytes and actual path, cancellation, browser-selected destinations, and filename conflicts. Verify no helper application before completion and no helper-owned image copy afterward. Use controlled download error responses for disk exhaustion and access failures to verify that failed saves prevent native application; reproducing actual disk or filesystem failures is not a routine automated-test requirement.
- With the originating tab still open, hold saving or Save As pending across service-worker stop/restart. Complete saving and verify that the originally captured image and actual completed filename advance exactly once, with no native launch before confirmed save completion. This does not extend source-tab-closure guarantees to stages before the verified handoff or require a persistent export queue.
- Add a deterministic completion race test in which a download completes before initiation returns its ID or tracking finishes. Reconcile the already-complete record, deliver overlapping event/query results, and verify one native application of the correct completed file with no missed completion.
- Observe native process creation with absent and positive persisted hints. New tabs, hover, focus, browser restart, and worker restart must create no helper process. Explicit setup verification, Check again, and actual desktop operations may do so; an operation must not require a second preflight process.
- Verify persistent availability across browser sessions and local/profile isolation. Verify stale positive hints clear on actual unreachability/incompatibility or native permission revocation, while compatible OS errors, Busy, download errors, and notification errors do not clear them.
- Cover the background workflow's failure boundary: failed/cancelled saves prevent OS application; accepted jobs survive originating-tab closure; controlled notification permission/error responses do not change results; partial changes do not roll back; lost terminal acknowledgements produce an unconfirmed result and no automatic replay.
- Test a connected host that stays silent during verification and a compatible operation connection that never returns a terminal result. Verify finite waits, pending-state cleanup, connection closure, saved-file retention, unconfirmed-result classification where mutation cannot be excluded, and no automatic reconnect or replay. Missing terminal results alone must not invalidate a previously compatible helper.
- Test helper protocol/compatibility at the native boundary using controlled valid saved images. For interprocess exclusion, run one controlled overlapping Chrome/Edge request pair per platform under the same OS user, using independent profiles/processes. Verify Busy without a queue. Browser response stubs alone do not establish this behavior.
- Browser integration acceptance covers each of Chrome/Windows, Edge/Windows, Chrome/macOS, and Edge/macOS: production-origin registration, permissions, native connection, and one real end-to-end visible wallpaper change.
- Detailed helper acceptance runs once per platform, without repeating the full matrix for each browser: multiple monitors and mixed display shapes, proportional Fill/cropping, result aggregation including partial failure, saved-file retention, and one-job process exit. Use controlled platform-call failures for deterministic aggregation checks, including failure of Windows Fill configuration; retain real visible desktop checks for display behavior and the macOS Spaces limitation.
- Verify macOS protected-file access early, before building out the full desktop application flow, using an installed, signed helper launched by Chrome and Edge. Test reading valid browser-completed images in default Downloads and a protected Save As destination. Record privacy prompts and permission attribution, and verify that access denial produces actionable file-access feedback while retaining the source file and compatible-helper availability. Repeat these checks against the final packaged release. This is a feasibility check; do not assume that browser save consent grants the helper file access.
- Installer acceptance runs once per platform: installation, upgrade, and uninstall, checking both browsers' registrations and preservation of user-downloaded files.
- Use controlled notification errors in automation to verify that notification failure does not change the desktop result. Leave actual notification presentation and OS suppression to a small manual acceptance pass per platform; do not require automated manipulation of OS notification settings.
- Keep a clear distinction between headless real-extension automation and visible desktop acceptance. Existing headless Playwright results and mocked OS calls are not proof that a user's desktop changed.
- Run the project's focused page tests and required real-extension E2E suite for changes to classic page scripts or page markup, plus relevant worker/controller and native checks. Capture observable acceptance evidence; do not claim shipping support from source inspection alone.
- Preserve deterministic catalog/image fixtures in automated browser tests, avoid dependence on live Bing or the current calendar, and verify that early wallpaper display remains available before slower setup/availability work completes.

## Out of Scope

- Offline wallpaper display or offline image actions; the current offline mode does not show a wallpaper.
- A storage cap, quota settings, usage accounting, threshold notifications, automatic saved-file cleanup, or a private helper-owned wallpaper-image cache.
- Automatic desktop synchronization, scheduled wallpaper changes, a permanent helper daemon/service/login item, or polling for installation on hover or browser startup.
- User-facing dragging/position customization, monitor selection, extra fit modes, or an automatic UHD upgrade.
- Changing the extension's wallpaper cache retention, catalog ownership, display-state atomicity, quote behavior, or unrelated widgets.
- A custom absolute destination setting. Downloads and a relative subfolder supply the default suggestion; explicit browser/user Save As decisions still take precedence.
- Coordinating unrelated wallpaper applications or other OS users, guaranteeing every macOS Space, or guaranteeing completion after the whole browser exits.
- Automatically queueing, replaying, rolling back, or deleting files after failed, Busy, partial, or unconfirmed native operations.
- Guaranteeing notification visibility when permission, browser settings, OS settings, or Focus/Do Not Disturb suppress presentation.
- Asking users to grant broad local-file access or introducing a separate directory-handle saving flow for destinations outside the browser Downloads suggestion.

## Further Notes

- Current repository inspection confirms an MV3 extension with page-owned wallpaper display and a background-owned catalog/cache pipeline, existing classic-page/controller tests, and real-extension Playwright coverage. Native wallpaper integration, downloads permission, and notifications permission are not implemented in the inspected manifest.
- Related requests are [Support wallpaper downloading (#36)](https://github.com/funcode/FunBingBing/issues/36) and [Setting as the Windows desktop wallpaper using a bridge app (#50)](https://github.com/funcode/FunBingBing/issues/50). This spec combines the discussed actions and extends desktop scope to Windows/macOS.
- The design follows the project's accepted page-owned display, shared-setting, on-demand helper, and user-owned downloaded-file decisions. This spec is self-contained for implementation and supersedes earlier conversation proposals for session probes, arbitrary-folder handles, helper-owned copies, or storage caps.
- Primary capability references: [browser Downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads), [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), [Windows desktop wallpaper](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-idesktopwallpaper-setwallpaper), [macOS desktop images](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl(_:for:options:)), and [Apple's all-Spaces limitation](https://developer.apple.com/forums/thread/834630).
- Implementation and release acceptance have not been performed. The native toolchain, installer format, and release-version matrix must be verified during implementation without silently changing the accepted product behavior.
