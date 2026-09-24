# Grilling Report: PLAN9 Service Worker Migration

> Historical review: incognito-specific findings and recommendations were superseded on September 24, 2026 by [ADR-0015](./adr/0015-regular-only-new-tab.md). Consult current PLAN9/spec/ADRs for active acceptance criteria. Unrelated findings retain their recorded review dispositions.
**Date**: 2026-08-21  
**Reviewer**: Matt Pocock Grilling Session  
**Scope**: PLAN9.md, spec-plan9-service-worker-migration.md, ADRs 0001-0013 (excluding 0007), GitHub issues

---

## Executive Summary

This review identifies **7 critical issues**, **11 significant concerns**, and **8 minor clarifications** across consistency, race conditions, performance, and functional correctness domains.

### Severity Classification
- 🔴 **CRITICAL**: Will cause data corruption, user-facing bugs, or system failure
- 🟡 **SIGNIFICANT**: Performance degradation, edge case bugs, or design inconsistency
- 🔵 **MINOR**: Documentation clarity, test coverage gaps, or optimization opportunities

---

## 🔴 CRITICAL ISSUES

### 1. Race Condition: Stale Generation Can Still Corrupt Display State Through Quote/Trivia Updates

**Location**: PLAN9 lines 232-233, Spec lines 117

**Issue**: The stale generation protection only guards **catalog writes** but not the **downstream effects** of those writes. When a stale generation's candidate is rejected from catalog commit, Quote/Trivia sync might still reference that candidate's date.

**Scenario**:
1. Generation 1: Target date = "20260820", starts IOTD fetch for imageId "OHR.ImageA"
2. Generation 2: Target date = "20260821", user navigates, refreshState.generation = 2
3. Generation 1 IOTD response arrives late with "20260820" + "OHR.ImageB" (different identity)
4. Worker correctly rejects catalog merge (line 232: display date conflict)
5. **BUT**: Generation 1's trivia/quote sync task still fires with "20260820" metadata
6. Page reads quote cache, sees "20260820", displays quote for wrong image identity

**Root Cause**: Quote sync (lines 286-294) and trivia scheduling (lines 258-265) don't check the generation token that rejected their source catalog entry.

**Fix Required**:
```javascript
// Before scheduling trivia/quote work from a catalog candidate:
if (candidate.generation !== currentRefreshState.generation) {
  // Skip downstream work for stale candidates
  return;
}
```

**Test Gap**: No test covers "stale candidate rejected from catalog BUT its trivia/quote work still executes."

---

### 2. Missing Atomicity: Display State + Preview Data URL Can Diverge

**Location**: PLAN9 lines 370-380, ADR-0008

**Issue**: The display state update is described as "atomic" but the preview data URL generation is a **separate async operation** after the final image is applied.

**Scenario**:
1. Tab applies final image for "20260820" + "OHR.ImageA"
2. Writes display state: `{date: "20260820", imageId: "OHR.ImageA", url: "...HD.jpg", preloadDataUrl: ""}`
3. **CRASH** or user navigates before preview cache read completes
4. Next boot reads display state with empty preview, shows gradient fallback
5. Worker completes preview cache for "20260820" + "OHR.ImageA"
6. Cache notification arrives, but generation token has changed (user navigated away)
7. Preview data URL **never** updates for this display state

**Current Mitigation**: Lines 374-380 say "preview caching completes after display commit, only updates if generation/date/imageId match." But this creates a **window** where display state is committed without preview, and the preview update might never arrive.

**Better Design**: Generate preview data URL **before** committing display state, or explicitly mark display state as "preview pending" and re-attempt on next boot.

**User Impact**: Users see gradient fallback on every boot until they manually navigate, even though the preview is cached.

---

### 3. Archive Success Validation Has Off-By-One Error

**Location**: PLAN9 lines 220-222, Spec line 221

**Requirement**: 
> "Archive `idx=7` only [succeeds when] the catalog contains from `targetDate` starting, by continuous date, and all are `metadataStage: "iotd"` **8 valid IOTD entries**. Archive's `enddate` must equal the **8th entry's** date..."

**Issue**: Archive API with `idx=7` returns **8 entries** (idx 0-7 inclusive), but they're in **reverse chronological order** (newest first). The spec says "from targetDate starting" (implying oldest first) but doesn't specify ordering.

**Validation Logic Error**:
If entries are `[day0, day-1, day-2, ..., day-7]` (newest first), then:
- Entry 0 should be `targetDate`
- Entry 7 should be `targetDate - 7 days`
- `enddate` in response should match entry 7's date (the oldest)

But PLAN9 line 221 says "Archive's `enddate` must equal the **8th entry's date**" — which is correct IF you mean array index 7, but "8th entry" in English usually means "the entry at position 8" (1-indexed), which would be out of bounds.

