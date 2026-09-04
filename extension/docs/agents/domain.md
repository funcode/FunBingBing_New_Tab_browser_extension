# Domain docs

Domain knowledge lives in a single context at the repo root:

- **`CONTEXT.md`** — overview of the project, architecture, engineering constraints.
- **[ADRs](../adr/)** — architectural decisions for cross-cutting runtime and
  storage behavior.

## How skills use this

- All engineering skills read `CONTEXT.md` before acting (via tool use).
- They use it to ground decisions: e.g., `code-review` reads it to understand your coding standards, `to-spec` reads it to understand your domain language.
- Skills will NOT automatically traverse nested directories; all domain context must be reachable from the root.

## For you

- Keep `CONTEXT.md` as the single source of truth for project overview and constraints.
- Link from `CONTEXT.md` to any detailed subsystem docs you maintain elsewhere.
- Keep new architectural decisions in `docs/adr/` and link them from this index
  when they affect cross-cutting behavior.

## Multi-context (not used here)

This repo uses a single-context layout. If you later split into multiple independent subsystems, each with its own `CONTEXT.md`, create a `CONTEXT-MAP.md` at the root that lists them.
