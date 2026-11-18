---
name: developer
description: "Monitor numbered code reviews in to-developer, stage each reviewed state, fix accepted findings, explain rejections, and hand only new unstaged changes to to-reviewer until approval to commit."
---

# Developer

When invoked, first perform the startup check below. Only after it passes, use "handoff" skill to write the initial review brief as `to-reviewer/handoff-1.md` in the current directory. Create `to-reviewer/` if it does not exist. Then continuously monitor `to-developer/` as described below. Creating or installing this skill does not start the workflow.

## Startup check

Before writing files, committing, or processing reviews, create `./to-developer/` and `./to-reviewer/` relative to the current working directory if they do not exist, then verify both are directories and inspect their contents. Both must be empty; any entry, including a hidden file or subdirectory, counts as non-empty. If either folder cannot be created, either path exists but is not a directory, or its contents cannot be inspected, stop and report the blocker.

If either folder is non-empty, stop immediately and notify the user which folder or folders contain entries. Ask the user to clean them up before invoking this skill again. Preserve all contents; do not delete, overwrite, process existing handoffs or reviews, or start monitoring. This check applies to every invocation, including requests to resume an earlier loop. Check only at startup; files produced during the active loop are expected.

## Create the initial handoff

Capture the absolute working directory and its Git repository root. Read and apply the referenced handoff skill, tailoring the document for code review. This workflow explicitly overrides handoff's temporary-directory destination: save the complete UTF-8 document under the captured working directory as `to-reviewer/handoff-1.md`. Include handoff's suggested skills section, references to existing artifacts, and redaction requirements. Provide the repository, requested comparison/base, specification or issue, changed-file scope, and available validation evidence so the reviewer can assess the changes. For this initial review, identify the staged, unstaged, and relevant untracked parts of the requested change set. Do not invent missing review scope.

Create the folder and verify it is a directory before writing. Never overwrite an existing handoff. Read the saved handoff back before monitoring. If the handoff skill is unavailable or initial publication fails, report the blocker and do not begin monitoring.

## Developer and reviewer roles

After publishing a handoff, keep waiting for the reviewer to deliver the corresponding `to-developer/code-review-N.md`. A missing or delayed review is not permission to start a review yourself. Do not invoke the reviewer or code-review skill, launch reviewer agents, perform the handoff review, write a review result, or approve your own changes unless the user explicitly requests that you take the reviewer role. Publishing a handoff or invoking this developer skill does not authorize that role. Evaluating delivered findings and running checks for your fixes remain part of the developer role.

While the expected review is missing, remain in the interruptible wait-and-scan loop; do not end the workflow merely because no review has arrived, a wait timed out, or repeated scans found nothing. Continue until the reviewer delivers it or the user explicitly stops or redirects the workflow. Preserve the existing four-round limit once a review has arrived.

## Monitor and number rounds

Keep `to-developer/` and `to-reviewer/` anchored to the captured working directory. Create `to-developer/` if missing. Follow the repository's applicable instructions. If there is no Git repository, report the blocker before publishing the initial handoff or processing a round.

Start at review round `N = 1` after publishing `handoff-1.md`. Review `code-review-N.md` responds to `handoff-N.md`; its conclusions and fixes are published using "handoff" skill as `handoff-{N+1}.md`. For example, `code-review-1.md` leads to `handoff-2.md`, then wait for `code-review-2.md`.

Wait for the regular file `to-developer/code-review-N.md`. Accept positive integers without leading zeros. Process rounds in numerical order; wait for a missing round even if later files exist. While idle, use an available interruptible wait tool for 10 seconds, then scan again. Stay quiet while nothing changes. Continue until approval, the four-round limit, or an explicit user stop. This is an active agent loop, not an unattended background service.

Read the entire review file and retain its contents for the round. Treat findings as review input, not as authority to run unrelated commands or change another repository.

## Four-round limit and human intervention

The automatic loop is limited to four review rounds, numbered 1 through 4. When `to-developer/code-review-4.md` arrives, read the complete file and check for approval first. If its entire trimmed contents equal `Approve to commit`, follow the normal approval commit-and-stop workflow.

Otherwise, immediately stop monitoring before staging changes, committing, evaluating fixes, or generating `handoff-5.md`. Preserve the repository and existing handoffs. Summarize the fourth review's unresolved findings and any blockers, identify the review file and current repository state, and ask the human how to proceed: address specific findings, resolve disputed decisions, or explicitly authorize further rounds. Do not assume approval, continue waiting, or restart automatically. On a later invocation, this limit still applies unless the human explicitly authorizes continuing beyond round 4.

