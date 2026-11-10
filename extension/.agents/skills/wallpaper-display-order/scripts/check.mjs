import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as checkpoint } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createWallpaperController } from '../../../../src/page/wallpaper-controller.js';
import { buildCanonicalUrls } from '../../../../src/helpers/image.js';
import { isValidDisplaySnapshot } from '../../../../src/helpers/display-state.js';

// One external completion runs to microtask quiescence before the next choice.
// No state merging: each complete execution is replayed from a fresh controller.
const MAX_STEPS = 80;
const MAX_RUNS = 200000;
const sourceUrl = new URL('../../../../src/page/wallpaper-controller.js', import.meta.url);
const identity = ({ date, imageId, url }) => ({ date, imageId, url });
const entries = ['20261013', '20261012', '20261011'].map((date, index) => {
  const imageId = `OHR.Schedule${index}_ZH-CN1000000000`;
  return { date, imageId, urls: buildCanonicalUrls(imageId) };
});

const scenarios = [
  { name: 'previous-previous', first: 'previous', second: 'previous' },
  { name: 'previous-initialize', first: 'previous', second: 'initialize' },
  { name: 'previous-resolution', first: 'previous', second: 'resolution' },
  { name: 'resolution-previous', first: 'resolution', second: 'previous' }
];

class Violation extends Error {
  constructor(property, detail) {
    super(`${property}: ${detail}`);
    this.property = property;
  }
}

async function replay(factory, scenario, plan) {
  const context = new AsyncLocalStorage();
  const pending = [];
  const choices = [];
  const trace = [];
  const done = new Map();
  const catalog = { version: 2, refreshState: { date: entries[0].date },
    entries: Object.fromEntries(entries.map(entry => [entry.date, entry])) };
  const cached = new Set(entries.flatMap(entry => Object.values(entry.urls)));
  let storage = null;
  let setting = 'yes';
  let screen = null;
  let controlled = false;
  let secondStarted = false;
  let failure;

  function finish(result) {
    context.disable();
    return result;
  }

  function defer(name, effect) {
    if (!controlled) return Promise.resolve().then(effect);
    const owner = context.getStore();
    return new Promise((resolve, reject) => {
      pending.push({ label: `${owner}:${name}`, run() {
        try { resolve(effect()); } catch (error) { reject(error); }
      } });
    });
  }

  const controller = factory({
    readCatalog: () => defer('catalog', () => structuredClone(catalog)),
    readDisplayState: () => defer('snapshot-read', () => structuredClone(storage)),
    writeDisplayState: snapshot => defer('snapshot-write', () => { storage = structuredClone(snapshot); }),
    readUhdSetting: () => {
      const issued = setting;
      return defer('setting', () => issued);
    },
    matchImage: url => defer(`cache:${url?.split('_').at(-1)}`, () => cached.has(url) ? url : null),
    toDataUrl: blob => defer('preview-data', () => `data:image/jpeg;base64,${Buffer.from(blob).toString('base64')}`),
    requestImage: () => { throw new Error('Scope changed: fixture should have all images cached'); },
    now: () => 1000,
    getTargetDate: () => '19700101',
    log: { warn: (...args) => { failure ??= new Error(args.map(String).join(' ')); } },
    view: {
      applyFinal: ({ view, isCurrent }) => {
        const owner = context.getStore();
        return defer('decode', () => {
          if (!isCurrent()) return false;
          if (owner === 'first' && done.get('second')?.applied) {
            throw new Violation('newer-action-wins', 'first action rendered after second action finished');
          }
          screen = identity(view);
          trace.push(`render ${owner} ${view.date} ${view.url.split('_').at(-1)}`);
          return true;
        });
      },
      applyPreview() { throw new Error('Scope changed: cached finals should not need a preview'); },
      refreshContents() {},
      showUpdating() {},
      showFallback() { throw new Error('Scope changed: a cached final should be available'); }
    }
  });

  await controller.initialize();
  await checkpoint();
  assert.ok(screen && storage, 'fixture failed to initialize');
  controlled = true;

  function start(owner, action) {
    trace.push(`start ${owner} ${action}`);
    const promise = context.run(owner, () => {
      if (action === 'previous') return controller.navigate(1);
      if (action === 'initialize') return controller.initialize();
      setting = 'no';
      return controller.resolutionChanged();
    });
    promise.then(result => { done.set(owner, result); }, error => { failure ??= error; });
  }

  start('first', scenario.first);
  for (let step = 0; step < MAX_STEPS; step++) {
    await checkpoint();
    if (failure) return finish({ error: failure, trace, choices });
    const enabled = [...pending];
    if (!secondStarted) {
      enabled.push({ label: `second:start-${scenario.second}`, run() {
        secondStarted = true;
        start('second', scenario.second);
      } });
    }
    if (enabled.length === 0) {
      if (done.size !== 2) throw new Error(`Deadlock: ${scenario.name}`);
      if (JSON.stringify(identity(storage)) !== JSON.stringify(screen)) {
        return finish({ error: new Violation('snapshot-matches-screen',
          `snapshot ${storage.date} ${storage.url.split('_').at(-1)}, screen ${screen.date} ${screen.url.split('_').at(-1)}`), trace, choices });
      }
      assert.ok(isValidDisplaySnapshot(storage), 'fixture produced an invalid snapshot');
      return finish({ trace, choices });
    }
    const selected = plan[step] ?? 0;
    assert.ok(selected < enabled.length, 'nondeterministic replay');
    choices.push({ selected, count: enabled.length });
    const next = enabled[selected];
    trace.push(next.label);
    const index = pending.indexOf(next);
    if (index !== -1) pending.splice(index, 1);
    next.run();
  }
  throw new Error(`INCOMPLETE: exceeded ${MAX_STEPS} completions in ${scenario.name}`);
}

