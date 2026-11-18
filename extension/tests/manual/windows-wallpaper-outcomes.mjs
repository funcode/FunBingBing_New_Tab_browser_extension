import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DESKTOP_WALLPAPER_AVAILABLE as hint } from '../../src/helpers/desktop-wallpaper-availability.js';
import * as h from '../e2e/harness.mjs';

assert.equal(process.platform, 'win32', 'Run this check with Windows Node.');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ataraxia-outcomes-'));
const native = path.join(h.EXTENSION, 'native', 'windows');
const host = 'com.idealland.ataraxia_outcomes_' + process.pid;
const extension = path.join(temp, 'extension');
const release = path.join(temp, 'release');
const entered = path.join(temp, 'entered.txt');
const image = h.day(0, 'NativeOutcome', '#207050');
let context;
let registration;
const report = path.join(h.EXTENSION, 'output', 'native-acceptance', 'wallpaper-outcomes.json');
const evidence = { windows: os.release(), operations: {} };
const powershell = (script, ...args) => execFileSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args
], { encoding: 'utf8', windowsHide: true }).trim();

function replaceInFile(file, from, to) {
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(source.split(from).length, 2, 'Expected one match in ' + file);
  fs.writeFileSync(file, source.replace(from, to));
}

function prepare() {
  fs.mkdirSync(extension);
  for (const entry of fs.readdirSync(h.EXTENSION)) {
    if (entry.startsWith('.') || ['node_modules', 'output', 'tests', 'docs', 'native'].includes(entry)) continue;
    fs.cpSync(path.join(h.EXTENSION, entry), path.join(extension, entry), { recursive: true });
  }
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const grants = ['downloads', 'nativeMessaging'];
  assert.ok(grants.every(grant => manifest.optional_permissions.includes(grant)));
  manifest.optional_permissions = manifest.optional_permissions.filter(permission => !grants.includes(permission));
  manifest.permissions.push(...grants);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  replaceInFile(path.join(extension, 'src', 'worker', 'native-wallpaper.js'),
    "'com.idealland.ataraxia_wallpaper'", JSON.stringify(host));

  for (const file of ['WallpaperHost.cs', 'Build-Helper.ps1', 'Register-DevelopmentHost.ps1']) {
    fs.copyFileSync(path.join(native, file), path.join(temp, file));
  }
  replaceInFile(path.join(temp, 'Register-DevelopmentHost.ps1'),
    "'com.idealland.ataraxia_wallpaper'", "'" + host + "'");
  replaceInFile(path.join(temp, 'WallpaperHost.cs'), 'Run(input, WriteFrame, ApplyDesktop, WatchConnection)', String.raw`Run(input, WriteFrame, path =>
                {
                    string directory = AppDomain.CurrentDomain.BaseDirectory;
                    File.AppendAllText(Path.Combine(directory, "entered.txt"),
                        System.Diagnostics.Process.GetCurrentProcess().Id + "|" + path + Environment.NewLine);
                    var watch = System.Diagnostics.Stopwatch.StartNew();
                    while (!File.Exists(Path.Combine(directory, "release")))
                    {
                        if (watch.ElapsedMilliseconds >= 65000) throw new IOException("Test gate expired.");
                        System.Threading.Thread.Sleep(25);
                    }
                    return "applied";
                }, WatchConnection)`);
  return powershell(path.join(temp, 'Build-Helper.ps1'), '-OutputDirectory', temp);
}

