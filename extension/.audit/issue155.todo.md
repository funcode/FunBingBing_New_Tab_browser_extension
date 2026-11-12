# Issue 155

- [x] 1. `how` over the affected subsystem.
- [x] 2. `architect` for parallel design exploration.
- [x] 3. Write the throughput checkpoint as four todo items.
  - [x] Blocking first steps. Read live #154/#155, inspect clean checkout, select tab-owned save design.
  - [x] Independent workstreams. Parallel read-only designs; one isolated implementation owner; root acceptance verification after owner stops.
  - [x] Shared mutable state. Tab owns captures and save tracking. Worker catalog/display cache remains unchanged. Delegate edits in isolated worktree.
  - [x] Smallest safe decomposition. One implementation owner for coupled page/settings/download contracts.
- [x] 4. Delegate code-writing to a subagent using your configured feature model.
- [x] 5. Verify on the matching surface.
- [ ] 6. Rebase into small, ordered commits. Stack follow-ups.
  - skip: User requested local implementation and preservation of existing work. No root commits or history rewrites.
- [ ] 7. If the design is contested, `interrogate` before shipping.
  - skip: Both designs converged on page-owned saving.
- [ ] 8. Run **Opening a PR**.
  - skip: User requested implementation and test evidence in this checkout. No PR requested.

## Architecture
- [x] Ground
- [x] Sketch
- [x] Agree
- [x] Implement
- [ ] Scrap
  - skip: Only if design fails during implementation.

## Arena
- [x] Frame
- [x] Fan out
- [x] Cross-judge
- [x] Pick
- [x] Graft
- [x] Verify
