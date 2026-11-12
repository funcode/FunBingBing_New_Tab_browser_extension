import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as h from './harness.mjs';

const hint = 'desktop_wallpaper_available';
const offPending = 'desktop_wallpaper_off_pending';
const permission = { permissions: ['nativeMessaging'] };
const state = (page, expected) => page.locator(`#desktop-wallpaper-setup-status[data-state="${expected}"]`).waitFor();
const desktop = page => page.locator('#enable-desktop-wallpaper-checkbox');
const recheck = page => page.locator('#desktop-wallpaper-check-again');
const folder = page => page.locator('#wallpaper-download-folder');
const desktopHidden = page => page.locator('#desktop-wallpaper-btn').evaluate(button => button.hidden);

async function setup() {
  const page = await h.openOptions();
  await page.locator('#nav-wallpaper').click();
  await h.eventually(() => recheck(page).isEnabled());
  return page;
}

async function controlHost(worker) {
  await worker.evaluate(() => {
    globalThis.hostChecks = [];
    chrome.runtime.connectNative = name => {
      const messages = new Set();
      const disconnects = new Set();
      const check = {
        name, disconnected: false,
        reply(message) { for (const listener of messages) listener(message); },
        exit() { for (const listener of disconnects) listener(); }
      };
      globalThis.hostChecks.push(check);
      return {
        onMessage: { addListener: listener => messages.add(listener), removeListener: listener => messages.delete(listener) },
        onDisconnect: { addListener: listener => disconnects.add(listener), removeListener: listener => disconnects.delete(listener) },
        postMessage(request) { check.request = request; },
        disconnect() { check.disconnected = true; }
      };
    };
  });
}

test('Setup explains permission denial and passive discovery never requests access', async () => {
  await h.start();
  try {
    const worker = await h.worker();
    await controlHost(worker);
    await worker.evaluate(() => {
      globalThis.permissionRequests = 0;
      chrome.permissions.request = () => {
        globalThis.permissionRequests++;
        return Promise.resolve(false);
      };
    });
    const page = await setup();
    const link = page.locator('#desktop-wallpaper-install');
    await link.hover();
    await recheck(page).focus();
    assert.ok(await link.isVisible());
    const guide = await link.evaluate(async anchor => (await fetch(anchor.href)).text());
    assert.match(guide, /Register-DevelopmentHost\.ps1/);
    assert.ok(await page.locator('#desktop-wallpaper-release').isVisible());
    assert.equal(await desktop(page).isChecked(), false);
    assert.equal(await worker.evaluate(() => globalThis.permissionRequests), 0);
    await desktop(page).click();
    await state(page, 'denied');
    assert.equal(await desktop(page).isChecked(), false);
    assert.equal(await h.readLocal(hint), false);
    assert.equal(await worker.evaluate(() => globalThis.permissionRequests), 1);
    assert.equal(await worker.evaluate(() => globalThis.hostChecks.length), 0);
    assert.equal(await page.evaluate(permission => chrome.permissions.contains(permission), permission), false);
  } finally {
    await h.finish();
  }
});

