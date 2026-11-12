export const WALLPAPER_HOST = 'com.idealland.ataraxia_wallpaper';
export const WALLPAPER_PROTOCOL_VERSION = 1;
export const VERIFICATION_TIMEOUT_MS = 5000;

export function isCompatibleWallpaperHelper(message) {
  return message?.type === 'compatibility' &&
    message.protocolVersion === WALLPAPER_PROTOCOL_VERSION && message.compatible === true;
}

export function verifyWallpaperHelper(runtime, signal) {
  return new Promise(resolve => {
    let port;
    try {
      port = runtime.connectNative(WALLPAPER_HOST);
    } catch {
      resolve('unavailable');
      return;
    }

    function finish(status) {
      clearTimeout(deadline);
      signal.removeEventListener('abort', cancelled);
      port.onMessage.removeListener(receive);
      port.onDisconnect.removeListener(disconnected);
      port.disconnect();
      resolve(status);
    }
    const cancelled = () => finish('off');
    const receive = message => finish(isCompatibleWallpaperHelper(message) ? 'verified' : 'incompatible');
    const disconnected = () => {
      void runtime.lastError;
      finish('unavailable');
    };
    const deadline = setTimeout(() => finish('timeout'), VERIFICATION_TIMEOUT_MS);
    signal.addEventListener('abort', cancelled);
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(disconnected);
    try {
      port.postMessage({ type: 'verify', protocolVersion: WALLPAPER_PROTOCOL_VERSION });
    } catch {
      finish('unavailable');
    }
  });
}
