import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWallpaperDownloadFolder, wallpaperDownloadFilename, saveCapturedImage } from '../src/helpers/wallpaper-download.js';

function event() {
  const listeners = new Set();
  return { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener),
    emit: value => { for (const listener of listeners) listener(value); }, get size() { return listeners.size; } };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const capture = Object.freeze({ date: '20261110', imageId: 'OHR.Picture_ZH-CN1', resolution: 'highDef', blob: new Blob(['original tab bytes']) });
function harness({ download, search } = {}) {
  const state = { record: { id: 23, state: 'in_progress', filename: 'C:\\Downloads\\image.jpg' }, revoked: [], calls: [], exported: [] };
  state.downloads = {
    onChanged: event(), onErased: event(),
    async download(options) { state.calls.push(options); return download ? download(state) : 23; },
    async search(query) { state.query = query; return search ? search(state) : [{ ...state.record }]; }
  };
  state.permissions = { onRemoved: event() };
  state.urls = { createObjectURL(blob) { state.exported.push(blob); return 'blob:independent-export'; }, revokeObjectURL: url => state.revoked.push(url) };
  state.start = () => saveCapturedImage(capture, 'Wallpapers/Bing', state);
  state.complete = () => { state.record.state = 'complete'; state.downloads.onChanged.emit({ id: 23, state: { current: 'complete' } }); };
  return state;
}

describe('wallpaper download destination', () => {
  it('uses Downloads root or a normalized safe relative folder', () => {
    assert.equal(parseWallpaperDownloadFolder(''), '');
    assert.equal(parseWallpaperDownloadFolder('Wallpapers\\Bing'), 'Wallpapers/Bing');
    assert.equal(wallpaperDownloadFilename(capture, ''), '20261110-OHR-Picture_ZH-CN1-HD.jpg');
    assert.equal(wallpaperDownloadFilename({ ...capture, resolution: 'ultraHighDef' }, 'Bing'), 'Bing/20261110-OHR-Picture_ZH-CN1-UHD.jpg');
  });
  it('rejects POSIX and Windows absolute paths, traversal and invalid segments', () => {
    for (const folder of ['/tmp', '\\Windows', 'C:\\Users', 'c:relative', '\\\\host\\share', '../x', 'x/../y', 'x\\..\\y', './x', 'x//y', 'x/', 'bad?', 'x/CON', 'x/nul.txt', 'x/ trailing', 'x/trailing.', 'x\u0000y', null]) {
      assert.equal(parseWallpaperDownloadFolder(folder), null, String(folder));
    }
  });
});

describe('page-owned browser saving', () => {
  it('observes before initiation and recovers completion before the ID returns', async () => {
    const h = harness({ download(state) {
      assert.equal(state.downloads.onChanged.size, 1);
      state.complete();
      return 23;
    } });
    const outcome = await h.start();
    assert.equal(outcome.kind, 'complete');
    assert.equal(outcome.save.filename, h.record.filename);
    assert.equal(outcome.save.capture, capture);
    assert.equal(h.exported[0], capture.blob);
    assert.deepEqual(h.query, { id: 23 });
    assert.deepEqual(h.calls, [{ url: 'blob:independent-export', filename: 'Wallpapers/Bing/20261110-OHR-Picture_ZH-CN1-HD.jpg', conflictAction: 'uniquify' }]);
    assert.deepEqual(h.revoked, ['blob:independent-export']);
    assert.equal(h.downloads.onChanged.size, 0);
    assert.equal(h.permissions.onRemoved.size, 0);
  });
  it('keeps a returned ID pending and uses the browser completed absolute path', async () => {
    const h = harness();
    let settled = false;
    const pending = h.start().then(result => { settled = true; return result; });
    await tick();
    assert.equal(settled, false);
    assert.equal(h.revoked.length, 0);
    h.record.filename = '/chosen/other-folder/user-renamed (2).jpg';
    h.complete();
    assert.equal((await pending).save.filename, h.record.filename);
  });
  it('coalesces overlapping queries and completes only once after duplicate events', async () => {
    const held = deferred();
    let queries = 0;
    const h = harness({ search: state => ++queries === 1 ? held.promise : [{ ...state.record }] });
    let completions = 0;
    const pending = h.start().then(result => { completions++; return result; });
    await tick();
    h.complete();
    h.complete();
    held.resolve([{ id: 23, state: 'in_progress' }]);
    const outcome = await pending;
    h.complete();
    await tick();
    assert.equal(outcome.kind, 'complete');
    assert.equal(queries, 2);
    assert.equal(completions, 1);
    assert.equal(h.revoked.length, 1);
  });
  it('does not let a stale completed query beat an interruption event', async () => {
    const held = deferred();
    let queries = 0;
    const h = harness({ search: state => ++queries === 1 ? held.promise : [{ ...state.record }] });
    const pending = h.start();
    await tick();
    h.record.state = 'interrupted';
    h.record.error = 'USER_CANCELED';
    h.downloads.onChanged.emit({ id: 23, state: { current: 'interrupted' } });
    held.resolve([{ id: 23, state: 'complete', filename: 'C:\\Downloads\\stale.jpg' }]);
    assert.equal((await pending).kind, 'cancelled');
  });
  it('keeps original bytes while its independent export URL lives', async () => {
    const h = harness();
    const pending = h.start();
    await tick();
    assert.equal(await h.exported[0].text(), 'original tab bytes');
    h.record.filename = 'C:\\Downloads\\saved.jpg';
    h.complete();
    assert.equal(await (await pending).save.capture.blob.text(), 'original tab bytes');
  });
  for (const error of ['USER_CANCELED', 'FILE_ACCESS_DENIED', 'FILE_NO_SPACE']) {
    it(`settles ${error} without a completed save`, async () => {
      const h = harness();
      h.record.state = 'interrupted';
      h.record.error = error;
      const outcome = await h.start();
      assert.equal(outcome.kind, error === 'USER_CANCELED' ? 'cancelled' : 'failed');
      assert.equal(outcome.save, undefined);
      assert.equal(h.revoked.length, 1);
    });
  }
  it('does not treat a missing or relative filename as a completed save', async () => {
    for (const record of [null, { id: 23, state: 'complete', filename: '' }, { id: 23, state: 'complete', filename: 'suggested.jpg' }]) {
      const h = harness({ search: () => record ? [record] : [] });
      assert.equal((await h.start()).kind, 'unconfirmed');
    }
  });
  it('cleans up on initiation failure, query failure, erasure and permission removal', async () => {
    const failed = harness({ download: () => { throw new Error('failed'); } });
    assert.equal((await failed.start()).kind, 'failed');
    const queryFailed = harness({ search: () => { throw new Error('unavailable'); } });
    assert.equal((await queryFailed.start()).kind, 'unconfirmed');
    for (const kind of ['erased', 'permission']) {
      const h = harness();
      const pending = h.start();
      await tick();
      if (kind === 'erased') h.downloads.onErased.emit(23);
      else h.permissions.onRemoved.emit({ permissions: ['downloads'] });
      const outcome = await pending;
      assert.equal(outcome.save, undefined);
      assert.equal(h.downloads.onChanged.size, 0);
      assert.equal(h.revoked.length, 1);
    }
  });
  it('rejects an unsafe stored folder before allocating bytes or starting a download', async () => {
    const h = harness();
    assert.equal((await saveCapturedImage(capture, '../escape', h)).kind, 'failed');
    assert.equal(h.exported.length, 0);
    assert.equal(h.calls.length, 0);
  });
});
