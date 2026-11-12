# Issue 155 grounding

Live #154 and #155 are the contract. The initial working tree was clean at 1ed4de2.

The page owns wallpaper rendering. Its successful wallpaperView.applyFinal callback in scripts/main/wallpaper.js receives the decoded immutable Blob and final identity. Preserve a page-local reference there, clear on actual preview/fallback application, and synchronously copy that reference at action click. Pending navigation leaves the old visible final eligible. Compare its URL with configured HD/UHD to reject pending-resolution images. Do not change the controller's generation guard or display-write queue.

The open page can own downloads permission, observation, initiation and reconciliation. This survives worker stop/restart without a journal while the source tab stays open. Give saving its own Blob URL. Observe before download(), reconcile returned ID using search() with observation active, and settle one terminal outcome using the completed browser record and its absolute filename.

Shared defaults live in scripts/base.js, mirrored in src/helpers/migration.js. Sync enable_image_download and wallpaper_download_folder. Keep desktop availability separate and local. This issue uses controlled desktop-dependent availability states; real verification and native application remain #156/#157.

Mount a separately positioned action group as a sibling of the clock. Reserve the desktop slot. Opacity hiding retains a keyboard entry point when an eligible enabled action exists. Disabled/non-offered buttons leave Tab navigation. Folder editing depends only on the switches, not image/permission readiness.

Baseline focused page/options suite passed 38 tests. Baseline real-extension E2E suite passed 53 tests. Logs /tmp/issue155-baseline-pages.log and /tmp/issue155-baseline-e2e.log.

## Architecture rubric

1. Captures exact tab-local final Blob before any async handoff.
2. One completed-save outcome with actual filename despite early/overlapping events and worker restarts.
3. No added controller await, cache ownership change, persistent export queue, or native implementation.
4. Keyboard discovery, stable target, local desktop availability and synchronized folder/download preferences.
5. Real browser saved bytes, paths, cancellation, conflicts and controlled save failures are reproducibly verified.
