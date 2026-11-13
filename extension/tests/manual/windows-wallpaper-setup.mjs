import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DESKTOP_WALLPAPER_AVAILABLE as hint } from '../../src/helpers/desktop-wallpaper-availability.js';
import * as h from '../e2e/harness.mjs';

assert.equal(process.platform, 'win32', 'Run this acceptance check with Windows Node.');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ataraxia-wallpaper-host-'));
const evidence = { stages: [] };
const permission = { permissions: ['nativeMessaging'] };
const checkbox = page => page.locator('#enable-desktop-wallpaper-checkbox');
const recheck = page => page.locator('#desktop-wallpaper-check-again');
const status = (page, state) => page.locator(`#desktop-wallpaper-setup-status[data-state="${state}"]`).waitFor();
const nativeDir = path.join(h.EXTENSION, 'native', 'windows');
const powershell = (file, ...args) => execFileSync('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(nativeDir, file), ...args
], { encoding: 'utf8', windowsHide: true }).trim();

function processIds(file) {
  const name = path.basename(file);
  const list = execFileSync('tasklist.exe', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'],
    { encoding: 'utf8', windowsHide: true });
  return [...list.matchAll(/^"([^"]+)","(\d+)"/gm)]
    .filter(([, image]) => image.toLowerCase() === name.toLowerCase()).map(([, , pid]) => Number(pid));
}

async function openSetup() {
  const page = await h.openOptions();
  await page.locator('#nav-wallpaper').click();
  await h.eventually(() => recheck(page).isEnabled());
  return page;
}

let registered;
let extensionId;
function register(executable) {
  powershell('Register-DevelopmentHost.ps1', '-Browser', 'Chrome', '-HelperPath', executable,
    '-ExtensionId', extensionId);
  registered = executable;
}
function unregister() {
  if (!registered) return;
  powershell('Register-DevelopmentHost.ps1', '-Browser', 'Chrome', '-HelperPath', registered,
    '-ExtensionId', extensionId, '-Remove');
  registered = undefined;
}

