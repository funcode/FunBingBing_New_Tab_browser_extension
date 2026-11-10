# Use user-managed downloaded files as desktop wallpaper sources

Both actions save wallpapers to the browser's Downloads directory or a configured
relative subfolder. The desktop action applies the completed downloaded file
directly and keeps no helper-owned image copy, accepting that moving or deleting
the user-owned file may affect desktop persistence.

The two actions have independent setup switches but share the destination
setting, defaulting to Downloads. Folder customization is enabled whenever
either action is enabled; disabling the standalone Download image action does
not disable the desktop action's prerequisite save.

Storage management is left to the user, with no feature-level storage cap,
quota setting, accounting, threshold notification, or automatic file cleanup.
This replaces the earlier private-copy and cap proposals to keep the feature
simple and the saved files under user control. Browser Save As choices override
the suggested destination. See the
[wallpaper actions spec](../spec-wallpaper-actions.md); implementation is pending.
