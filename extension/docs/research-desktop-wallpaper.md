# Desktop wallpaper integration research

Research date: 2026-10-27. Status: recommendation only; no integration, installer, or OS behavior has been implemented or tested.

The subsequent [wallpaper actions spec](./spec-wallpaper-actions.md) records the
user's accepted design decisions and takes precedence over proposals below.
Example transfer framing and limits in this research note are not requirements.

## Conclusion

Offer an optional native companion using Native Messaging. Users install the companion and grant browser permission once; subsequent clicks can set the selected picture as their desktop wallpaper. Installation itself cannot honestly be advertised as one click. The extension-only alternative is download plus manual OS wallpaper selection. Chrome's wallpaper API is explicitly ChromeOS-only, so it does not solve Windows/macOS integration. [Chrome wallpaper API](https://developer.chrome.com/docs/extensions/reference/api/wallpaper)

## Browser bridge and setup

Native Messaging launches a registered executable and exchanges length-prefixed UTF-8 JSON over stdin/stdout. Extension pages can call it directly. A connectNative port keeps one host alive until disconnection; sendNativeMessage starts a host per message. The permission is nativeMessaging. Chrome documents 64 MiB outbound and 1 MB inbound message limits. [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

Declare nativeMessaging as optional and request it from the setup button's user gesture. Explain why access is needed before the browser prompt; handle rejection. Optional permissions support enabling a secondary feature without requiring it for ordinary new-tab use. [Permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)

Browsers do not install/manage the host. Provide a separate installer and an explicit setup/retry flow. Include both published Chrome Web Store and Edge Add-ons extension IDs in allowed_origins; development IDs need separate development registration. [Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)

Proposed per-user registration (HOST is the chosen native host name):

| Browser | Windows registry key, default value = manifest path | macOS manifest path |
| --- | --- | --- |
| Chrome | HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\HOST | ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/HOST.json |
| Edge Stable | HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\HOST | ~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/HOST.json |

These are documented registration locations; installers must create valid manifests pointing to the executable. macOS requires an absolute executable path. Channel/custom-profile installations need explicit coverage. [Chrome registration](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [Edge registration](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging)

## Native OS operations

On Windows, use IDesktopWallpaper::SetWallpaper with a durable absolute image filename. A null monitor ID applies to all monitors; a specific monitor ID selects one. Check the returned HRESULT. The API is available from Windows 8. Prefer this documented API over registry editing or shell scripts. [Microsoft SetWallpaper](https://learn.microsoft.com/windows/win32/api/shobjidl_core/nf-shobjidl_core-idesktopwallpaper-setwallpaper)

On macOS, call NSWorkspace.shared.setDesktopImageURL with a local file URL, NSScreen and scaling options, on the main thread. Handle thrown errors; apply per screen for multiple monitors. [Apple setDesktopImageURL](https://developer.apple.com/documentation/appkit/nsworkspace/setdesktopimageurl(_:for:options:))

Do not promise every macOS Space: an Apple Frameworks Engineer states that there is currently no API for setting the desktop image on all Spaces of a screen. Monitor support and virtual-desktop support are distinct. Validate current-desktop behavior on supported OS releases. [Apple staff clarification](https://developer.apple.com/forums/thread/834630)

## Proposed Ataraxia integration

Repository inspection identified a Manifest V3 new-tab page with storage permission and optional topSites. Integration points are scripts/main/wallpaper.js and src/page/wallpaper-controller.js. wallpaperView.applyFinal receives the entry and blob; applyPreview also changes the visible image. The controller does not expose its committed state. matchWallpaperBlob is an existing cache reader. No working download handler was identified; download fallback below is proposed.

1. Capture an export snapshot after successful applyFinal, and disable export while a preview or fallback is visible. On click, retain that snapshot's identity and blob through subsequent navigation. Do not export an older committed picture behind a newer visible preview, or read a shared display snapshot that another tab may have changed.
2. Obtain the corresponding final image bytes from the existing cache. If only a preview is available, explicitly wait/fetch the final image or report unavailable; never silently export a thumbnail. Define the promise as the same picture, with OS-specific crop/fit, rather than identical screen pixels.
3. Open a short-lived connectNative port only after the action. Send a versioned begin/chunk/commit exchange, with request ID, sequence, byte length and digest. Proposed limits: 256 KiB raw chunks encoded as base64 and 16 MiB total decoded input. These are application limits to validate against real UHD files, not browser limits. Stream with acknowledgements/backpressure; avoid duplicating the whole image as several giant strings.
4. The helper verifies the allowed caller, protocol version, total size, chunk sequence, digest and decodable image dimensions/type. Generate its own filenames in application-owned storage. Accept no shell commands or caller-selected filesystem paths. Transfer bytes directly: no download server, localhost listener, or arbitrary URL fetching is required.
5. Write a complete durable image before invoking the OS API. Acknowledge success only after the OS call succeeds; return per-screen failures when results are partial. On disconnect, treat outcome as unknown until reconciled; do not announce success merely because bytes were sent.
6. Retain active files and the previous file until replacement succeeds. Bound cleanup to helper-owned, unreferenced files. Track per-screen references and account for macOS Spaces before deleting old images; never assume OS caching makes deletion safe. Clean incomplete transfers after cancellation/crash.

No host process or feature probe should run during new-tab startup. Load integration code lazily on interaction. A small native executable per OS is sufficient; a permanent daemon and a desktop UI framework are unnecessary for this scope. Serialize conflicting operations across simultaneous native host instances so two tabs cannot race file cleanup or report misleading results.

## Distribution and alternatives

Sign Windows releases; a signed new binary may still trigger SmartScreen while reputation develops. EV signing does not guarantee bypass. [Microsoft SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

Distribute a Developer ID-signed, notarized macOS companion with Hardened Runtime and a stapled ticket. Account for first-run Gatekeeper confirmation and maintain installer/uninstaller updates. [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

Download plus manual selection is the lowest-maintenance fallback and works without a companion. A custom URL scheme still requires installed native software and needs a separate reliable acknowledgement design. A localhost server adds a persistent process, port and authentication surface without benefiting this on-demand operation. These are architecture tradeoffs, not tested implementations.

## Required proof before release

Test Chrome and Edge on supported Windows/macOS versions with production store IDs: first install, permission denial/revocation, absent/incompatible host, update and uninstall. Test unavailable-image states, final-image versus preview selection, UHD input, interrupted transfers, tab close, two-tab races and malformed/oversize input. Verify actual visible desktop results, restart persistence, multiple monitors, partial failures and macOS Spaces. Measure that normal new-tab startup is unchanged. Follow project requirements for tests/newtab-page.test.js and Playwright E2E whenever page scripts/newtab.html are changed; mocked OS calls alone do not prove desktop behavior.