test('Setup and new tabs follow verified availability through checks, Off, and browser restart', async () => {
  await h.start({ nativeMessaging: true });
  try {
    const image = h.day(0, 'DesktopSetup', '#a03020');
    await h.seed({ days: [image], cached: [h.final(image)], sync: { enable_image_download: 'no' } });
    const currentWorker = await h.worker();
    await controlHost(currentWorker);
    const first = await setup();
    const second = await setup();
    const lateSetup = await h.context.newPage();
    await lateSetup.addInitScript(() => {
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = async keys => {
        const items = await get(keys);
        if (keys === null) await new Promise(resolve => { globalThis.resumeConfigRead = resolve; });
        return items;
      };
    });
    await lateSetup.goto(first.url());
    await lateSetup.waitForFunction(() => Boolean(globalThis.resumeConfigRead));
    const page = await h.openNewTab();
    await h.showsFinal(page);
    assert.equal(await desktopHidden(page), true);
    assert.equal(await folder(first).isDisabled(), true);
    assert.equal(await currentWorker.evaluate(() => globalThis.hostChecks.length), 0);

    await desktop(first).click();
    await state(second, 'checking');
    assert.equal(await desktop(second).isChecked(), false);
    assert.equal(await folder(first).isDisabled(), true);
    await second.evaluate(() => { void chrome.runtime.sendMessage({ type: 'checkDesktopWallpaper' }); });
    await h.eventually(() => currentWorker.evaluate(() => globalThis.hostChecks.length === 1));
    const request = await currentWorker.evaluate(() => globalThis.hostChecks[0].request);
    assert.deepEqual(request, { type: 'verify', protocolVersion: 1 });
    await currentWorker.evaluate(() => globalThis.hostChecks[0].reply({
      type: 'compatibility', protocolVersion: 1, compatible: true
    }));
    await state(second, 'verified');
    await h.eventually(async () => await desktop(second).isChecked() && !await desktopHidden(page));
    await lateSetup.evaluate(() => globalThis.resumeConfigRead());
    await lateSetup.locator('#nav-wallpaper').click();
    await h.eventually(() => desktop(lateSetup).isChecked());
    assert.equal(await folder(first).isEnabled(), true);
    assert.equal(await h.readLocal(hint), true);
    assert.equal((await h.readSync(hint))[hint], undefined);
    assert.equal(await currentWorker.evaluate(() => globalThis.hostChecks[0].disconnected), true);

    await recheck(first).click();
    await state(second, 'checking');
    await h.eventually(() => currentWorker.evaluate(() => globalThis.hostChecks.length === 2));
    await desktop(second).click();
    await state(first, 'off');
    await currentWorker.evaluate(() => globalThis.hostChecks[1].reply({
      type: 'compatibility', protocolVersion: 1, compatible: true
    }));
    await h.eventually(async () => !await desktop(first).isChecked() && await desktopHidden(page));
    assert.equal(await h.readLocal(hint), false);
    assert.equal(await currentWorker.evaluate(() => globalThis.hostChecks[1].disconnected), true);

    await recheck(first).click();
    await h.eventually(() => currentWorker.evaluate(() => globalThis.hostChecks.length === 3));
    await currentWorker.evaluate(() => globalThis.hostChecks[2].reply({
      type: 'compatibility', protocolVersion: 2, compatible: true
    }));
    await state(first, 'incompatible');
    assert.equal(await desktop(first).isChecked(), false);

    await recheck(first).click();
    await h.eventually(() => currentWorker.evaluate(() => globalThis.hostChecks.length === 4));
    await currentWorker.evaluate(() => globalThis.hostChecks[3].exit());
    await state(first, 'unavailable');
    assert.equal(await h.readLocal(hint), false);

    await recheck(first).click();
    await h.eventually(() => currentWorker.evaluate(() => globalThis.hostChecks.length === 5));
    await state(first, 'timeout');
    assert.equal(await currentWorker.evaluate(() => globalThis.hostChecks[4].disconnected), true);
    assert.equal(await currentWorker.evaluate(() => globalThis.hostChecks.length), 5);
    assert.equal(await desktop(first).isEnabled(), true);

    await recheck(first).click();
    await h.eventually(() => currentWorker.evaluate(() => globalThis.hostChecks.length === 6));
    await currentWorker.evaluate(() => globalThis.hostChecks[5].reply({
      type: 'compatibility', protocolVersion: 1, compatible: true
    }));
    await state(first, 'verified');
    await h.restartWorker();
    assert.equal(await h.readLocal(hint), true);
    await h.context.close();
    await h.launch();
    const reopened = await setup();
    await h.eventually(() => desktop(reopened).isChecked());
    assert.equal(await h.readLocal(hint), true);
  } finally {
    await h.finish();
  }
});