**Ambiguity**: Does "8th entry" mean:
- Array index 7 (0-indexed, the oldest date)? ✅ Likely correct
- The 8th element counting from 1? ❌ Would be undefined

**Clarification Needed**: Explicitly state "entry at index 7 (the oldest date in the window)".

**Test Gap**: No test covers Archive response ordering or validates `enddate` against the correct array position.

---

### 4. Quote Lease Token Collision Risk

**Location**: PLAN9 lines 287, Spec line 152

**Issue**: Quote lease uses `crypto.randomUUID()` as the token, which has a **collision probability** under high concurrency.

**Math**: 
- UUID v4 has 122 bits of randomness
- Collision probability ≈ n²/(2 × 2^122) where n = number of concurrent requests
- For n=1000 (unlikely but possible): P(collision) ≈ 10^-30 (negligible)

**BUT**: The code must handle collision gracefully. If two tabs somehow get the same token:
1. Tab1 gets token "abc-123", leaseUntil = now + 60s
2. Tab2 gets token "abc-123" (collision), reads existing lease, sees it's valid
3. Tab2 **should be rejected** but might proceed if code only checks `leaseUntil`

**Current Design** (lines 287-292):
> "Worker only grants lease if Quote missing, no unexpired lease, and `nextRetryAt` passed. Token generated by Worker using `crypto.randomUUID()`."

This implies Worker **generates** the token and **rejects** if lease exists. But what if the collision happens **after** two Workers (regular + incognito) simultaneously generate the same token?

**Fix**: Include context ID in token or use `${contextId}_${randomUUID()}`.

**Likelihood**: Extremely low, but **untested**.

---

### 5. Image Prefetch Generation Invalidation Can Lose Valid Responses

**Location**: PLAN9 lines 326-328, Spec line 128

**Scenario**:
1. Generation 1: Queue contains [target, hist1, hist2, future1]
2. UHD setting toggled, `imagePrefetchGeneration` incremented to 2
3. Active fetch for hist1 UHD is in-flight (started under generation 1)
4. Response arrives, checks: "does hist1 UHD URL still belong to retention set?"
5. **YES** (hist1 is still in catalog, UHD is now configured)
6. Response is cached ✅

**BUT**:
7. Generation 2: Queue rebuilt as [target UHD, hist1 UHD, hist2 UHD, future1 UHD]
8. Generation 1's hist1 UHD already cached
9. Generation 2's queue re-attempts hist1 UHD fetch? ❌

**Issue**: The text says "URL still belongs to retention set → cache.put()" but doesn't say **"remove this URL from the new queue if it was just cached by a stale generation."**

**Result**: hist1 UHD might be fetched **twice** (once by generation 1, once by generation 2) because queue derivation doesn't check "was this just cached by a completing stale fetch?"

**Fix**: After a stale fetch completes and caches successfully, **mark that URL as complete** in the new generation's queue, or let `cache.match()` skip it naturally. But if queue is static at derivation time, this creates a race.

**Actual Impact**: Extra network request (one per toggled setting per historical image).

---

### 6. Incognito Context Can Read Partial Regular Migration State

**Location**: PLAN9 lines 60-63, 69, ADR-0004

**Issue**: Migration marker is stored as `wallpaper_migration_v2_state` (no context suffix, line 69). This is intentional because only regular context migrates, but **incognito Worker can READ this key**.

**Scenario**:
1. Regular Worker starts migration, writes marker: `{version: 2, phase: "writing", ...}`
2. Incognito Worker starts (no migration needed per ADR-0004)
3. Incognito Worker reads `wallpaper_migration_v2_state`, sees `phase: "writing"`
4. Incognito Worker logic: "Should I wait? Should I self-seed now? Should I error?"

**PLAN9 Line 69 says**:
> "`wallpaper_migration_v2_state`, only records regular context migration version, phase, time, **does not carry runtime catalog data**; **incognito context does not read or wait for this marker**."

**BUT**: If incognito "does not read" the marker, why does it exist in shared `chrome.storage.local`? What prevents incognito from accidentally reading it?

**Actual Code Risk**: If incognito Worker's init logic checks for ANY migration marker and finds one, it might:
- Block unnecessarily waiting for regular migration
- Try to read regular v2 keys (wrong context suffix)
- Error out thinking migration failed

**Fix**: Explicitly namespace the marker as `wallpaper_migration_v2_state_regular` or document that incognito MUST ignore this key.

---

### 7. Page-Local Generation Token Doesn't Prevent Cross-Tab Races

**Location**: PLAN9 lines 169-172, 378-379, Spec lines 141-143

