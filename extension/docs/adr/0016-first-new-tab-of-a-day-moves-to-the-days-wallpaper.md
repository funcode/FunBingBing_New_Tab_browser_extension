# The first new tab of a day moves to that day's wallpaper

Status: accepted, October 14, 2026.

ADR-0008 makes the page-owned display state the initial selection for new tabs, and spec revision 17 added that a target-date refresh alone never overwrites that committed choice. Followed literally, a user who last looked at yesterday's wallpaper keeps seeing it in every new tab of the following day until they navigate. Bing publishes one wallpaper a day, so the product owner decided that a new day should bring the new wallpaper without hiding the one the user was looking at while it loads.

## Decision

- **First new tab of a day.** A new tab is the first of a day when its committed display snapshot shows a date before today's market date *and* the snapshot was committed on an earlier market day. Both days are Asia/Shanghai dates; the commit day is the market date of the snapshot's `updatedAt`.
- **What it does.** That tab first shows the committed wallpaper from Cache Storage (its final image, or else its cached preview) without requesting anything for it, with the updating headline (`Wallpaper is updating...`) in the title area. The move to today's wallpaper starts as soon as the committed wallpaper is visible. Once today's final image is decoded and applied, it replaces the committed wallpaper and is published as the new display snapshot.
- **Like a navigation.** The move to today's wallpaper follows the navigation rules: it requests today's final image from the worker, never renders today's preview, and changes display state only after the final image is applied.
- **Waiting for today's entry.** If the catalog does not contain today's entry yet, the tab waits for the worker's catalog notification for today.
- **Bing has not published yet.** When the catalog refresh the page requested has finished and today's entry is still missing, the tab stops waiting and restores the committed wallpaper's headline. The current wallpaper remains, without an error state.
- **Same-day choices are kept.** A selection committed today is respected, even if it shows an earlier date: navigating back to yesterday and then opening another tab does not jump forward.
- **The user's choice wins.** A navigation click while the tab waits cancels the move to today's wallpaper.
- **Already-open tabs are unaffected.** Only a page's opening initialization decides whether it is the first tab of the day; a page that reinitializes later, for example after reconnecting, keeps its selection. Display state keeps its last-write-wins semantics for future readers.

## Consequences

- Spec revision 18 replaces "target-date refresh alone does not overwrite that committed display choice" with this rule for the first new tab of a day. A background refresh during the day, or during a navigation, still never moves a page back to the target date.
- The page needs a signal that its catalog refresh has finished, in addition to catalog notifications, so that "not published yet" ends with the committed headline rather than a permanent updating headline.
- If today's final image fails to load, the committed headline returns. A later catalog notification for today still moves the tab, but without showing the updating headline again while waiting.
- When yesterday's Model data already put today's transient entry in the catalog, the tab can move to it at once, before the refresh finishes; IOTD later corrects its metadata or identity as for any transient entry.
