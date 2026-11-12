// Empty means the browser's Downloads root. Folder paths never select an
// absolute directory; the browser remains responsible for the final destination.
export function parseWallpaperDownloadFolder(value) {
  if (typeof value !== 'string' || value.length > 160) return null;
  const folder = value.replace(/\\/g, '/');
  if (folder === '') return '';
  if (folder.startsWith('/') || /^[a-z]:/i.test(folder)) return null;
  const invalid = folder.split('/').some(part => !part || part === '.' || part === '..' ||
    /[<>:"|?*\u0000-\u001f\u007f]/.test(part) || /^[ .]|[ .]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
  return invalid ? null : folder;
}

export function wallpaperDownloadFilename(capture, folder) {
  const relative = parseWallpaperDownloadFolder(folder);
  if (relative === null) throw new Error('Choose a relative subfolder inside Downloads.');
  const safe = value => String(value).replace(/[^a-z0-9_-]/gi, '-').slice(0, 80);
  const name = `${safe(capture.date)}-${safe(capture.imageId)}-${capture.resolution === 'ultraHighDef' ? 'UHD' : 'HD'}.jpg`;
  return relative ? `${relative}/${name}` : name;
}

export function saveCapturedImage(capture, folder, { downloads, permissions, urls = URL }) {
  let filename;
  try {
    filename = wallpaperDownloadFilename(capture, folder);
  } catch (error) {
    return Promise.resolve({ kind: 'failed', reason: error.message });
  }
  return new Promise(resolve => {
    let id = null;
    let terminal = false;
    let querying = false;
    let reconcileRequested = false;
    const url = urls.createObjectURL(capture.blob);
    function finish(outcome) {
      if (terminal) return;
      terminal = true;
      downloads.onChanged.removeListener(changed);
      downloads.onErased?.removeListener(erased);
      permissions?.onRemoved?.removeListener(permissionRemoved);
      urls.revokeObjectURL(url);
      resolve(outcome);
    }
    async function reconcile() {
      if (terminal || id === null) return;
      reconcileRequested = true;
      if (querying) return;
      querying = true;
      try {
        while (reconcileRequested && !terminal) {
          reconcileRequested = false;
          const records = await downloads.search({ id });
          if (terminal) return;
          if (reconcileRequested) continue;
          const item = records.find(record => record.id === id);
          if (!item) return finish({ kind: 'unconfirmed', reason: 'The browser download record is unavailable.' });
          if (item.state === 'complete') {
            if (typeof item.filename !== 'string' || !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(item.filename)) {
              return finish({ kind: 'unconfirmed', reason: 'The browser did not confirm the saved file location.' });
            }
            return finish({ kind: 'complete', save: Object.freeze({ downloadId: id, filename: item.filename, capture }) });
          }
          if (item.state === 'interrupted') {
            return finish({ kind: item.error === 'USER_CANCELED' ? 'cancelled' : 'failed', reason: item.error });
          }
        }
      } catch (error) {
        finish({ kind: 'unconfirmed', reason: error.message });
      } finally {
        querying = false;
      }
    }
    function changed(delta) { if (delta.id === id) void reconcile(); }
    function erased(downloadId) {
      if (downloadId === id) finish({ kind: 'unconfirmed', reason: 'The browser download record was removed.' });
    }
    function permissionRemoved(change) {
      if (change.permissions?.includes('downloads')) finish({ kind: 'failed', reason: 'Downloads permission was removed.' });
    }
    downloads.onChanged.addListener(changed);
    downloads.onErased?.addListener(erased);
    permissions?.onRemoved?.addListener(permissionRemoved);
    // Observation precedes initiation. The mandatory post-ID search recovers
    // completion events delivered before download() returns the ID.
    Promise.resolve().then(() => {
      if (!terminal) return downloads.download({ url, filename, conflictAction: 'uniquify' });
    })
      .then(downloadId => {
        if (terminal) return;
        if (!Number.isInteger(downloadId)) return finish({ kind: 'failed', reason: 'The browser did not start the download.' });
        id = downloadId;
        void reconcile();
      }, error => finish({ kind: 'failed', reason: error.message }));
  });
}