**Quote**:
> "用户导航后递增页面本地 generation token；较早的目录刷新、图片加载和 data URL 转换不得覆盖当前选择。"

**Issue**: Page-local generation token prevents **intra-tab** races but not **inter-tab** races.

**Scenario**:
1. Tab1: User navigates from A → B, generation = 2, starts loading B's final image
2. Tab2: Opens, reads display state (still shows A), generation = 1
3. Tab2: Receives cache notification for B (Worker completed it for Tab1)
4. Tab2: generation=1, notification.date=B, display.date=A → **mismatch, ignores update** ✅
5. Tab1: Final image for B loads, writes display state: `{date: B, imageId: ...}`
6. Tab1: Starts generating preview data URL for B
7. **Tab2 REFRESH**: Reads display state, now shows B (correct)
8. Tab2: generation still = 1 (never navigated), listens for cache notifications
9. Worker sends cache notification for B's preview (just completed)
10. Tab2: generation=1, notification.date=B, display.date=B → **MATCH** ✅
11. Tab2: Updates preview data URL for B ✅

This is **correct** but the logic is subtle. The issue is:

**What if Tab2 navigates to C BEFORE step 11?**
12. Tab2: User navigates to C, generation = 2
13. Tab2: Worker notification for B's preview arrives
14. Tab2: generation=2, notification.date=B, display.date=B → **date matches but generation changed**
15. Tab2: Does it update preview for B (now stale) or ignore?

**PLAN9 lines 379-380**:
> "缓存通知到达后,仅在 generation token、date 和 imageId 仍匹配时更新 `preloadDataUrl`"

So Tab2 **rejects** the update because generation changed. ✅ This is correct.

**BUT**: The preview data URL for B is now cached and will never be written to display state, because:
- Tab1 already wrote display state for B (no preview yet)
- Tab2 rejected the preview update
- Tab1 closed or navigated away

**Result**: Next boot reads display state for B with empty preview → gradient fallback.

**This is the same as Critical Issue #2** — preview atomicity problem.

---

## 🟡 SIGNIFICANT CONCERNS

### 8. Future Prefetch Can Starve Historical Backfill Under Backoff

**Location**: PLAN9 lines 322-327, ADR-0005

**Requirement**:
> "历史补齐结束后,未来批次再先补未来 preview、后补未来配置最终分辨率"
> "Historical item whose retry window is still active is skipped for that event and does not block future work."

**Issue**: If 4 historical dates are in backoff (failed, retrying in 3-5 minutes), the future batch starts immediately. This is correct per "does not block." BUT:

**Performance Impact**:
- Cold start: target + 7 historical dates (16 fetches if all cold)
- 3 historical dates fail → 3 backoff windows active
- 4 historical dates succeed
- Future batch starts: 7 future dates × 2 resolutions = 14 fetches (serial)
- **Historical retry windows expire DURING future batch**
- Historical retries DON'T preempt future batch

**Result**: Historical retry can wait **60+ seconds** (14 future fetches × ~4s each) after backoff expires because future batch is actively running.

**User Impact**: User navigates to a historical date that failed earlier, sees "Wallpaper is updating...", waits for current future fetch + queue position.

**Mitigation**: ADR-0013 says navigation can "promote ahead of pending work" but can't interrupt active fetch. So worst case is ~4 seconds (one UHD) + navigation fetch time.

**Is This Acceptable?** Probably yes, but document that "backoff expiry is earliest permitted retry, actual retry waits for queue position."

---

### 9. Model PreloadMediaContents Validation Insufficient

**Location**: PLAN9 lines 220-221, 250-251

**Quote**:
> "Model `MediaContents` must contain `Ssd === targetDate` valid entry; Preload content can be submitted early, but **cannot mark Model response as success if target date missing**."

**Issue**: This is correct, but line 250 says:
> "`PreloadMediaContents` 为未来日期建立临时条目；其文本可以随已缓存最终图片显示，但不能覆盖同身份的 IOTD 字段。"

**Inconsistency**: PreloadMediaContents can:
- ✅ Create future temporary entries (correct)
- ✅ Display text with cached final image (correct)
- ❌ **"Cannot overwrite same-identity IOTD fields"** — BUT what if PreloadMediaContents arrives BEFORE IOTD?

**Scenario**:
1. Model returns PreloadMediaContents for "20260822" (2 days future)
2. Worker creates entry: `{date: "20260822", imageId: "OHR.FutureImage", metadataStage: "preload", ...}`
3. Days pass, "20260822" becomes targetDate
4. IOTD for "20260822" returns same imageId "OHR.FutureImage" but different `title`/`description`
5. Merge logic: metadataStage "preload" < "iotd", so IOTD fields overwrite ✅

