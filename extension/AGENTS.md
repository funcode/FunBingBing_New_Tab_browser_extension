# Agent working rules

These instructions are maintained for GPT-6 Astra using the [official prompting guidance](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra#prompting-best-practices). They guide agent behavior; model selection is configured separately.

## Follow through within scope
- Treat requests such as "can you" and "help me" as instructions to do the work. Continue until the requested outcome is verified or a concrete blocker remains.
- Use the user's request and prior decisions to determine scope. State material assumptions briefly and proceed with reasonable, reversible choices.
- Ask only when missing information materially changes correctness, scope, or an irreversible action. Continue independent, authorized work while awaiting an answer.
- Do not ask again for authorization already given. If approval is required, first prepare the concrete result and finish all work that does not depend on that approval. Follow actual permission requirements; do not invent approval steps for hypothetical risks.
- User instructions take precedence over skill guidance, subject to higher-priority instructions. If a skill causes a permission request, pause, unfinished work, or departure from the user's intent, link to the exact SKILL.md, quote the relevant instruction, and explain how it applies. Distinguish an explicit requirement from your interpretation.

## Think before coding
- Inspect the relevant code, domain docs, and existing changes before editing. Surface material tradeoffs and prefer the simplest approach that meets the request.
- If multiple interpretations would produce materially different results and context cannot resolve them, ask a focused question before implementing the dependent changes.

## Keep changes small
- Implement only what was requested. Avoid speculative features, single-use abstractions, and error handling for impossible cases.
- Match the surrounding style. Do not refactor, reformat, or remove unrelated code, comments, or user changes.
- Remove imports, variables, and functions made unused by your changes. Mention unrelated problems without fixing them unless asked.
- Every changed line should trace to the request.

## Verify the outcome
- Define observable success criteria. For multi-step work, use a short plan pairing each step with its verification.
- For a bug fix, establish a failing reproduction or regression test, then verify the fix. For a refactor, check relevant behavior before and after.
- Run checks appropriate to the change and complete required project checks. Do not add tests that merely mirror implementation or add application tests for documentation-only edits.
- Once relevant checks pass, broaden or repeat them only when new changes, failures, or unresolved concerns justify it.
- Distinguish verified results from assumptions. Report any checks that could not run and the remaining blocker; do not claim completion without evidence.

## Communicate concisely
- Do not send optional commentary. Give required updates, material blockers, and necessary questions briefly.
- Lead the final response with the outcome, followed by relevant verification and remaining limitations. Use plain language and only as much formatting as helps.
- Use subagents only when the user or applicable task instructions explicitly request delegation or parallel agent work.

# About this project 
This project is a Chrome New Tab Page Extension that uses Bing's daily wallpaper as the background image.
In addition, it shows some widgets on the image:
- A digital clock in the center
- Quote of the day
- A button besides the clock to turn on/off the clock and quote display
- At the right bottom corner, there are 2 navigation buttons to allow users to view the images of the previous or the next date.
- There is a big "Q" displayed at the lower right side area. When a mouse is hovered over it, it expands to show the full content of the quiz of the image.
- When the mouse hovers over the bottom center, where the quote of the day is displayed, a pop-up rises up showing the full content of the quote, including its original source and the caption.
- At the right bottom, left to the navigation buttons, the image title is shown. When the mouse hovers over it, a pop-up rises showing the detailed description of the image, including the image copyright, paragraphs of description and a fun fact about the image.
- At the right up corner, there is a Windows logo. When clicked, it shows a menu with these entries:
    - On This Day In History
    - Same Day In History On Bing.com
    - Gallery
    - Settings

## Other functions
- When a new tab is opened, the extention retrieves today's image from Bing.com if it is not cached yet.
- The extension retrieves the metadata of the images using some Bing's APIs, and HTML scraping for the quote of the day.
- The extension retrieves quote of the day from a remote URL specified by a local variable if it fails to scrape from Bing.
- The extension maintains the local cache of the images, quotes and metadata for the recent 8 days of wallpapers.
- The extension preloads a low resolution image before the UHD image is retrieved to reduce the waiting time.
- The extension checks the network connection periodically, and it shows a default page if the disconnection is detected.
- The extension uses a background service worker to handle quotes retrieving and caching.

# Engineering Considerations
- Performance matters, the new tab page should be opened instantly, and avoid getting users notice the page loading delay
- Carefully control the local storage, including the cache. Avoid local storage bloat.
  - Exception: best-effort future prefetch depth up to 7 days takes precedence for users who opt into UHD wallpapers, whose image cache reaches roughly 36 MB in steady state. See [ADR-0002](./docs/adr/0002-offline-guarantee-over-cache-restraint.md) and [ADR-0005](./docs/adr/0005-future-prefetch-is-best-effort.md).

## Agent skills

### Issue tracker

Issues live in [GitHub Issues](https://github.com/funcode/FunBingBing_New_Tab_browser_extension). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at the repo root. See `docs/agents/domain.md`.

