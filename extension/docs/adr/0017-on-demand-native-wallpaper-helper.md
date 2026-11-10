# Use an on-demand native helper for desktop wallpaper

Chrome and Edge cannot directly set Windows/macOS desktop wallpaper through the
ChromeOS-only wallpaper API, so Ataraxia will use Native Messaging with a
separately installed companion that runs on demand for detection or a desktop
action.
This accepts installation and companion maintenance in exchange for one-click
wallpaper application after setup, without requiring a continuously running
local service; the extension owns the controls and selected image, and the
helper owns the OS operation.

The extension persists the last compatible setup verification and reads that
hint for button visibility across browser sessions. This accepts stale UI after
helper removal in exchange for no helper process launches on new tabs, hover,
focus, or browser restart; live checks are reserved for setup, Check again, and
actual desktop operations, with failed availability invalidating the hint.

Settings exposes Enable desktop wallpaper as the control for this persisted
availability flag, not a separate preference or a permanent-process switch.
Turning it on obtains native messaging permission if needed and verifies the
helper once, persisting availability only after compatible success; turning it
off clears the flag and hides the desktop action without launching a helper.
An unreachable or incompatible helper found by a later check or operation also
clears the flag and switches the control off, while an OS wallpaper error from a
compatible responding helper leaves it on. Late responses must not undo a later
manual switch-off.

The revised save-before-apply flow gives the helper the completed downloaded
file to apply directly; it does not keep a private image copy. See
[ADR-0018](./0018-user-managed-wallpaper-downloads.md).

This records the accepted architecture; implementation is pending. See the
[wallpaper actions spec](../spec-wallpaper-actions.md) and
[platform research](../research-desktop-wallpaper.md).