test('an old positive write stays hidden after Off and a worker restart', async () => {
  await h.start({ nativeMessaging: true });
  try {
    const worker = await h.worker();
    await controlHost(worker);
    await worker.evaluate(() => {
      const set = chrome.storage.local.set.bind(chrome.storage.local);
      globalThis.heldAvailabilityWrites = {};
      chrome.storage.local.set = values => {
        const available = values.desktop_wallpaper_available;
        if (typeof available !== 'boolean') return set(values);
        const { promise, resolve } = Promise.withResolvers();
        globalThis.heldAvailabilityWrites[available] = resolve;
        return promise.then(() => set(values));
      };
    });
    const page = await setup();
    const cancel = page.locator('#desktop-wallpaper-cancel-check');
    const tab = await h.openNewTab();
    assert.equal(await cancel.isVisible(), false);
    await recheck(page).click();
    await state(page, 'checking');
    await h.eventually(() => worker.evaluate(() => globalThis.hostChecks.length === 1));
    await worker.evaluate(() => globalThis.hostChecks[0].reply({
      type: 'compatibility', protocolVersion: 1, compatible: true
    }));
    await h.eventually(() => worker.evaluate(() => Boolean(globalThis.heldAvailabilityWrites.true)));
    await cancel.click();
    await state(page, 'off');
    assert.equal(await cancel.isVisible(), false);
    await worker.evaluate(() => globalThis.heldAvailabilityWrites.true());
    await h.eventually(() => worker.evaluate(() => Boolean(globalThis.heldAvailabilityWrites.false)));
    assert.equal(await h.readLocal(hint), true, 'the stale write is present while the Off write is held');
    assert.equal(await h.readLocal(offPending), true);
    assert.equal(await desktop(page).isChecked(), false);
    assert.equal(await desktopHidden(tab), true);
    const openedDuringOff = await setup();
    assert.equal(await desktop(openedDuringOff).isChecked(), false);
    await h.restartWorker();
    await h.eventually(async () => await h.readLocal(hint) === false && await h.readLocal(offPending) === false);
    assert.equal(await desktop(page).isChecked(), false);
    assert.equal(await desktop(openedDuringOff).isChecked(), false);
    assert.equal(await desktopHidden(tab), true);
  } finally {
    await h.finish();
  }
});

test('a worker restart releases the checking state in open Setup pages', async () => {
  await h.start({ nativeMessaging: true });
  try {
    const worker = await h.worker();
    await controlHost(worker);
    const first = await setup();
    const second = await setup();
    await recheck(first).click();
    await state(second, 'checking');
    await h.restartWorker();
    await h.eventually(() => recheck(first).isEnabled());
    await h.eventually(() => recheck(second).isEnabled());
    assert.equal(await desktop(first).isChecked(), false);
    assert.equal(await h.readLocal(hint), undefined);
  } finally {
    await h.finish();
  }
});

test('Setup embedded by a website cannot launch a native verification', async () => {
  await h.start({ nativeMessaging: true });
  try {
    const worker = await h.worker();
    await controlHost(worker);
    const options = await setup();
    const website = 'https://fixture.s3.ap-east-1.amazonaws.com/';
    await h.context.route(website, route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><iframe src="${options.url()}" width="1000" height="900"></iframe>`
    }));
    const page = await h.context.newPage();
    await page.goto(website);
    const frame = page.frameLocator('iframe');
    await frame.locator('#nav-wallpaper').click();
    await frame.locator('#desktop-wallpaper-check-again').click();
    await frame.locator('#desktop-wallpaper-setup-status[data-state="failed"]').waitFor();
    assert.equal(await worker.evaluate(() => globalThis.hostChecks.length), 0);
    assert.equal(await h.readLocal(hint), undefined);
  } finally {
    await h.finish();
  }
});
