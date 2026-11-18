---
name: reviewer
description: "Monitor numbered handoffs in to-reviewer, review only their requested unstaged changes using code-review, and write conclusions to to-developer until approval to commit."
---

# Reviewer

Invoke this skill with `$reviewer` in Codex or `/reviewer` in Claude Code. When invoked, monitor the invoking working directory. Installing this skill does not start monitoring.

## Monitor and number rounds

Capture the absolute working directory once. Use its `to-reviewer/` and `to-developer/` folders, creating them if missing. Keep these folders anchored there even if a handoff names another repository.

Start with round `N = 1`. On resume, read consecutive existing `code-review-N.md` results: stop if one contains only `Approve to commit` (ignoring surrounding whitespace); otherwise advance to the first round without a result. Preserve existing results. If `code-review-4.md` exists without that exact approval, stop there and ask the user for direction; do not resume at round 5.

Wait for the regular file `to-reviewer/handoff-N.md`. Accept positive integers without leading zeros. Process rounds in numerical order; wait for missing rounds even if later files exist. While idle, use an available interruptible wait tool for 10 seconds and scan again; if none is available, use the Bash tool to run `sleep 10`. This applies from startup, including when `to-reviewer/` is empty or has just been created: keep waiting instead of ending the turn or asking the user to invoke the skill again. Stay quiet while nothing changes. Continue until approval or an explicit user stop. This is an active agent loop, not an unattended background service.

Read the complete handoff as the review brief. Identify its repository, comparison/base, changed files, specification or issue, and validation evidence. Default the repository to the captured working directory only if the handoff names none. If essential scope is missing, request the missing information and keep the round pending; never invent a base or approve an incomplete review.

## Review the handoff

Before reviewing the implementation, check whether the user has provided its specification in this conversation or the handoff, either as requirements text, a file path, or an issue/document link. If none was provided, ask the user to supply the specification, including the expected behavior and acceptance criteria. Keep the current round pending until the user responds; do not write a review result or advance the round while waiting. Do not silently substitute a specification inferred from code, commit messages, or repository files. Reuse the supplied specification in later rounds unless the implementation scope changes. If the user says there is no specification, ask for the intended requirements or explicit direction to proceed with a Standards-only review.

Read and apply the installed custom [
  "code-review" skill against the specification, including its Standards and Spec reviews in parallel sub-agents and separate per-axis aggregation. Read this file directly to use the intended two-axis review rather than another skill with the same name. If unavailable, locate the installed custom code-review skill; if it cannot be found, report the blocker and leave the round pending.

The handoff supplies code-review's requested fixed point and specification when present. Honor the requested scope. For an unstaged-change handoff, treat the index as the reviewed baseline and capture only the working-tree diff against it. Include intent-to-add files because their contents appear in that unstaged diff. Exclude the staged diff and ordinary untracked files; the staged state is previously reviewed context, not part of the current round.

Give both sub-agents the same captured unstaged patch, affected source files, specification, and validation evidence. Use the current HEAD commit ID for repository context, not as a substitute diff base that would fold staged changes back into scope. Invalid refs, an unexpected empty unstaged diff, missing required sources, or an incomplete review cannot justify approval. Only if the user explicitly directs a Standards-only review without a specification, follow code-review's Spec-skip behavior and account for that limitation when assessing readiness.

Exclude issues that are very unlikely to happen, unsupported hypothetical failures, and preferences without a concrete impact or documented requirement. Retain findings supported by the actual diff, repository rules, or a plausible execution path. Preserve the Standards/Spec separation; do not merge or rank findings across axes.

Before publishing, verify the handoff and reviewed changes still match the captured inputs. If they changed, review the updated inputs before writing a result.

## Write conclusions and continue or stop

Before writing any review result, ensure `to-developer/` exists in the captured working directory. If it does not exist, create it and verify it is a directory. Write a complete UTF-8 result to `to-developer/code-review-N.md` and read it back before advancing. Never overwrite an existing result. Do not alter or delete handoffs, implement fixes, commit code, or send external messages.

If actionable findings remain, include the round, reviewed repository/comparison, separate `## Standards` and `## Spec` sections, and a per-axis summary. For each finding, identify the file and line, evidence or realistic trigger, consequence, and correction. If review is blocked or readiness is uncertain, write a non-approval result explaining what is needed for the next round; distinguish limitations from code defects. For rounds 1-3, then increment `N` by one and wait for the next handoff. After writing and verifying a non-approval `code-review-4.md`, stop the entire loop without processing round 5 and ask the user how to proceed. If round 4 contains `Approve to commit`, follow the approval stop rule instead.

For every issue reported in `code-review-N.md`, include a concrete example that explains it. Show a realistic input, code snippet, or sequence of actions, and the actual versus expected outcome. For standards issues, show the affected code and a corrected example illustrating the rule. Label illustrative examples clearly; claim reproduction only when verified.

If no actionable issues remain and the reviewed changes are ready to commit, write only:

```text
Approve to commit
```

An optional trailing newline is allowed. Verify the saved contents and immediately stop the entire monitoring loop, even if more handoffs exist.
