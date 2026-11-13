import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as h from '../e2e/harness.mjs';

assert.equal(process.platform, 'win32', 'Run this check on the Windows desktop to be tested.');

const native = path.join(h.EXTENSION, 'native', 'windows');
const probe = path.join(h.EXTENSION, 'tests', 'manual', 'windows-wallpaper-desktop.ps1');
const powershell = (script, ...args) => execFileSync('powershell.exe', [
  '-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', script, ...args
], { encoding: 'utf8', windowsHide: true }).trim();
const desktop = (...args) => JSON.parse(powershell(probe, ...args));
const original = desktop();
assert.equal(original.Status, 1, 'The check requires an enabled static desktop so it can restore the original wallpaper.');
assert.ok(original.Displays.length && original.Displays.every(display => fs.existsSync(display.File)),
  'Each active display must have a restorable image.');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ataraxia-wallpaper-apply-'));
const snapshot = path.join(temp, 'desktop.json');
fs.writeFileSync(snapshot, JSON.stringify(original));
const release = path.join(temp, 'release-apply');
const evidence = { windows: os.release(), displays: original.Displays.length, operations: [] };
const report = path.join(h.EXTENSION, 'output', 'native-acceptance', 'wallpaper-apply.json');
let extensionId;
let registered;
let wallpaperMayHaveChanged = false;

function register(helper, remove = false) {
  powershell(path.join(native, 'Register-DevelopmentHost.ps1'),
    '-Browser', 'Chrome', '-HelperPath', helper, '-ExtensionId', extensionId, ...(remove ? ['-Remove'] : []));
  registered = remove ? undefined : helper;
}

function buildGatedHelper() {
  const files = path.join(temp, 'gated');
  fs.mkdirSync(files);
  fs.copyFileSync(path.join(native, 'Build-Helper.ps1'), path.join(files, 'Build-Helper.ps1'));
  const source = fs.readFileSync(path.join(native, 'WallpaperHost.cs'), 'utf8');
  const marker = 'reply(Accepted);';
  assert.equal(source.split(marker).length, 2, 'Find the single acceptance reply in the real helper.');
  const gate = `var gate = System.Diagnostics.Stopwatch.StartNew();
                while (!File.Exists(@"${release.replaceAll('"', '""')}"))
                {
                    if (gate.ElapsedMilliseconds >= 15000) throw new IOException("Acceptance gate expired.");
                    System.Threading.Thread.Sleep(25);
                }`;
  fs.writeFileSync(path.join(files, 'WallpaperHost.cs'), source.replace(marker, marker + '\n                ' + gate));
  return powershell(path.join(files, 'Build-Helper.ps1'), '-OutputDirectory', files);
}

function assertApplied(file) {
  const changed = desktop();
  assert.equal(changed.Position, 4, 'Windows reports Fill.');
  assert.deepEqual(changed.Displays.map(display => display.Id).sort(), original.Displays.map(display => display.Id).sort());
  for (const display of changed.Displays) {
    assert.equal(path.relative(display.File, file), '', 'Windows reports the completed browser file on every connected display.');
  }
}

try {
  const helper = powershell(path.join(native, 'Build-Helper.ps1'), '-OutputDirectory', temp);
  const gated = buildGatedHelper();
  await h.start({ downloads: true, nativeMessaging: true, headed: true });
  const first = h.day(0, 'NativeApply', '#207050');
  const second = h.day(-1, 'NativeApplyAfterClose', '#803060');
  await h.seed({ days: [first, second], cached: [h.final(first), h.final(second)] });
  await h.context.close();
  fs.copyFileSync(path.join(h.EXTENSION, 'manifest.json'), path.join(h.loadedExtension, 'manifest.json'));
  await h.launch();
  await h.context.addInitScript(() => {
    const fetchOnline = window.fetch.bind(window);
    window.fetch = (resource, options) => resource === 'https://www.bing.com/favicon.ico' && options?.method === 'HEAD'
      ? Promise.resolve(new Response('', { status: 200 }))
      : fetchOnline(resource, options);
  });
  const setup = await h.openOptions();
  assert.equal(await setup.evaluate(() => chrome.permissions.contains({ permissions: ['downloads', 'nativeMessaging'] })), true);
  extensionId = new URL(setup.url()).hostname;
  const cdp = await h.context.newCDPSession(setup);
  evidence.chromium = (await cdp.send('Browser.getVersion')).product;
  await cdp.detach();
  await setup.locator('#nav-wallpaper').click();
  register(helper);
  await setup.locator('#enable-desktop-wallpaper-checkbox:enabled').click();
  await setup.locator('#desktop-wallpaper-setup-status[data-state="verified"]').waitFor();

  const page = await h.openNewTab();
  await h.showsFinal(page);
  wallpaperMayHaveChanged = true;
  await page.locator('#desktop-wallpaper-btn:enabled').click();
  await page.locator('#wallpaper-desktop-confirmation-confirm').click();
  await page.locator('#wallpaper-actions[data-desktop-state="applied"]').waitFor();
  const [saved] = await setup.evaluate(() => chrome.downloads.search({ state: 'complete' }));
  assert.deepEqual(fs.readFileSync(saved.filename), await h.jpeg(h.final(first).color, h.final(first).size));
  assertApplied(saved.filename);
  evidence.operations.push({ unmodifiedHelper: true, result: 'applied', fill: true, file: path.basename(saved.filename) });

  register(helper, true);
  register(gated);
  const worker = await h.worker();
  await worker.evaluate(() => {
    const connect = chrome.runtime.connectNative.bind(chrome.runtime);
    globalThis.applicationReplies = [];
    chrome.runtime.connectNative = name => {
      const port = connect(name);
      port.onMessage.addListener(message => globalThis.applicationReplies.push(message));
      return port;
    };
  });
  await h.previous(page);
  await h.headlineIs(page, second.headline);
  await page.locator('#desktop-wallpaper-btn:enabled').click();
  await page.locator('#wallpaper-desktop-confirmation-confirm').click();
  await h.eventually(() => worker.evaluate(() => applicationReplies.some(reply => reply.type === 'accepted')));
  await page.close();
  assertApplied(saved.filename);
  fs.writeFileSync(release, '');
  await h.eventually(() => worker.evaluate(() => applicationReplies.some(reply => reply.type === 'result' && reply.status === 'applied')));
  const [afterClose] = await setup.evaluate(id => chrome.downloads.search({ state: 'complete' }).then(items =>
    items.filter(item => item.id !== id)), saved.id);
  assert.deepEqual(fs.readFileSync(afterClose.filename), await h.jpeg(h.final(second).color, h.final(second).size));
  assertApplied(afterClose.filename);
  evidence.operations.push({ sourceClosedAfterAcceptanceBeforeMutation: true, result: 'applied', fill: true, file: path.basename(afterClose.filename) });
  evidence.result = 'passed';
} finally {
  try {
    try {
      await h.context?.close();
    } finally {
      if (wallpaperMayHaveChanged) {
        assert.deepEqual(desktop('-Restore', snapshot), original, 'The original desktop wallpaper and positioning were restored.');
        evidence.restored = true;
      }
    }
  } finally {
    if (registered) register(registered, true);
    if (!wallpaperMayHaveChanged || evidence.restored) {
      await h.finish();
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
    }
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n');
  }
}
