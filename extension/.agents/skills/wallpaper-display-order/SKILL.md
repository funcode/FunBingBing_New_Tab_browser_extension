---
name: wallpaper-display-order
description: Check wallpaper-controller action ordering and serialized display-snapshot writes with bounded exhaustive schedule exploration. Use when changing generation guards, final-image admission, initialization, navigation, resolution changes, or the display write queue in src/page/wallpaper-controller.js.
---

# Wallpaper display order

Two properties protect the user's selected wallpaper:

- **newer-action-wins:** after the second action finishes successfully, the first action cannot render another final image. Otherwise a late decode can undo the user's newer selection.
- **snapshot-matches-screen:** once both actions and their writes settle, the stored date, Identity and final URL equal the last final image applied. Otherwise the next tab can restore a wallpaper different from the one just displayed.

The snapshot property is checked at quiescence: asynchronous snapshot writes can legitimately lag the screen while work is pending.

## Run

From the extension root, use **Node.js 22.17.0**. The checker pins that runtime and uses only built-in modules; it needs no installation or network access.

```bash
node .agents/skills/wallpaper-display-order/scripts/check.mjs
```

In a WSL shell with the Windows installation of Node, use `node.exe` in place of `node`.

Every scenario must print `PASS` and the process must exit zero. A limit, assertion, unexpected warning, deadlock, or runtime error means the check is incomplete or failed. Never treat a partially enumerated scenario as passing.

For a failure, read the completion trace from top to bottom. `first` and `second` identify the two user operations; `decode` is the guarded render commit, and `snapshot-write` is the atomic durable write. Reproduce with the unchanged checker before deciding whether the error is a product bug or a dependency-model error. Report a product bug and its trace; change product code only when the user authorizes a fix.

## Scope and assumptions

`scripts/check.mjs` executes the real exported `createWallpaperController`, with injected browser dependencies. It replays every available external-completion choice from a fresh controller, including every position at which the second action can start. There is no random sampling or hidden-state merging. Native Promise continuations drain before the next external completion; see [Node's event-loop ordering](https://nodejs.org/en/learn/asynchronous-work/understanding-setimmediate).

The finite fixture contains one page, three current/historical catalog entries, all three canonical resolutions cached, successful decoding and writes, and an already initialized display. Its four ordered action pairs are previous/previous, previous/initialize, previous/resolution-change, and resolution-change/previous. A resolution change switches UHD to HD. Seven async dependency kinds are scheduled: catalog read, setting read, snapshot read/write, cache match, preview conversion, and final decode. An image request is unexpected in this fully cached fixture and fails the check.

Catalog and cache contents stay fixed. Reads return independent objects; the setting read captures its value at invocation, while the snapshot read observes storage when it completes. The view performs its `isCurrent()` check and rendering atomically when decoding finishes. This matches the contract inspected in `scripts/main/wallpaper.js:wallpaperView.applyFinal`, but that DOM adapter is not executed by the checker.

Limits are 80 scheduled steps per execution and 200,000 executions per scenario. Reaching either limit aborts with `INCOMPLETE`; increasing a limit requires completing the new enumeration before reporting success.

This checks all schedules of this fixture, not all JavaScript inputs or the entire extension. It excludes multiple tabs, worker restarts, eviction, missing images, failed operations, day rollover, catalog replacement, arbitrary event sequences, browser DOM behavior and timing/liveness guarantees. Keep the existing Node and Playwright tests for those surrounding behaviors. No source-level SMT proof or TLA+ model is claimed.

## Prove the checks can fail

```bash
node .agents/skills/wallpaper-display-order/scripts/check.mjs --self-test
```

This command makes temporary copies of the real controller, rewrites helper imports to their original file URLs, and tests two one-line mutations:

| Mutation | Required violation | Counterexample in product terms |
| --- | --- | --- |
| Replace the render's token predicate with `true` | `newer-action-wins` | Hold the first decode; finish the second action and its write; release the first decode. |
| Run snapshot tasks directly instead of through `writes.then(task)` | `snapshot-matches-screen` | Render the first selection and hold its write; render and store the second selection; release the first write. |

Both must print `CAUGHT` with the specified property. A mutation that no longer matches exactly, escapes detection, or fails for another reason fails the self-test. Temporary copies are deleted, the original controller is checked unchanged, and the full baseline enumeration then runs again. The command never edits product source.

## Coverage and synchronization

Last source-to-check review: **2026-11-10**, commit **528d8e79c9f584035e9407e34b71c901016fe280**. Covered product files were clean at that commit; unrelated existing wallpaper-action documentation changes were left intact.

| Source | Responsibility represented |
| --- | --- |
| `src/page/wallpaper-controller.js`: `initialize`, `navigate`, `catalogUpdated`, `resolutionChanged`, `act`, `runAction`, `present` | Two overlapping actions, generation admission and final rendering |
| Same file: `enqueueWrite`, `publish`, `repairPreview` | Final snapshot publication and repair on the shared write chain |
| `src/helpers/display-state.js`: `isUhdEnabled`, `isValidDisplaySnapshot`, `snapshotMatchesIdentity` | Actual setting, snapshot and identity checks imported by the controller/checker |
| `src/helpers/image.js`: `buildCanonicalUrls`, `isValidImageIdentity` | Actual canonical URLs and Identity validation |
| `src/helpers/retention.js`: `getNavigableDates`; `src/helpers/date.js` | Actual navigation/date helpers used by the fixture |
| `scripts/main/wallpaper.js`: `wallpaperView.applyFinal` | Manually reviewed adapter assumption only; its DOM code is outside the executable check |

Before interpreting a result after a relevant change, run:

```bash
git diff 528d8e79c9f584035e9407e34b71c901016fe280 -- src/page/wallpaper-controller.js src/helpers/display-state.js src/helpers/image.js src/helpers/retention.js src/helpers/date.js scripts/main/wallpaper.js
```

Read every changed covered function and compare its await/commit boundaries with the fixture. If behavior intentionally changes, update the fixture or properties with an explicit explanation of the new promise, then rerun both baseline and mutation checks. Advance the synchronization commit only after reviewing the actual code at that commit and completing both checks; a passing run alone does not establish fidelity. Use `/maintain-formal-verification-skill` when bringing this record back in line after unrelated development.