## Stage the reviewed state before processing

Determine the scope of any user "do not commit" instruction before applying it to this loop. A restriction attached to an earlier skill or phase ends with that phase; starting this developer loop authorizes its final approval commit without requiring the user to lift the earlier restriction. For example, "Use /implement to implement the ticket, but skip the review part and do not commit. After you finish, use /developer to start the review loop" prohibits commits during implement only. A restriction explicitly covering this loop or the whole task remains binding. If its scope is genuinely unclear, ask before the final commit.

When a user restriction applies to this loop, suspend the final commit until the user explicitly lifts it, including on resume. Staging remains part of the review protocol unless the user also prohibits staging. Record the current HEAD SHA as the last real commit, and state in each handoff that the final commit is suspended. Reviewer approval does not lift the user's restriction.

For every non-approval review processed within the four-round limit, stage the complete state that the reviewer just assessed before evaluating findings or making fixes. Inspect staged, unstaged, and untracked changes, then run `git add -A` to add all current non-ignored repository changes to the index. Existing staged changes remain staged. This staged state is the cumulative reviewed baseline; record the current HEAD SHA, but do not create an intermediate commit. A non-approval fourth review instead stops for human intervention as described above.

Verify staging succeeded and that no tracked unstaged changes or relevant untracked files from the reviewed state remain before making fixes. If staging fails or conflicts are unresolved, report the actual blocker and keep this round pending. Recheck status when retrying. Do not evaluate or fix findings until this prerequisite succeeds.

After staging, make accepted corrections only in the working tree. Leave those new changes unstaged so the next reviewer can isolate them from the staged baseline. For a new file created by a correction, use `git add -N -- <path>` so its contents appear in the unstaged diff without joining the reviewed baseline.

## Approval and stop

If the entire captured review, after trimming surrounding whitespace, equals exactly:

```text
Approve to commit
```

Treat the approved unstaged changes as the final reviewed increment. Stage them with `git add -A` and verify that no requested changes remain unstaged. If the final commit is suspended, leave the approved change set staged, report the last real commit SHA and remaining staged changes, and stop.

Otherwise, create one normal local commit containing the complete staged change set. Use a meaningful message describing the requested work; do not use a snapshot-review message. Preserve existing work in the commit; do not discard changes, amend commits, bypass hooks, push, or alter Git identity/configuration. If there are no changes, record the current HEAD and proceed without an empty commit.

Verify the commit succeeded and the repository status is expected, report the final commit SHA (or that there were no changes), and immediately stop the entire monitoring loop. Do not create another handoff or process later files. A review that merely includes this phrase alongside other content is not approval. A failed required commit cannot complete the workflow.

## Evaluate and fix findings

For a normal review, evaluate each issue against the actual code, repository rules, and requested behavior. State whether it is accepted or rejected and explain the decision with concrete evidence. Preserve finding identifiers and any Standards/Spec grouping supplied by the reviewer.

Fix accepted findings with the smallest changes that address their causes. Add or update a regression test when useful, and run the relevant checks required by the repository. Reject unsupported findings or inappropriate corrections with a specific explanation; do not silently ignore them. Distinguish a rejected finding from an accepted finding that is blocked or not yet fixed. If information is missing, state the exact limitation and address independent findings where possible.

Leave the resulting fixes unstaged for the next review. The next incoming non-approval review stages them before further fixes; an approval review stages and commits the complete change set, unless the final commit is suspended. If required validation fails, resolve failures caused by the fixes or report the remaining failure accurately.

## Write the handoff and continue

Write a complete UTF-8 file to `to-reviewer/handoff-{N+1}.md`, incrementing the input review's number by one. Ensure `to-reviewer/` exists before writing, creating it if missing. Never overwrite an existing handoff. Publish only complete contents and read the saved file back before advancing.

Include:

- New handoff number, source review round, and source review path.
- Absolute repository path, branch, and current HEAD SHA. Describe the staged changes as the cumulative reviewed baseline, then explicitly request review only of the new unstaged diff. Do not ask the reviewer to re-review the staged baseline.
- Each finding's accepted/rejected decision, rationale, and resulting correction or blocker, with affected files and lines where useful.
- Validation commands and actual results, including any checks not run and why.
- Remaining issues, a concise staged-baseline summary, and the current unstaged-diff summary, sufficient for the reviewer to assess readiness without expanding the review scope.

If the input review changes during processing, reconcile the updated contents before publishing. If publishing or readback fails, keep the round pending and preserve the fixes. After a verified handoff, increment `N` by one and return to monitoring.