function successor(choices) {
  for (let index = choices.length - 1; index >= 0; index--) {
    if (choices[index].selected + 1 < choices[index].count) {
      return choices.slice(0, index).map(choice => choice.selected).concat(choices[index].selected + 1);
    }
  }
  return null;
}

async function explore(factory, scenario) {
  let plan = [];
  let runs = 0;
  let maxSteps = 0;
  do {
    if (++runs > MAX_RUNS) throw new Error(`INCOMPLETE: exceeded ${MAX_RUNS} schedules in ${scenario.name}`);
    if (runs % 10000 === 0) console.log(`Checking ${scenario.name}: ${runs} schedules`);
    const result = await replay(factory, scenario, plan);
    maxSteps = Math.max(maxSteps, result.choices.length);
    if (result.error) return { ...result, scenario: scenario.name, runs };
    plan = successor(result.choices);
  } while (plan);
  return { scenario: scenario.name, runs, maxSteps };
}

async function selfTest() {
  const original = await readFile(sourceUrl, 'utf8');
  const mutations = [
    { name: 'disable-render-token', property: 'newer-action-wins',
      before: 'isCurrent: () => token === generation', after: 'isCurrent: () => true' },
    { name: 'remove-snapshot-write-queue', property: 'snapshot-matches-screen',
      before: 'const run = writes.then(task);', after: 'const run = task();' }
  ];
  const scratch = await mkdtemp(join(tmpdir(), 'ataraxia-display-order-'));
  try {
    for (const mutation of mutations) {
      assert.equal(original.split(mutation.before).length, 2, `mutation needs review: ${mutation.name}`);
      const changed = original.replace(mutation.before, mutation.after)
        .replace(/from '(\.\.\/helpers\/[^']+)'/g, (_, relative) => `from '${new URL(relative, sourceUrl).href}'`);
      const path = join(scratch, `${mutation.name}.mjs`);
      await writeFile(path, changed);
      const { createWallpaperController: broken } = await import(pathToFileURL(path));
      let caught;
      for (const scenario of scenarios) {
        const result = await explore(broken, scenario);
        if (result.error) { caught = result; break; }
      }
      assert.equal(caught?.error?.property, mutation.property, `mutation escaped or failed for wrong reason: ${mutation.name}`);
      console.log(`CAUGHT ${mutation.name}: ${caught.error.message}\n${caught.trace.join('\n')}`);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  assert.equal(await readFile(sourceUrl, 'utf8'), original, 'product source changed during self-test');
}

assert.equal(process.versions.node, '22.17.0', 'Use Node.js 22.17.0 for this reproducible check');
assert.ok(process.argv.slice(2).every(arg => arg === '--self-test'), 'Only --self-test is supported');
if (process.argv.includes('--self-test')) await selfTest();
for (const scenario of scenarios) {
  const result = await explore(createWallpaperController, scenario);
  if (result.error) {
    console.error(`FAIL ${result.scenario}: ${result.error.message}\n${result.trace.join('\n')}`);
    process.exitCode = 1;
    break;
  }
  console.log(`PASS ${result.scenario}: ${result.runs} schedules, at most ${result.maxSteps} completions`);
}