**This is correct**. But the wording "cannot overwrite same-identity IOTD fields" implies PreloadMediaContents is **blocked** from overwriting, when actually it's just **lower priority**.

**Clarification**: Change to "PreloadMediaContents has lower priority than IOTD and cannot downgrade metadataStage."

---

### 10. Archive Trivia ID Rewrite Logic Fragile

**Location**: PLAN9 line 254

**Quote**:
> "Archive trivia ID 中的日期段改写为最终 `isoDate`。例如 `HPQuiz_20260720_SantaCatalina` 改为 `HPQuiz_20260721_SantaCatalina`。"

**Issue**: This assumes trivia ID format is `HPQuiz_<DATE>_<NAME>`. What if Bing changes format to:
- `HPQuiz_<NAME>_<DATE>` → Rewrite breaks
- `HPQuiz_20260720` (no name suffix) → Rewrite works
- `HPQuiz_20260720_SantaCatalina_v2` → Rewrite changes first date, leaves "v2" alone (probably correct)

**Regex Risk**: If rewrite uses `/\d{8}/` (match any 8 digits), it could accidentally match:
- Image IDs containing 8 consecutive digits
- Hash values
- Wrong date field

**Fix**: Explicitly anchor the pattern: `HPQuiz_<YYYYMMDD>_` and validate that the matched date equals `isoDate - 1 day`.

**Test Gap**: No test covers trivia ID rewrite edge cases (unexpected format, multiple dates, no date).

---

### 11. UHD Setting Toggle Can Create Cache Thrashing

**Location**: PLAN9 lines 331, 389

**Scenario**:
1. User has HD cached for 15 dates (target + 7 past + 7 future)
2. Toggles to UHD
3. Worker increments `imagePrefetchGeneration`, re-derives queue:
   - Target UHD (fetch)
   - 7 historical UHD (fetch serial)
   - 7 future UHD (fetch serial)
   - **Old HD responses remain cached**
4. User toggles back to HD quickly (within 30 seconds, before UHD batch completes)
5. Worker increments generation again, re-derives queue:
   - Target HD (cache hit ✅)
   - 7 historical HD (cache hit ✅)
   - 7 future HD (cache hit ✅)
   - **Partially fetched UHD responses discarded if generation check fails**

**Issue**: If UHD batch completes 5 of 14 fetches before toggle back to HD:
- 5 UHD responses cached but never used
- Wasted bandwidth: ~12 MB (5 × 2.41 MB)
- Cache bloat: 5 UHD keys + 15 HD keys = 20 keys (under 32 limit, but inefficient)

**Mitigation** (line 331):
> "旧最终分辨率在不再受目录显示状态保护时清理"

So UHD keys are cleaned up when no longer referenced. ✅

**BUT**: Cleanup timing is vague. When does "no longer referenced" trigger?
- Immediately on next queue derivation? (Aggressive, might re-fetch if toggled back)
- On next catalog refresh? (Lazy, temporary bloat)
- On explicit cache.keys() scan? (Expensive)

**Recommendation**: Define explicit cache cleanup timing: "before starting a new image batch" or "after generation increment."

---

### 12. Concurrent Tab Display State Writes Create Unpredictable Last-Write-Wins

**Location**: PLAN9 lines 169-172, Spec lines 141-143, ADR-0008

**Quote**:
> "多个标签页都可以在成功应用最终图片后原子写入该对象；跨标签页采用 last-write-wins 语义决定后续读取者的起点"

**Issue**: "Atomic write" per tab is correct, but "last-write-wins" across tabs is **non-deterministic** under concurrency.

**Scenario**:
1. Tab1 navigates to "20260820", takes 4 seconds to load
2. Tab2 navigates to "20260819", takes 3 seconds to load
3. Tab2 finishes first, writes display state: `{date: "20260819", ...}`
4. Tab1 finishes second, writes display state: `{date: "20260820", ...}`
5. **Last write wins**: display state = "20260820"
6. Tab3 opens, reads display state: `{date: "20260820", ...}` ✅
7. **But Tab2 is still open and displaying "20260819"** ← inconsistency

**Is This a Bug?** No, per ADR-0008:
> "Existing tabs are not required to follow later display-state writes from other tabs."

**But**: This means the system has **no global truth** about "current wallpaper." Each tab has its own local truth, and display state is just "most recent commit."

**User Expectation Mismatch**: User might expect all tabs to show the same wallpaper. Opening Tab3 shows "20260820" while Tab2 shows "20260819" is confusing.

**Recommendation**: Document this as **expected behavior** in user-facing docs: "Each tab maintains its own wallpaper; opening a new tab shows the most recently updated wallpaper from any tab."

---

### 13. Network Reconnect Bypass Can Create Request Storm

**Location**: PLAN9 lines 215-216, ADR-0010

