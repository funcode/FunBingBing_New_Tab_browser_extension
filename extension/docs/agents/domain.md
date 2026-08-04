# Domain docs

Domain knowledge lives in a single context at the repo root:

- **`CONTEXT.md`** — overview of the project, architecture, engineering constraints.
- **ADRs** — no dedicated ADR directory yet; add one when you have architectural decisions to record.

## How skills use this

- All engineering skills read `CONTEXT.md` before acting (via tool use).
- They use it to ground decisions: e.g., `code-review` reads it to understand your coding standards, `to-spec` reads it to understand your domain language.
- Skills will NOT automatically traverse nested directories; all domain context must be reachable from the root.

## For you

- Keep `CONTEXT.md` as the single source of truth for project overview and constraints.
- Link from `CONTEXT.md` to any detailed subsystem docs you maintain elsewhere.
- If you later add an ADR directory (e.g., `docs/adr/`), update this file to point to it.

## Multi-context (not used here)

This repo uses a single-context layout. If you later split into multiple independent subsystems, each with its own `CONTEXT.md`, create a `CONTEXT-MAP.md` at the root that lists them.
