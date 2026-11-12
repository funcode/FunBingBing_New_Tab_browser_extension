export const DESKTOP_WALLPAPER_AVAILABLE = 'desktop_wallpaper_available';
export const DESKTOP_WALLPAPER_OFF_PENDING = 'desktop_wallpaper_off_pending';
export const NATIVE_WALLPAPER_PERMISSION = { permissions: ['nativeMessaging'] };

export function changesNativeWallpaperPermission(change) {
  return change.permissions?.includes('nativeMessaging');
}