**Quote**:
> "离线恢复最多绕过每个来源当前退避窗口一次。绕过本身不重置 `retryLevel`；绕过后再次失败会继续提升到下一退避级别。15秒网络轮询产生的后续 online 事件不能继续绕过同一窗口。"

**Issue**: "15秒网络轮询" — where does this come from? The spec doesn't define a 15-second polling interval anywhere.

**Clarification Needed**: Is this:
- Browser's native `online`/`offline` event (no polling, event-driven)? ✅ Likely
- Extension's own polling? ❌ Not mentioned in PLAN9
- Bing API's retry-after header? ❌ Different context

**If browser-native**: The 15-second debounce makes sense (prevent rapid online/offline/online cycles from bypassing multiple times).

**But**: How is "same window" tracked? Each retry object needs a `lastReconnectBypassAt` timestamp (line 100, 113 — ✅ already there).

**Potential Storm**:
1. Network drops, all 3 metadata sources + 5 images in backoff
2. Network reconnects
3. All 8 retry objects bypass simultaneously
4. All 8 requests fire (3 metadata + 5 images)
5. **Images are serial (line 323)**, so only 1 image request at a time ✅
6. **Metadata sources are parallel (line 228)**, so 3 simultaneous requests ❌

**Is 3 Simultaneous Metadata Requests a Storm?** Probably acceptable (IOTD, Model, Archive are small JSON responses). But document this as expected burst behavior.

---

### 14. Migration Display State Handoff Race

**Location**: PLAN9 lines 403-404

**Quote**:
> "首个页面读取 `verified` 目录和仍保留的 legacy 显示输入，匹配有效的 date、imageId 和 URL 后原子写入普通上下文 v2 显示状态；无法匹配时写入空显示状态并使用渐变回退图。页面发送 `migrationDisplayStateReady` 后，普通 Worker fresh-read 显示状态，确认迁移输入已被页面消费，再推进到 `complete` 并删除 legacy 键。"

**Race Condition**:
1. Page1 opens, reads `verified` catalog + legacy `wallpaper_url`
2. Page1 matches legacy URL to catalog entry A
3. **Page2 opens** (user opened second tab quickly)
4. Page2 reads same `verified` catalog + same legacy `wallpaper_url`
5. Page2 matches legacy URL to catalog entry A
6. **Both pages write display state for entry A** (last-write-wins, both identical, no corruption ✅)
7. Page1 sends `migrationDisplayStateReady`
8. Worker reads display state (entry A), pushes to `complete`, deletes legacy keys
9. **Page2 sends `migrationDisplayStateReady`** (late, after legacy keys deleted)
10. Worker re-reads display state (entry A), sees migration already complete, no-ops ✅

**Is This a Bug?** No, it's idempotent. But it's inefficient.

**Better Design**: Worker marks migration complete after **first** `migrationDisplayStateReady`, subsequent messages are ignored. Already implied by "推进到 `complete`" (singular), but clarify that Worker only acts on the first acknowledgement.

---

### 15. Cache Storage Eviction Detection Insufficient

**Location**: PLAN9 lines 344-346, ADR-0005

**Quote**:
> "每次启动仍执行 `cache.match()`，缺失时按正常目标优先级恢复，不能仅凭目录条目假定图片一定存在。"

**Issue**: This is correct, but there's no **proactive detection** of eviction. The system only discovers missing cache entries when:
1. Page tries to display that date (user navigates) → cache miss → download
2. Worker rebuilds queue → cache miss on individual entry

**User Impact**: 
- User offline for 8 days
- Browser evicts all cache under disk pressure
- User opens new tab online
- Worker fetches target date (correct)
- Worker rebuilds future queue, starts fetching
- **User tries to navigate to yesterday** (historical date)
- Cache miss detected, historical fetch starts
- Historical fetch is queued BEHIND active future fetch (because future batch already started)
- User waits for future fetch to complete

**Is This Acceptable?** Per ADR-0013, navigation promotes ahead of pending work, so historical fetch becomes next task after current fetch completes. Delay is ~4 seconds (one UHD) max.

**But**: There's no "eviction notification" or "cache health check" that could proactively rebuild historical images before user navigates.

**Recommendation**: On startup, scan cache and catalog, identify discrepancies, prioritize historical repair over future prefetch. (Might already be implied by queue derivation, but not explicit.)

---

### 16. Trivia Concurrency Limit Might Be Too Low

**Location**: PLAN9 lines 261-262

**Quote**:
> "Trivia 并发固定为2，并使用按 `date + triviaId` 键控的内存 in-flight Map 去重。"
> "并发2是有意的请求风暴限制：首次安装最多分4批补齐8条 trivia，延迟只影响非关键 quiz，不阻塞图片或核心元数据。"

