# Independent architecture verdict for issue 155

Choose Astra as the base. Both designs converge on the right lifetime owner. The clicked page retains the final Blob and owns one browser save through terminal settlement. This makes worker restart irrelevant to save bookkeeping while the page remains open. These are design judgments against the supplied grounding rubric, not runtime verification.

| Grounding criterion | Sol / 5 | Astra / 5 | Reason |
| --- | --- | --- | --- |
| Exact tab-local final capture | 5 | 5 | Both capture before async work and preserve old visible finals during pending navigation. |
| One completed result and actual path | 4 | 5 | Astra specifies a single outcome continuation, original capture association and bounded query coalescing. |
| Scope and startup preservation | 5 | 5 | Both avoid controller changes, worker journals and native implementation. |
| Keyboard, stable target and settings | 4 | 5 | Astra excludes actionable production desktop controls with no executor. Sol adds a potentially dead group tab stop beyond the grounding requirement. |
| Reproducible browser verification | 5 | 4 | Sol explicitly distinguishes browser routing from a real native Save As chooser and describes the evidence needed for each. |
| Total | 23 | 24 | Astra provides the stronger implementation contract. |

Essential grafts from Sol are its explicit Continue/Cancel permission explanation, preserving the original action capture across that second gesture, and its separate verification of native Save As. A CDP destination override or Playwright download.saveAs does not prove chooser interaction. Track native chooser change/cancel evidence separately and report any unavailable verification honestly. Keep the successful decoded-final capture after the actual DOM application with no new await.

Keep Astra's frozen capture metadata, discriminated outcome, one consumer continuation, mirrored migration defaults and fixture-only completed-save consumer. Production desktop availability must not become actionable from a persisted positive hint in a build lacking its executor. Controlled fixtures exercise verified/loading/unavailable states without claiming native support.

Resolve the small design disagreement in favor of the grounding rubric. Keyboard discovery must work when an eligible enabled action exists. Disabled/non-offered buttons leave Tab navigation. Do not add a focusable empty group solely to explain loading; expose accessible status without creating a dead keyboard target.

Before accepting the implementation, reproduce actual saved byte equality and an actual worker stop/restart with the originating tab open. Assert exactly one completed outcome with the browser's absolute filename. Add deterministic ordering tests for completion before ID, events during search, duplicate completion, interruption and missing records. Neither design document supplies that runtime proof yet.