async function launch(helper) {
  const profile = path.join(temp, 'Chrome');
  const downloads = path.join(profile, 'downloads');
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
    download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true }
  }));
  context = await h.launchTestBrowser(profile, {
    channel: 'chrome',
    args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND'],
    ignoreDefaultArgs: ['--disable-extensions']
  }, ['LaunchWindowsNativeHostsDirectly']);
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  const { product } = await cdp.send('Browser.getVersion');
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default' });
  const processes = await cdp.send('SystemInfo.getProcessInfo');
  const pid = processes.processInfo.find(process => process.type === 'browser').id;
  evidence.browser = { product, pid, extensionId: id };
  await cdp.detach();

  const script = path.join(temp, 'Register-DevelopmentHost.ps1');
  const args = ['-Browser', 'Chrome', '-HelperPath', helper, '-ExtensionId', id];
  powershell(script, ...args);
  registration = { script, args };
  const options = await context.newPage();
  await options.goto('chrome-extension://' + id + '/options.html');
  assert.equal(await options.evaluate(() => chrome.permissions.contains({ permissions: ['downloads', 'nativeMessaging'] })), true);
  await options.evaluate(() => chrome.runtime.sendMessage({ type: 'migrationStatus' }));
  const base64 = await options.evaluate(async ({ items, color, url, cacheName }) => {
    const canvas = new OffscreenCanvas(64, 64);
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = color;
    drawing.fillRect(0, 0, 64, 64);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' });
    await (await caches.open(cacheName)).put(url, new Response(blob, { headers: { 'Content-Type': blob.type } }));
    await chrome.storage.local.set(items);
    await chrome.storage.sync.set({ enable_uhd_wallpaper: 'yes' });
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  }, {
    items: {
      [h.CATALOG_KEY]: h.catalogOf([image]),
      [h.MIGRATION_KEY]: { version: 2, phase: 'complete' }
    },
    color: image.color, url: image.urls.ultraHighDef, cacheName: h.CACHE_NAME
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    const connect = chrome.runtime.connectNative.bind(chrome.runtime);
    globalThis.wallpaperNativeFrames = [];
    chrome.runtime.connectNative = name => {
      const port = connect(name);
      const frames = [];
      wallpaperNativeFrames.push(frames);
      port.onMessage.addListener(message => frames.push(message));
      return port;
    };
  });
  await options.locator('#nav-wallpaper').click();
  await options.locator('#enable-desktop-wallpaper-checkbox:enabled').click();
  await options.locator('#desktop-wallpaper-setup-status[data-state="verified"]').waitFor();

  await context.addInitScript(() => {
    const fetchOnline = window.fetch.bind(window);
    window.fetch = (resource, options) => resource === 'https://www.bing.com/favicon.ico' && options?.method === 'HEAD'
      ? Promise.resolve(new Response('', { status: 200 })) : fetchOnline(resource, options);
  });
  const page = await context.newPage();
  await page.goto('chrome-extension://' + id + '/newtab.html');
  await h.showsFinal(page);
  const desktop = page.locator('#desktop-wallpaper-btn');
  assert.equal(await options.evaluate(async key => (await chrome.storage.local.get(key))[key], hint), true);
  await page.locator('#wallpaper-actions[data-source-state="ready"]').waitFor({ state: 'attached', timeout: 8000 });
  await desktop.waitFor({ timeout: 8000 });
  const download = page.locator('#download-image-btn');
  return { options, page, worker, desktop, download, downloads, expected: Buffer.from(base64, 'base64') };
}

const clickDesktop = async ({ page, desktop }) => {
  await desktop.click();
  await page.locator('#wallpaper-desktop-confirmation-confirm').click();
};
const status = (page, value, timeout = 15000) =>
  page.locator('#wallpaper-actions[data-desktop-state="' + value + '"]').waitFor({ state: 'attached', timeout });
const frames = ({ worker }) => worker.evaluate(() => wallpaperNativeFrames);
const available = ({ options }) => options.evaluate(async key => (await chrome.storage.local.get(key))[key], hint);
const enteredOperations = () => fs.existsSync(entered) ? fs.readFileSync(entered, 'utf8').trim().split(/\r?\n/) : [];

async function savedFiles({ options, downloads, expected }, count) {
  const files = await options.evaluate(() => chrome.downloads.search({ state: 'complete', orderBy: ['startTime'] }));
  assert.equal(files.length, count);
  for (const file of files) {
    assert.equal(path.dirname(file.filename), downloads);
    assert.deepEqual(fs.readFileSync(file.filename), expected);
  }
  return files.map(file => file.filename);
}

function probeHost(options, request) {
  return options.evaluate(({ host, request }) => new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(host);
    const deadline = setTimeout(() => {
      port.disconnect();
      reject(new Error('Native ' + request.type + ' probe timed out' + (request.path ? ' for ' + request.path : '')));
    }, 5000);
    const replies = [];
    port.onMessage.addListener(message => replies.push(message));
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      clearTimeout(deadline);
      resolve(replies);
    });
    port.postMessage(request);
  }), { host, request });
}

function hostExited(pid) {
  return !execFileSync('tasklist.exe', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'],
    { encoding: 'utf8', windowsHide: true }).includes('","' + pid + '",');
}

