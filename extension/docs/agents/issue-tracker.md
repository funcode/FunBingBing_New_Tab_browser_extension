# Issue tracker

Issues live in GitHub Issues on [funcode/FunBingBing_New_Tab_browser_extension](https://github.com/funcode/FunBingBing_New_Tab_browser_extension).

## How skills use this

- `to-tickets` reads and writes issues via `gh issue create`, `gh issue comment`, etc.
- `triage` reads issues to apply labels and transitions.
- `qa` reads issues to track acceptance criteria.
- `to-spec` writes issue bodies and links back.

## For you

- Create issues in the GitHub repo as usual.
- Use GitHub's web UI, or `gh issue create` from the CLI.
- Skills will pick them up and read/write to them automatically.

## PRs as a request surface

**Off** by default. If you want external pull requests to appear in the triage queue, flip this to **On** in the skill config (not documented here; ask if you need it).
