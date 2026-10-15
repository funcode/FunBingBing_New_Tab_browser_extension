# Coding standards

Rules the reviewer applies to every diff. Each is a judgement call that no automated check fully covers; cite the rule's heading when reporting a breach.

## Page actions and stale work

Applies to `src/page/wallpaper-controller.js` and the page code it drives.

Several page actions can be in flight at once: startup, navigation clicks, catalog notifications and the end of a catalog refresh. A slow older action must never undo a newer one.

- List every `await` the diff adds or moves. After each one, the action checks that its page token is still current before it touches shared state: `pending`, `rollover`, `displayDate`, `committed`, `shown`, the view, or a snapshot write. Report each `await` without that check.
- A user action captures or claims the page token before its first `await`.
- Snapshot writes go through the page's write queue, and reads that decide what to show read after the page's own queued writes.
- A new kind of action, or a new awaited dependency, gets a scenario in `tests/wallpaper-controller-interleavings.test.js`. That test holds every awaited call of one action while another runs, and checks that the snapshot matches the screen and that the newer action wins.