try {
  const compiled = powershell('Build-Helper.ps1', '-OutputDirectory', temp);
  const real = path.join(temp, `ataraxia-host-${process.pid}.exe`);
  fs.renameSync(compiled, real);
  const source = path.join(temp, 'SilentHost.cs');
  const silent = path.join(temp, `ataraxia-silent-${process.pid}.exe`);
  const trace = path.join(temp, 'silent-host-launches.txt');
  fs.writeFileSync(source, `using System;
using System.Diagnostics;
using System.IO;
class SilentHost {
    static void Main() {
        File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "silent-host-launches.txt"),
            Process.GetCurrentProcess().Id + Environment.NewLine);
        Console.OpenStandardInput().CopyTo(Stream.Null);
    }
}`);
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  execFileSync(compiler, ['/nologo', '/target:exe', `/out:${silent}`, source], { windowsHide: true });

  await h.start({ nativeMessaging: true });
  const image = h.day(0, 'NativeSetup', '#207050');
  await h.seed({ days: [image], cached: [h.final(image)] });
  await h.context.close();
  const manifestFile = path.join(h.loadedExtension, 'manifest.json');
  fs.copyFileSync(path.join(h.EXTENSION, 'manifest.json'), manifestFile);
  await h.launch();
  let setup = await openSetup();
  assert.equal(await setup.evaluate(permission => chrome.permissions.contains(permission), permission), true,
    'Chromium did not carry the fixture grant over to the production manifest');
  extensionId = new URL(setup.url()).hostname;
  const cdp = await h.context.newCDPSession(setup);
  evidence.browser = (await cdp.send('Browser.getVersion')).product;
  await cdp.detach();
  evidence.windows = os.release();
  evidence.extensionId = extensionId;
  evidence.permissionFixture = 'Seeded grant in a disposable profile, then restored the production manifest.';
  assert.equal(await checkbox(setup).isChecked(), false);

  register(real);
  const worker = await h.worker();
  await worker.evaluate(() => {
    const connect = chrome.runtime.connectNative.bind(chrome.runtime);
    chrome.runtime.connectNative = name => {
      const port = connect(name);
      return {
        onMessage: port.onMessage,
        onDisconnect: port.onDisconnect,
        disconnect: () => port.disconnect(),
        postMessage(message) {
          globalThis.sendVerification = () => port.postMessage(message);
        }
      };
    };
  });
  await checkbox(setup).click();
  await status(setup, 'checking');
  let nativePid;
  await h.eventually(() => {
    [nativePid] = processIds(real);
    return Number.isInteger(nativePid);
  }, 'Chromium did not launch the real Windows helper');
  await worker.evaluate(() => globalThis.sendVerification());
  await status(setup, 'verified');
  assert.equal(await h.readLocal(hint), true);
  await h.eventually(() => !processIds(real).includes(nativePid), 'the verification helper did not exit');
  evidence.stages.push({ verified: true, nativePid, processExited: true });
  unregister();

  register(silent);
  await h.restartWorker();
  await h.context.close();
  await h.launch();
  setup = await openSetup();
  const tab = await h.openNewTab();
  await h.showsFinal(tab);
  await tab.locator('#wallpaper-actions').hover();
  await tab.locator('#download-image-btn').focus();
  await recheck(setup).focus();
  await h.eventually(() => checkbox(setup).isChecked());
  assert.equal(await h.readLocal(hint), true);
  assert.equal(fs.existsSync(trace), false, 'ordinary discovery launched the native helper');

  const isolatedProfile = path.join(temp, 'isolated-profile');
  const isolated = await h.launchTestBrowser(isolatedProfile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${h.loadedExtension}`, `--load-extension=${h.loadedExtension}`,
      '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND']
  });
  try {
    const other = await isolated.newPage();
    await other.goto(setup.url());
    await other.locator('#nav-wallpaper').click();
    await h.eventually(() => recheck(other).isEnabled());
    assert.equal(await checkbox(other).isChecked(), false);
    assert.equal(await other.evaluate(async key => (await chrome.storage.local.get(key))[key], hint), undefined);
    assert.equal(await other.evaluate(permission => chrome.permissions.contains(permission), permission), false);
    assert.equal(fs.existsSync(trace), false, 'fresh profile discovery launched the native helper');
  } finally {
    await isolated.close();
  }
  evidence.stages.push({ hintSurvivedWorkerAndBrowserRestart: true, isolatedSameExtensionId: true, passiveLaunches: 0 });

  const started = Date.now();
  await recheck(setup).click();
  await status(setup, 'timeout');
  const silentPids = fs.readFileSync(trace, 'utf8').trim().split(/\s+/).map(Number);
  assert.equal(silentPids.length, 1, 'timeout must not reconnect');
  assert.equal(await checkbox(setup).isChecked(), false);
  assert.equal(await h.readLocal(hint), false);
  await h.eventually(() => !processIds(silent).includes(silentPids[0]), 'the silent helper did not exit');
  assert.equal(fs.readFileSync(trace, 'utf8').trim().split(/\s+/).length, 1, 'timeout must not replay');
  evidence.stages.push({ silentHost: 'timeout', elapsedMs: Date.now() - started, pid: silentPids[0], processExited: true });
  unregister();

  await recheck(setup).click();
  await status(setup, 'unavailable');
  assert.equal(await checkbox(setup).isChecked(), false);
  evidence.stages.push({ absentHost: 'unavailable' });

  register(real);
  await recheck(setup).click();
  await status(setup, 'verified');
  assert.equal(await setup.evaluate(permission => chrome.permissions.remove(permission), permission), true);
  await status(setup, 'denied');
  await h.eventually(async () => !await checkbox(setup).isChecked() && await h.readLocal(hint) === false);
  await tab.locator('#desktop-wallpaper-btn[hidden]').waitFor({ state: 'attached' });
  evidence.stages.push({ nativePermissionRevoked: true, hint: false, newTabActionHidden: true });
  evidence.result = 'passed';
} finally {
  try {
    unregister();
  } finally {
    await h.finish();
    if (!registered) fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
    const output = path.join(h.EXTENSION, 'output', 'native-acceptance');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'wallpaper-setup.json'), JSON.stringify(evidence, null, 2) + '\n');
  }
}