try {
  const chrome = await launch(prepare());

  await clickDesktop(chrome);
  await h.eventually(() => enteredOperations().length === 1, 'The first helper did not enter its accepted operation.');
  const [firstEntry] = enteredOperations();
  const firstPid = Number(firstEntry.split('|')[0]);
  const [desktopFile] = await savedFiles(chrome, 1);
  assert.equal(firstEntry, firstPid + '|' + desktopFile);
  await h.eventually(async () => (await frames(chrome))[1]?.some(reply => reply.type === 'accepted'),
    'Chrome did not receive the acceptance frame.');
  assert.deepEqual((await frames(chrome))[1].map(reply => reply.type), ['compatibility', 'accepted']);
  await status(chrome.page, 'applying');

  await chrome.download.click();
  await h.eventually(async () => (await chrome.options.evaluate(() => chrome.downloads.search({ state: 'complete' }))).length === 2);
  await savedFiles(chrome, 2);
  assert.equal((await frames(chrome)).length, 2);
  assert.equal(hostExited(firstPid), false, 'The desktop helper must still be active when the standalone download completes.');
  fs.writeFileSync(release, '');
  await status(chrome.page, 'applied');
  await h.eventually(() => hostExited(firstPid), 'The helper did not exit before the file probes.');
  const applied = (await frames(chrome))[1];
  assert.deepEqual(applied.map(reply => reply.type), ['compatibility', 'accepted', 'result']);
  assert.equal(applied[2].status, 'applied');
  evidence.operations.applied = { frames: applied, file: path.basename(desktopFile), standaloneDownload: 'complete' };

  const corrupt = path.join(temp, 'not-an-image.jpg');
  fs.writeFileSync(corrupt, 'not an image');
  for (const file of [corrupt, path.join(temp, 'missing.jpg')]) {
    const replies = await probeHost(chrome.options, { type: 'apply', protocolVersion: 1, path: file });
    assert.deepEqual(replies.map(reply => reply.type), ['compatibility', 'result']);
    assert.equal(replies[1].status, 'file-error');
    assert.equal(enteredOperations().length, 1);
    evidence.operations[path.basename(file)] = replies;
  }
  assert.equal(fs.readFileSync(corrupt, 'utf8'), 'not an image');

  fs.unlinkSync(release);
  await clickDesktop(chrome);
  await h.eventually(() => enteredOperations().length === 2, 'The silent helper did not accept the operation.');
  const silentPid = Number(enteredOperations()[1].split('|')[0]);
  const launcher = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    '$child = Get-CimInstance Win32_Process -Filter "ProcessId = ' + silentPid + '"; ' +
    '$parent = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $child.ParentProcessId); ' +
    '$parent.Name'
  ], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim().toLowerCase();
  assert.equal(launcher, 'cmd.exe', 'Chrome must launch the stalled helper through cmd.exe.');
  await status(chrome.page, 'unconfirmed', 40000);
  const exitDeadline = Date.now() + 5000;
  await h.eventually(() => {
    assert.ok(Date.now() < exitDeadline, 'The stalled helper survived the native port disconnect.');
    return hostExited(silentPid);
  });
  assert.equal(await available(chrome), true);
  assert.equal(await chrome.desktop.isEnabled(), true);
  await savedFiles(chrome, 3);
  assert.equal((await frames(chrome)).length, 3);
  const silent = (await frames(chrome))[2];
  assert.deepEqual(silent.map(reply => reply.type), ['compatibility', 'accepted']);
  assert.equal(enteredOperations().length, 2);

  fs.writeFileSync(release, '');
  await clickDesktop(chrome);
  await status(chrome.page, 'applied');
  await savedFiles(chrome, 4);
  assert.equal(enteredOperations().length, 3);
  const retryPid = Number(enteredOperations()[2].split('|')[0]);
  await h.eventually(() => hostExited(retryPid), 'The retry helper did not exit.');
  evidence.operations.silent = {
    frames: silent, result: 'unconfirmed', launcher, processExited: true, explicitRetry: 'applied'
  };
  evidence.result = 'passed';
} finally {
  fs.writeFileSync(release, '');
  const cleanup = await Promise.allSettled([
    context?.close(),
    Promise.resolve().then(() => {
      if (registration) powershell(registration.script, ...registration.args, '-Remove');
    })
  ]);
  const failures = cleanup.filter(result => result.status === 'rejected');
  if (failures.length) {
    evidence.result = 'cleanup-failed';
    evidence.cleanupErrors = failures.map(result => String(result.reason));
  }
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Test cleanup failed.');
  fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
}
