export const WALLPAPER_HOST = 'com.idealland.ataraxia_wallpaper';
export const WALLPAPER_PROTOCOL_VERSION = 1;
export const VERIFICATION_TIMEOUT_MS = 5000;
export const APPLICATION_TIMEOUT_MS = 30_000;

export function isCompatibleWallpaperHelper(message) {
  return message?.type === 'compatibility' &&
    message.protocolVersion === WALLPAPER_PROTOCOL_VERSION && message.compatible === true &&
    message.canApplyWallpaper === true;
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

export function applyWallpaperWithHelper(runtime, path) {
  return new Promise(resolve => {
    let port;
    try {
      port = runtime.connectNative(WALLPAPER_HOST);
    } catch {
      resolve('unavailable');
      return;
    }

    let phase = 'compatibility';
    let deadline = setTimeout(() => finish('unavailable'), VERIFICATION_TIMEOUT_MS);
    function finish(result) {
      if (phase === 'closed') return;
      phase = 'closed';
      clearTimeout(deadline);
      port.onMessage.removeListener(receive);
      port.onDisconnect.removeListener(disconnected);
      port.disconnect();
      resolve(result);
    }
    function disconnected() {
      void runtime.lastError;
      finish(phase === 'compatibility' ? 'unavailable' : 'unconfirmed');
    }
    function receive(message) {
      if (phase === 'compatibility') {
        if (!isCompatibleWallpaperHelper(message)) return finish('incompatible');
        phase = 'validation';
        clearTimeout(deadline);
        deadline = setTimeout(() => finish('unconfirmed'), APPLICATION_TIMEOUT_MS);
        return;
      }
      if (message?.type === 'accepted' && phase === 'validation') {
        phase = 'accepted';
        return;
      }
      if (message?.type === 'result') {
        if (phase === 'validation' && ['file-error', 'failed'].includes(message.status)) return finish(message.status);
        if (phase === 'accepted' && ['applied', 'partial', 'failed'].includes(message.status)) return finish(message.status);
      }
      finish('unconfirmed');
    }
    port.onMessage.addListener(receive);
    port.onDisconnect.addListener(disconnected);
    try {
      port.postMessage({ type: 'apply', protocolVersion: WALLPAPER_PROTOCOL_VERSION, path });
    } catch {
      finish('unavailable');
    }
  });
}