**Analysis**:
- 8 trivia entries, concurrency 2 → 4 rounds
- Assume trivia API ~1 second per request
- Serial time: 8 seconds
- Concurrent (2): 4 seconds

**Issue**: If Worker suspends after 3 trivia completions, remaining 5 trivia require:
- Next event: 2 concurrent, 3 remain → 2 concurrent, 1 remains → 1 request
- Total: 3 events to complete

**Is This a Problem?** Not really, trivia is low-priority. But the justification "延迟只影响非关键 quiz" is correct.

**Recommendation**: Keep concurrency=2, document that trivia completion is eventual and depends on browser activity.

---

### 17. Quote Fallback URL Not Validated

**Location**: PLAN9 lines 29, 290

**Quote**:
> "`qotd_url` 只配置缺失 Quote 的回退数据源，不改变 Bing 壁纸市场。"

**Issue**: PLAN9 doesn't specify:
- What format does `qotd_url` return? (JSON? HTML? Plain text?)
- How is it parsed?
- What if the URL is unreachable or returns invalid data?
- What if user sets `qotd_url` to a malicious site?

**Security Risk**: If `qotd_url` is user-configurable and fetched with `credentials: "include"` (like Bing quote HTML), this could:
- Leak cookies to attacker-controlled domain
- Execute XSS if response is inserted into DOM without sanitization

**Current Mitigation**: Line 289 says "页面继续使用现有 Bing quote HTML URL、`credentials: "include"` 和 `DOMParser` 解析逻辑" — this is for **Bing** quote, not fallback.

**Assumption**: Fallback `qotd_url` is fetched by Worker (not page) and must return structured JSON (not HTML requiring `DOMParser`).

**Recommendation**: Explicitly document fallback URL format, parsing logic, error handling, and security constraints (HTTPS only, no credentials, CORS-compliant).

---

### 18. Test Coverage: Metadata Merge Order Not Comprehensive

**Location**: PLAN9 lines 444, Spec line 197

**Quote**:
> "所有字段合并必须与 API 完成顺序无关。"

**Test Requirement** (line 444):
> "`metadataStage` 在任意响应顺序下只前进不后退。"

**Gap**: "任意响应顺序" should include:
- IOTD → Model → Archive ✅
- Archive → Model → IOTD ✅
- Model Preload → IOTD → Model Media ✅
- IOTD → Model Preload (should NOT downgrade) ✅
- **Model Media → IOTD (same identity, different fields)** ❓
- **Archive → IOTD (different identity)** ❓

The spec says "只有日期和 `imageId` 同时一致时才能合并" (line 181), so different identity → no merge. But test coverage should verify:
- Different identity at same date → separate entries OR replacement?

**PLAN9 line 189**:
> "IOTD 身份与临时条目不同时整体替换；不得因"阶段单调"而保留另一张图片的字段。"

So IOTD replaces mismatched identity ✅. But what if Archive arrives first with identity A, then IOTD arrives with identity B?
- Archive creates entry: `{date: "20260820", imageId: "A", metadataStage: "archive"}`
- IOTD arrives: `{date: "20260820", imageId: "B"}`
- Result: Entry replaced ✅

**But**: What if Archive succeeds (8-day window validated), then IOTD arrives with different identity for day 8?
- Archive status = "success" based on old identity A at day 8
- IOTD replaces day 8 with identity B
- Archive status now **invalid** (identity mismatch)

**PLAN9 line 222**:
> "已成功的 Archive 状态在 IOTD 八日窗口变化、最老日期变化或对应 IOTD 身份变化时立即失效为 `missing`"

✅ This is covered! But test must verify this transition.

---

## 🔵 MINOR ISSUES

### 19. Terminology: "Context" vs "Browsing Context"

**Location**: Throughout PLAN9 and spec

**Issue**: The term "context" is overloaded:
- Browsing context (regular vs incognito)
- Refresh context (generation token)
- JavaScript execution context

**Recommendation**: Use "browsing context" explicitly for regular/incognito, "refresh generation" for date rollover tracking.

---

### 20. cachedFutureDepth Is Diagnostic But Persisted

**Location**: PLAN9 line 93, Spec line 131

**Quote**:
> "`cachedFutureDepth` 是诊断值：每次派生保留集合或重新扫描缓存时，从目标日期的下一天开始，统计同时命中 preview 和当前配置最终分辨率的连续未来日期数"

**Issue**: If it's "diagnostic only" (line 346), why persist it in `refreshState`? Diagnostic data should be:
- Logged to console
- Exposed via debug UI
- Computed on-demand

**Persisting** it implies it's used for decision-making, but the spec says it's not.

