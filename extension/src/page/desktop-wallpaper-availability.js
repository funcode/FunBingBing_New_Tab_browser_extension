import {
  DESKTOP_WALLPAPER_AVAILABLE, DESKTOP_WALLPAPER_OFF_PENDING,
  NATIVE_WALLPAPER_PERMISSION, changesNativeWallpaperPermission
} from '../helpers/desktop-wallpaper-availability.js';

const availabilityKeys = [DESKTOP_WALLPAPER_AVAILABLE, DESKTOP_WALLPAPER_OFF_PENDING];

export function desktopWallpaperAvailability(chrome) {
  const local = {};
  let permission;
  return {
    read() {
      if (permission === undefined || availabilityKeys.some(key => !Object.hasOwn(local, key))) return 'loading';
      return permission && local[DESKTOP_WALLPAPER_AVAILABLE] && !local[DESKTOP_WALLPAPER_OFF_PENDING]
        ? 'available' : 'unavailable';
    },
    subscribe(listener) {
      let listening = true;
      const changed = (changes, area) => {
        if (area !== 'local') return;
        const keys = availabilityKeys.filter(key => key in changes);
        for (const key of keys) local[key] = changes[key].newValue === true;
        if (keys.length) listener();
      };
      let permissionRevision = 0;
      const added = change => {
        if (!changesNativeWallpaperPermission(change)) return;
        permissionRevision++;
        permission = true;
        listener();
      };
      const removed = change => {
        if (!changesNativeWallpaperPermission(change)) return;
        permissionRevision++;
        permission = false;
        local[DESKTOP_WALLPAPER_AVAILABLE] = false;
        listener();
      };
      chrome.storage.onChanged.addListener(changed);
      chrome.permissions.onAdded.addListener(added);
      chrome.permissions.onRemoved.addListener(removed);
      chrome.storage.local.get(availabilityKeys).catch(() => ({})).then(items => {
        if (!listening) return;
        for (const key of availabilityKeys) {
          if (!Object.hasOwn(local, key)) local[key] = items[key] === true;
        }
        listener();
      });
      const revision = permissionRevision;
      chrome.permissions.contains(NATIVE_WALLPAPER_PERMISSION).catch(() => false).then(granted => {
        if (revision !== permissionRevision) return;
        permission = granted;
        listener();
      });
      return () => {
        listening = false;
        permissionRevision++;
        chrome.storage.onChanged.removeListener(changed);
        chrome.permissions.onAdded.removeListener(added);
        chrome.permissions.onRemoved.removeListener(removed);
      };
    }
  };
}