**Recommendation**: Move `cachedFutureDepth` to a separate `diagnosticState` object or in-memory-only state.

---

### 21. Image Failure Record Deletion Too Eager

**Location**: PLAN9 line 340

**Quote**:
> "图片失败记录在 URL 不再受目录或显示状态引用时立即删除。该删除有意使未来重新出现的 URL 作为新任务尝试，不额外保留24小时旧失败状态。"

**Issue**: If an image fails at 10:00 AM, is removed from catalog at 10:05 AM (date rolled over), then re-appears in catalog at 10:10 AM (Model updated with same URL), the failure record is gone.

**Scenario**:
1. Image URL "https://.../OHR.Image_UHD.jpg" fails at 10:00 AM (Bing CDN issue)
2. Failure record: `{attemptedAt: 10:00, nextRetryAt: 10:01, retryLevel: 1}`
3. Date rolls over, target date changes, URL no longer in catalog
4. Failure record deleted (per line 340)
5. **Bing CDN still broken** (issue persists)
6. Model includes same URL for new target date
7. Worker attempts fetch immediately (no failure record)
8. Fails again
9. Creates new failure record: `{retryLevel: 1}` (restarted from 0 → 1)

**Expected Behavior**: Failure record for specific URL should persist across date changes, at least until the backoff window expires.

**Current Design**: "有意使未来重新出现的 URL 作为新任务尝试" — intentional retry on re-appearance.

**Tradeoff**: 
- ✅ Allows recovery from transient failures
- ❌ Doesn't preserve backoff state across date boundaries

**Recommendation**: Keep failure records for 24 hours regardless of catalog state, OR extend retention to "max backoff window + margin" (e.g., 10 minutes).

---

### 22. Node Test Environment Missing Crypto Polyfill

**Location**: PLAN9 line 287

**Issue**: `crypto.randomUUID()` is a Web API. Node.js has `crypto.randomUUID()` in Node 16.7+, but requires:
```javascript
const { randomUUID } = require('node:crypto');
```

**Test Requirement** (line 461):
> "Quote 租约固定60秒并由 `crypto.randomUUID()` 生成 token"

**Gap**: If pure-logic modules use `crypto.randomUUID()`, they must either:
1. Import `node:crypto` conditionally
2. Accept a UUID generator as a parameter (dependency injection)

**Recommendation**: Use dependency injection for testability:
```javascript
function createQuoteLease(generateToken = crypto.randomUUID) {
  const token = generateToken();
  // ...
}
```

---

### 23. Archive Trivia ID Rewrite Doesn't Handle Missing ID

**Location**: PLAN9 line 254

**Quote**:
> "Archive trivia ID 中的日期段改写为最终 `isoDate`。例如 `HPQuiz_20260720_SantaCatalina` 改为 `HPQuiz_20260721_SantaCatalina`。"

**Issue**: What if Archive entry has no trivia ID? Or trivia ID doesn't match expected format?

**Expected Behavior**:
- No trivia ID → leave `triviaId` empty, `triviaState: "missing"` ✅
- Invalid format → log warning, leave `triviaId` as-is OR clear it

**Current Spec**: Doesn't explicitly handle this case.

**Recommendation**: Add error handling for trivia ID rewrite edge cases.

---

### 24. Display State Updated Timestamp Not Used for Conflict Resolution

**Location**: PLAN9 line 160

**Display State Schema**:
```javascript
{
  date: "YYYYMMDD",
  imageId: "OHR.ImageName",
  url: "https://...",
  preloadDataUrl: "data:image/...",
  updatedAt: 0  // ← What is this used for?
}
```

**Issue**: `updatedAt` is included but never referenced in conflict resolution or staleness checks.

**Potential Use**: Detect and warn about "display state older than 7 days" (user hasn't opened new tab in a week).

**Current Design**: Not used for any logic.

**Recommendation**: Either:
1. Use `updatedAt` for diagnostics (log warning if stale)
2. Remove it if truly unused

---

### 25. Migration Phase Transition Not Fully Idempotent

**Location**: PLAN9 lines 405-406

**Quote**:
> "每次普通 Worker 启动都执行轻量收尾：v2 有效但标记未完成时继续验证并推进；标记已完成但旧键仍存在时继续删除，直到 fresh-read 确认旧键消失；v2 部分写入或验证失败时从可用 legacy 数据幂等重建。"

**Issue**: "v2 部分写入或验证失败时从可用 legacy 数据幂等重建" — but what if:
1. Migration writes partial v2 catalog (5 of 8 entries)
2. Worker crashes
3. Worker restarts, sees partial v2 catalog
4. Worker "rebuilds from legacy data" — does it:
   - ✅ Merge legacy into existing 5 entries?
   - ❌ Replace all 5 entries with fresh legacy import?

**Expected**: Merge (keep existing 5, add missing 3 from legacy).

**Clarification Needed**: Explicitly state that partial v2 state is **merged** with legacy, not replaced.

---

### 26. Test Gap: Worker Restart During Image Batch

**Location**: PLAN9 line 327, Test requirement line 500

**Test Requirement**:
> "在未来批次中途终止 Worker，下一次新标签页只补缺失图片；单张失败不会阻塞后续日期，退避到期后的下一次事件可以补齐。"

**Gap**: This tests future batch restart, but not:
- Restart during **historical** backfill (same logic, should test both)
- Restart during **active fetch** (response in-flight when Worker dies)

**Expected Behavior** (restart during active fetch):
1. Worker starts fetching "https://.../Image_UHD.jpg"
2. Worker suspended by browser mid-fetch
3. Fetch is **canceled** by browser (Worker owns the fetch)
4. Response never arrives, not cached
5. Next Worker restart rebuilds queue, sees "Image_UHD.jpg" not cached
6. Re-attempts fetch ✅

**Test Must Verify**: Same URL isn't fetched twice concurrently (active task de-duplication).

---

## Summary Table

| ID | Severity | Category | Issue |
|----|----------|----------|-------|
| 1 | 🔴 CRITICAL | Race Condition | Stale generation quote/trivia bypass catalog rejection |
| 2 | 🔴 CRITICAL | Atomicity | Display state + preview data URL can diverge |
| 3 | 🔴 CRITICAL | Logic Error | Archive validation off-by-one / ordering ambiguity |
| 4 | 🔴 CRITICAL | Collision Risk | Quote lease token collision handling unclear |
| 5 | 🔴 CRITICAL | Race Condition | Image prefetch generation can lose valid responses |
| 6 | 🔴 CRITICAL | Namespace Leak | Incognito can read partial regular migration state |
| 7 | 🔴 CRITICAL | Race Condition | Page-local generation doesn't prevent cross-tab races |
| 8 | 🟡 SIGNIFICANT | Performance | Future prefetch can starve historical backfill |
| 9 | 🟡 SIGNIFICANT | Consistency | Model PreloadMediaContents validation wording ambiguous |
| 10 | 🟡 SIGNIFICANT | Fragility | Archive trivia ID rewrite assumes format |
| 11 | 🟡 SIGNIFICANT | Performance | UHD toggle can create cache thrashing |
| 12 | 🟡 SIGNIFICANT | UX Expectation | Concurrent tab writes create unpredictable state |
| 13 | 🟡 SIGNIFICANT | Burst Load | Network reconnect bypass can create request storm |
| 14 | 🟡 SIGNIFICANT | Race Condition | Migration display state handoff race (benign) |
| 15 | 🟡 SIGNIFICANT | Detection Gap | Cache eviction detection is reactive, not proactive |
| 16 | 🟡 SIGNIFICANT | Performance | Trivia concurrency=2 might delay completion |
| 17 | 🟡 SIGNIFICANT | Security | Quote fallback URL not validated |
| 18 | 🟡 SIGNIFICANT | Test Coverage | Metadata merge order not comprehensive |
| 19 | 🔵 MINOR | Terminology | "Context" overloaded |
| 20 | 🔵 MINOR | Design | cachedFutureDepth is diagnostic but persisted |
| 21 | 🔵 MINOR | Backoff | Image failure record deletion too eager |
| 22 | 🔵 MINOR | Test Env | Node test missing crypto polyfill |
| 23 | 🔵 MINOR | Error Handling | Archive trivia ID rewrite doesn't handle missing ID |
| 24 | 🔵 MINOR | Unused Field | Display state updatedAt not used |
| 25 | 🔵 MINOR | Idempotency | Migration rebuild logic not fully specified |
| 26 | 🔵 MINOR | Test Coverage | Worker restart during active fetch not tested |

---

## Recommendations

### Immediate Action Required (Before Implementation)
1. Fix Critical Issues #1, #2, #5, #7 (race conditions in state management)
2. Clarify Archive validation logic (Issue #3)
3. Namespace migration marker for incognito safety (Issue #6)
4. Add quote lease collision handling (Issue #4)

### High Priority (Before Release)
5. Document cross-tab display state semantics (Issue #12)
6. Define cache cleanup timing for resolution changes (Issue #11)
7. Validate and document quote fallback URL security (Issue #17)
8. Add comprehensive metadata merge order tests (Issue #18)

### Post-Launch Monitoring
9. Measure historical backfill latency under backoff (Issue #8)
10. Track cache eviction frequency and offline depth (Issue #15)
11. Monitor UHD toggle frequency and cache churn (Issue #11)

---

**End of Report**
