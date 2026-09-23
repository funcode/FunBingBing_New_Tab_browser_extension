已参考 [api.txt](./api.txt)、Chrome 官方的 [Incognito manifest 文档](https://developer.chrome.com/docs/extensions/reference/manifest/incognito)和[扩展存储文档](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)。字段映射、日期范围、Archive `enddate`匹配、trivia ID 改写和 Preload 元数据可信度判断以`api.txt`为依据；普通/隐身上下文的设计以 Chrome 官方文档为依据。

<proposed_plan>
# PLAN9：由 Service Worker 管理的壁纸缓存流水线

`docs/adr/`中的 ADR 是本计划的权威决策记录；PLAN9 与 ADR 冲突时以 ADR 为准。

ADR-0012 记录了"preview 与最终分辨率并行下载"的受控并发方案作为未来性能优化选项，当前 PLAN9 实施仍保持严格串行。

## 术语约定

- “上下文”单独使用时指 Chrome browsing context：`regular`或`incognito`；“刷新 generation”指持久化的目录日期滚动代数。
- `refreshState.generation`、`imagePrefetchGeneration`和页面本地 generation token 是三个互不替代的作用域：前者保护目录刷新提交，第二个控制运行时图片队列，第三个只保护创建它的页面回调。
- “代数变化”必须明确写出上述三个名称之一；不得把 browsing context、刷新 generation、图片队列 generation 或页面本地 token 简称为同一个“context”。

## COMMENTS_8 评审结论

- 接受“旧 generation 结果可能改变正在显示日期的图片身份”这一风险，但采用比评审建议更完整的规则：过期结果只能补充同一`date + imageId`，绝不能替换已有身份；提交前还要读取显示状态，候选身份与正在显示身份不同时跳过该条目。
- 不接受“被拒绝的过期候选仍会通过 Quote/Trivia 改坏显示状态”的原始场景：用户导航不递增 Worker 的 refresh generation，Quote 日期来自已提交目录且页面按显示状态 date 读取，Quote/Trivia 也不写显示状态。但接受其中暴露的较窄 Trivia 完成竞态：Trivia 只能从已提交目录派生；`triviaId`是 Trivia 工作的唯一身份，date 只用于定位目录条目；成功或失败结果提交前必须重新读取目录并确认`triviaId`仍匹配。
- 接受“旧 preview data URL 与新最终图片可能产生跨图切换”这一 UX 问题，但不采纳移除`imageId`校验的建议。正确做法是：身份相同时才保留旧 data URL；身份变化且新 preview 缺失时清空 data URL，让内置回退图接管。后续更新继续同时校验 generation、date 和 imageId。
- 接受串行批次的抢占规则需要明确。所有图片下载共用单消费者调度器；当前/用户导航请求提升到待处理队首，但不取消正在执行的 fetch，也不启动第二个并发请求。继续保持用户指定的逐张后台预取，不采用并发2方案。
- 明确`refreshWallpaperCatalog`的元数据刷新 Promise 不包含 trivia 或图片补齐；新日期刷新不需要等待普通上下文最多14张或隐身上下文最多2张未来图片，也不需要等待历史回填完成（ADR-0011）。
- 接受 HD/UHD 快速切换可能重排待处理任务。相同规范 URL 的活动或排队任务只保留一个；旧队列停止继续派发，但已返回响应是否可写入由“该 URL 是否仍属于最新保留集合”决定，不能只因 generation 改变就无条件丢弃。
- 不接受“旧 generation 的有效响应会导致新队列重复下载同一规范 URL”为实际竞态：同一任务在`cache.put()`或失败状态写入完成前持续占用任务 Map，新队列不能创建重复活动/待办；随后派发又会重新执行`cache.match()`。接受原评审指出的文档与测试缺口，明确任务 Map 生命周期及派发前双重检查，并增加旧 generation 响应成功写入后的单次网络请求回归测试。
- 接受“隐身 Worker 可能误读普通迁移标记”作为真实的设计加固问题。迁移键改为`wallpaper_migration_v2_state_regular`；初始化先按`contextId`分支，隐身只用自身 v2 键和共享 sync 设置的显式 allowlist，禁止全量扫描、读取、等待或修改普通迁移/v1 键，并增加普通标记各阶段下的隐身启动测试。
- 不接受“页面本地 generation token 无法跨标签页协调，因此会永久丢失 preview”作为关键正确性问题。跨标签页不要求实时收敛；被导航后的页面拒绝旧通知是为了保护本页当前选择，不代表 Cache Storage 中的 preview 丢失。空`preloadDataUrl`仍是可恢复快照，后续新标签页初始化会独立执行匹配 preview 的修复。增加该跨标签页时序的回归测试，明确通知只是修复机会而非唯一来源。
- 接受配额压力会缩短实际离线窗口，但纠正“其他扩展共享同一 origin 配额”的表述：不同扩展具有不同 origin；仍可能受本扩展自身用量和浏览器/设备整体存储压力影响。Cache API 没有逐响应 pin，本计划不新增`unlimitedStorage`权限；普通上下文保留最多7日的 best-effort 未来深度，隐身上下文按 ADR-0011 只保留未来1日。
- 不采用未经测量的20/35 MiB软告警阈值。实施验收先分别记录固定 fixture 与实机样本的 HD/UHD 字节数；阈值若有必要，应基于测量分布另行决定，不能在计划中猜测。
- 评审所称“Worker 重启会重置 refresh generation”不成立：持久化的`refreshState.generation`继续保留；只有运行时`imagePrefetchGeneration`和图片任务 Map 丢失，下一次事件从目录与 Cache Storage 重建。
- ADR-0006确定使用单一深色渐变作为回退背景；不新增默认壁纸资源。

- 采纳新的未来图片策略：普通上下文把一次 Model 响应中每个有效`PreloadMediaContents`未来日期最多排入7日后台预取批次；隐身上下文只排入`targetDate + 1`，不再排入更远日期；两者都在当前/历史图片补齐之后执行。
- “一次预取全部”表示一次性排入允许范围内的完整批次，而不是并行下载。未来图片按日期从近到远严格串行；缓存命中直接跳过，任一时刻每个上下文最多只有1个未来图片网络请求。
- 每个允许的未来日期同时预取 preview 和用户当前配置的最终分辨率，即 `_640x360.jpg`加 HD 或 UHD，共2个精确响应。普通上下文7个未来日期完整批次最多14个下载任务；隐身上下文最多2个下载任务。
- 历史补齐和未来批次全程共用同一个串行消费者。目标日期完成后，先按日期从近到远补齐历史 preview，再按同样顺序补齐历史配置最终分辨率；历史补齐结束后，未来批次再先补未来 preview、后补未来配置最终分辨率。这样 Worker 即使中途被挂起，也优先完成用户已经能够导航查看的内容。
- 在 Model 窗口和图片身份稳定、分辨率设置未变化时，普通上下文每日滚动后旧未来日期应命中缓存，只为新加入的最远日期下载 preview 和最终分辨率，共2个响应；隐身上下文只维持下一未来日期的同样2个响应。Bing 改换已发布的未来图片身份或用户切换 HD/UHD 时，可以有更多未命中。
- 接受首次安装或离线超过对应未来窗口后可能串行下载最多14个（普通）或2个（隐身）未来响应。该批次只能在目标日期最终图片以及当前缺失的历史图片完成缓存检查、本轮允许的下载尝试，或因退避窗口尚未到期而明确跳过后开始；单个目标或历史图片失败只记录独立退避状态，不能永久阻塞后续历史任务或未来批次。所有后台补齐都不能阻塞当前壁纸显示、元数据提交或页面交互。
- 不采纳“仅以最新 IOTD `isoDate`作为目标日期”的建议。当前所有壁纸、Model、Archive 和 trivia API 都固定使用`mkt=zh-CN`；如果只依赖上次响应中的最新日期，已成功状态本身无法决定何时再次探测下一次滚动。PLAN9 保留`Asia/Shanghai`市场日期作为探测边界，并把固定市场声明为当前产品不变量。
- `qotd_url`只配置缺失 Quote 的回退数据源，不改变 Bing 壁纸市场。未来支持其他市场属于独立功能，届时必须同时定义市场时区、滚动边界、存储迁移和测试；本计划不为未请求的市场配置预留抽象。
- 接受 Archive 成功条件需要精确到完整连续八日 IOTD 窗口；不足八日或身份不匹配时保持`missing`。
- 接受 Quote 租约必须固定上限，采用60秒并由 Worker 使用`crypto.randomUUID()`生成 token；成功同步或 Quote 已由其他流程补齐时立即清除租约。
- 普通上下文的基础保留集合为30个缓存键，隐身上下文为18个；显示状态额外保护最多2键，因此清理后的稳定上限分别为32键和20键；这个键数与后文取消的32 MiB字节阈值无关。
- 图片失败记录在 URL 不再受目录或显示状态引用时立即删除。该删除有意使未来重新出现的 URL 作为新任务尝试，不额外保留24小时旧失败状态。
- 接受迁移必须可重复完成、v2 读取优先级必须绝对高于残留 v1 键，以及旧日期异步结果不得回写新日期刷新状态。
- Trivia 重试明确为事件驱动、依赖用户活动的最终一致行为；不增加`chrome.alarms`权限或后台定时唤醒。
- 继续保留 PLAN8 的页面侧 Quote 解析、上下文隔离、最终分辨率单次切换、内置回退图、分来源提交和无永久抑制状态原则。

## 总体目标与日期定义

将 Bing 壁纸元数据获取、合并、图片下载及缓存维护统一交给当前上下文的后台 Service Worker。新标签页只读取本地目录和 Cache Storage，不直接请求壁纸 API、下载图片或写入图片缓存。

定义常量`BING_MARKET = "zh-CN"`和`BING_MARKET_TIME_ZONE = "Asia/Shanghai"`。本计划中的`targetDate`是该固定 Bing 市场的当前发布日期，格式为`YYYYMMDD`；它用于 API 覆盖验证、目录身份和刷新滚动，不使用浏览器所在时区的本地日期。

条目的`date`是 Bing 内容的发布身份，不是用户本地日历的“今天”标签。页面时钟继续显示用户本地时间；壁纸详情中的日期继续把`YYYYMMDD`按字符串格式化为`YYYY/MM/DD`，不构造`Date`、不做时区或用户 locale 转换，也不把`targetDate`宣称为用户本地日期。IOTD 返回的最新`isoDate`必须与当前市场目标日期一致才能完成本轮覆盖，但它不单独决定下一次探测时间。

验收目标：

- 当天最终分辨率图片已缓存时，新标签页不等待网络即可显示。
- 关机或离线不超过已缓存的未来窗口时，目标日期的临时条目及其最终分辨率缓存可以在本轮网络刷新前立即显示；IOTD 到达后再校正元数据或图片身份。
- 首次安装、未来缓存全部失效或离线超过当前上下文未来窗口时，先完成当前壁纸和用户可导航的历史缺失图片，再在后台逐张补齐允许范围内的 Model 有效未来图片。
- 当天各元数据来源已完整刷新时，重复打开新标签页不重复请求这些来源。
- Bing 在日期切换后暂未提供目标日期时，短暂保留上一张壁纸并按递增退避规则自愈，不会把旧响应永久锁定为成功。
- Quote 功能完整保留，但其网络和解析工作不阻塞壁纸显示。
- 页面与 Service Worker 不会同时写壁纸目录或图片缓存；普通与隐身上下文也不会互相覆盖逻辑状态，且隐身未来预取上限为1日。
- 壁纸首屏不出现纯黑或默认背景闪烁。仅在打开新标签页的初始化流程中，页面可以短暂显示所选`date + imageId`的匹配 preview，直至同一图片的最终分辨率就绪；手动日期导航不显示目标 preview。
- 所有能够抑制后续工作的状态都有明确的到期时间、重置条件或权威完成条件。

## 上下文、存储键与所有权

使用`chrome.extension.inIncognitoContext`得到`contextId`：普通窗口为`regular`，隐身窗口为`incognito`。

逻辑状态使用以下物理名称：

- 目录：`bing_wallpaper_catalog_v2_regular`或`bing_wallpaper_catalog_v2_incognito`。
- 显示状态：`wallpaper_display_state_v2_regular`或`wallpaper_display_state_v2_incognito`。
- Quote 缓存：`cache_quote_state_v2_regular`或`cache_quote_state_v2_incognito`。
- Quote 抓取租约：`quote_scrape_state_v2_regular`或`quote_scrape_state_v2_incognito`。
- Cache Storage：`funbingbing-wallpaper-cache-v2-regular`或`funbingbing-wallpaper-cache-v2-incognito`。
- 普通上下文迁移标记：`wallpaper_migration_v2_state_regular`，只记录普通上下文的迁移版本、阶段和时间，不承载运行时目录数据；隐身上下文不读取、解释、等待或修改该标记及任何其他迁移键。

上下文后缀是正确性边界，不是对 Chrome 底层 Cache Storage 分区方式的推断。即使两个上下文实际共享同一扩展源的 Cache Storage，不同缓存名也不会互相产生错误的命中或清理。

所有权规则：

- 每个上下文的 Service Worker 独占写入该上下文的目录、图片 Cache Storage、Quote 缓存和 Quote 抓取租约。
- 页面只写当前上下文的`wallpaper_display_state_v2_*`。
- 页面读取图片时只允许`cache.match()`；缓存未命中时不得调用`fetch()`或`cache.put()`。
- 页面可以抓取和解析 quote HTML，但只能把解析结果发送给 Worker，由 Worker 持久化 Quote 缓存。
- `enable_uhd_wallpaper`、`qotd_url`和其他用户设置存放在`chrome.storage.sync`，因此普通与隐身窗口读取同一份配置；壁纸目录、显示状态、Quote 状态和 Cache Storage 仍按上下文隔离。
- 旧`wallpaper_date`、`wallpaper_idx`、`wallpaper_url`和`wallpaper_preload_data_url`只作为迁移输入，v2 运行时不再写入。

## 目录与显示状态

每个上下文使用以下目录结构：

```js
{
  version: 2,
  updatedAt: 0, // numeric diagnostic timestamp of the last catalog commit
  refreshState: {
    date: "YYYYMMDD",
    generation: 0,
    cachedFutureDepth: 0, // regular: 0..7; incognito: 0..1
    sources: {
      imageOfTheDay: {
        status: "success" | "failed" | "missing",
        attemptedAt: 0,
        nextRetryAt: 0,
        retryLevel: 0,
        lastReconnectBypassAt: 0
      },
      model: {
        status: "success" | "failed" | "missing",
        attemptedAt: 0,
        nextRetryAt: 0,
        retryLevel: 0,
        lastReconnectBypassAt: 0
      },
      archive: {
        status: "success" | "failed" | "missing",
        attemptedAt: 0,
        nextRetryAt: 0,
        retryLevel: 0,
        lastReconnectBypassAt: 0
      }
    },
    imageFailures: {
      "https://...": {
        attemptedAt: 0,
        nextRetryAt: 0,
        retryLevel: 0,
        lastReconnectBypassAt: 0
      }
    }
  },
  entries: {
    "YYYYMMDD": {
      date: "YYYYMMDD",
      imageId: "OHR.ImageName",
      urls: {
        preview: "https://..._640x360.jpg",
        highDef: "https://..._1920x1080.jpg",
        ultraHighDef: "https://..._UHD.jpg"
      },
      caption: "",
      title: "",
      headline: "",
      description: "",
      descriptionPara2: "",
      descriptionPara3: "",
      copyright: "",
      clickUrl: "",
      backstageUrl: "",
      quickFact: "",
      triviaId: "",
      triviaData: null,
      metadataStage: "legacy" | "archive" | "preload" | "media" | "iotd",
      triviaState: "missing" | "complete",
      triviaAttemptedAt: 0,
      triviaNextRetryAt: 0,
      triviaRetryLevel: 0,
        updatedAt: 0 // numeric diagnostic timestamp of the last entry commit
    }
  }
}
```

页面显示状态使用单一对象，避免日期、URL 和 preload data URL 分别写入造成不一致：

```js
{
  date: "YYYYMMDD",
  imageId: "OHR.ImageName",
  url: "https://...",
  preloadDataUrl: "data:image/...",
  updatedAt: 0 // numeric timestamp of the successful final-image application
}
```

- `wallpaper_display_state_v2_*`是每个上下文全局的“最后一次成功应用的最终壁纸”快照，不是待处理导航状态，也不是要求所有已打开标签页实时同步的状态。新标签页以读取时最新已提交的快照作为初始选择。
- 多个标签页都可以在成功应用最终图片后原子写入该对象；跨标签页采用 last-write-wins 语义决定后续读取者的起点，不增加协调锁或强制现有标签页跟随其他标签页的后续写入。每个标签页的 generation token 只负责拒绝本标签页内的过期回调。
- `preloadDataUrl`属于显示状态，由页面从匹配的 Cache Storage preview 读取、生成并与`date`、`imageId`和最终 URL一起写入。明确写空是内部一致且可恢复的有效值；原子性要求非空 data URL 必须匹配同一快照身份，不要求每次提交都已有 preview。Worker 不写`wallpaper_preload_data_url`或 v2 显示状态。

- `metadataStage: "iotd"`只表示 IOTD 核心元数据已到达，不表示 trivia 已完成。
- 持久化目录不保存`triviaState: "pending"`。Worker 的 trivia in-flight Map 表示运行时 pending；Worker 被终止后，持久化的`missing`仍可重试。
- `triviaState: "complete"`表示请求成功完成；如果上游明确没有题目，`triviaData`可以为`null`。
- 图片身份变化并替换条目时，将`triviaData`清空、`triviaState`设为`missing`，并清零 trivia 尝试时间。

## URL、身份与阶段不变量

- 从 IOTD URL、Model URL 和 Archive `urlbase`中提取去除分辨率与扩展名后的`OHR.*`标识。
- 只有日期和`imageId`同时一致时才能合并不同来源的数据。
- 迁移的旧相对 URL、IOTD 相对 URL 和 Model 图片 URL 都先提取并验证`imageId`，再以固定 origin `https://ts1.tc.mm.bing.net`生成规范横向 URL，保证不同来源及日期滚动后的 Cache Storage 精确键一致。
- 规范后缀固定为 preview `_640x360.jpg`、HD `_1920x1080.jpg`和 UHD `_UHD.jpg`。Model 样本中的`_1920x1080.webp`只用于提取身份，不能直接成为 HD 缓存键；否则同一图片次日被 IOTD 表示为`_1920x1080.jpg`时会产生伪未命中。
- URL 解析必须先用`URL`读取完整`id`参数，再只移除末尾已知的`_(UHD|1920x1080|640x360).(jpg|webp)`分辨率与扩展名部分，保留此前完整的图片名、市场代码和哈希，最后追加规范后缀重建 URL。不得对完整 URL 做任意替换，也不得使用会在第一个下划线截断身份的`/OHR\.[^_]+/`式正则。无法验证 HTTPS、完整`OHR.*`身份或已知末尾后缀的 Model 图片不进入未来预取队列。
- Cache Storage 键按上述完整规范 URL 精确匹配，不为同一身份保存 WebP/JPEG 或等价 host 别名。
- 只保存和预取横向 preview、HD、UHD；IOTD 的 landscape `wallpaper`、portrait URL 不进入目录，也不计入缓存保留集合。
- 阶段等级固定为`legacy < archive < preload < media < iotd`。同一日期和身份的合并只能保持或提高`metadataStage`，后到的低优先级来源不得降低阶段。
- IOTD 身份与临时条目不同时整体替换；不得因“阶段单调”而保留另一张图片的字段。
- 所有字段合并必须与 API 完成顺序无关。

## API 刷新、成功条件与防抖

刷新触发条件：

- 扩展安装或升级。
- 浏览器启动。
- 新标签页发送`refreshWallpaperCatalog`。
- 网络由离线恢复为在线。
- 设置页修改壁纸清晰度后请求当前显示日期的新分辨率。

Worker 每次刷新先计算`targetDate`。如果`refreshState.date`不同，则递增持久化的`refreshState.generation`并为新日期重建三个来源状态；保留目录和仍有效的图片失败记录。每个异步来源任务在启动时捕获`date + generation`，提交时用它判断结果是否仍属于当前刷新轮次。Service Worker 重启后重新读取该 generation，不把它重置；它与后文仅存在于内存的`imagePrefetchGeneration`是两个不同概念。

不得在“三个元数据来源都成功”时直接从整个刷新函数返回。Worker 分别计算元数据、trivia 和图片三类待办；某类已完成只跳过该类，不能阻止另外两类修复缺失状态。

内部同日期刷新 Promise 只覆盖需请求的 ImageOfTheDay、Model、Archive 及其分来源目录提交；trivia 和图片队列在目录提交后独立调度，不计入该 Promise。页面发送`refreshWallpaperCatalog`后不等待后台图片或 trivia，日期变化也可立即建立新一轮元数据刷新并使旧图片队列停止派发。

每个来源独立判断重试：

- `nextRetryAt`属于来源自身，不使用全局时间。
- 所有重试对象使用有上限的递增退避：连续失败后的等待时间依次为1分钟、3分钟、5分钟，第3次及以后保持5分钟。持久化`retryLevel`范围为0至3；失败时先提升一级，再由该级别计算`nextRetryAt`。
- 网络或 JSON 解析失败记为`failed`。
- HTTP 和 JSON 成功但缺少本轮所需覆盖范围记为`missing`，不能记为`success`。
- `failed`和`missing`都推进该来源的`retryLevel`。成功时清零`nextRetryAt`和`retryLevel`；目标日期变化时为新日期重建来源状态并从0级开始。
- 离线恢复最多绕过每个来源当前退避窗口一次。绕过本身不重置`retryLevel`；绕过后再次失败会继续提升到下一退避级别。网络恢复由浏览器`online`事件或现有页面每15秒一次的实际连接检查触发；同一退避窗口只允许一次绕过，后续事件不能重复绕过。退避到期只表示允许重试，不主动唤醒 Worker，也不打断正在执行的 fetch。

来源成功条件：

- ImageOfTheDay 必须包含日期为`targetDate`、身份有效且可形成标准横向 URL 的 IOTD 条目。
- Model `MediaContents`必须包含`Ssd === targetDate`的有效条目；Preload 内容可以提前提交，但不能把缺少目标日期的 Model 响应标记为成功。
- HPImageArchive `idx=7`只有在目录当前存在从`targetDate`开始、按日期连续且均为`metadataStage: "iotd"`的8个有效 IOTD 条目时才可判定。Archive 的`enddate`必须等于该连续八日窗口中最老条目的日期（即`targetDate - 7 days`），且`imageId`必须一致；不足8条、日期不连续、阶段不足或身份不符时均保持`missing`并按递增退避重试。
- 已成功的 Archive 状态在 IOTD 八日窗口变化、最老日期变化或对应 IOTD 身份变化时立即失效为`missing`，避免保留由旧窗口验证的第8日增强数据。
- 有效但尚未覆盖目标日期的响应仍可合并其中可验证的旧条目或未来临时条目，但对应来源保持`missing`并按递增退避重试。

并发与持久化：

- 同一上下文、同一目标日期的刷新共享一个内存 Promise；刷新中日期变化时只排队一次新日期刷新。
- ImageOfTheDay、Model 和 Archive 中需要重试的来源并行启动。
- IOTD 成功后立即提交并优先缓存目标日期图片，不等待其他来源。
- Model 和 Archive 各自成功后分别提交，避免慢来源延迟已完成结果。
- 每个上下文使用一个串行目录写队列；每次提交前重新读取该上下文的最新目录再合并。
- 旧`date + generation`任务晚到时，只能给目录中已存在且`date + imageId`完全一致的历史条目补充缺失字段，或新增一个此前不存在且不是当前显示日期的有效历史条目；绝不能替换任何已有日期的`imageId`。目录写队列在提交前重新读取显示状态；当过期候选的`date`等于显示状态的`date`，但候选`imageId`与显示状态的`imageId`不同时，从本次目录提交中丢弃整个候选条目，不合并其任何字段。同一批次中其他相互独立且有效的候选仍可提交；不得因此中止整个目录写入或引入跨存储事务。只有当前 refresh generation 的权威来源可以按正常合并规则替换身份。
- 过期任务不得覆盖新的`refreshState.date`、`generation`或任何来源状态，不得删除目录条目，也不得启动旧日期的目标图片预取。
- 旧轮次失败或缺少覆盖的结果只记录诊断日志，不得把新轮次来源重新标记为`failed`或`missing`。
- 普通和隐身 Worker 写不同物理键，因此各自的队列构成完整的单写入者边界。

## 元数据合并规则

字段优先级：

1. ImageOfTheDay
2. Model `MediaContents`
3. Model `PreloadMediaContents`
4. HPImageArchive
5. 迁移的旧`bing_images`

具体规则：

- IOTD 决定最终图片身份、标准横向 URL、caption、title、描述段落、copyright 和 click URL，并将阶段提高为`iotd`。
- `MediaContents`补充 headline、quick fact、trivia ID、backstage URL 和缺失字段。
- `PreloadMediaContents`为未来日期建立临时条目；其文本可以随已缓存最终图片显示；与同身份条目合并时，其字段优先级低于`IOTD`，且不得降低已有`metadataStage`，因此后续同身份 IOTD 可以覆盖其低优先级字段。
- Archive 必须用`enddate`匹配 IOTD 的`isoDate`，不得使用`startdate`或数组下标。
- Archive trivia ID 只接受已验证的`HPQuiz_<YYYYMMDD>_<slug>`格式；仅改写该格式中唯一的日期段为最终`isoDate`，不依据任意8位数字或未验证的字符串猜测替换。例如`HPQuiz_20260720_SantaCatalina`改为`HPQuiz_20260721_SantaCatalina`。缺失、null、非字符串或空值统一保存为`triviaId: ""`与`triviaState: "missing"`；非空但格式不合法的值清空为同一 missing 状态并记录结构化诊断，不得进入 Trivia 请求队列。
- Archive 专门补足 Model 只有7天、IOTD 有8天时的第8张图片。

## Trivia 获取与恢复

- 只为目标日期和历史条目获取 trivia payload；未来条目只保留`triviaId`和`quickFact`。
- 未来条目进入目标/历史窗口后即变为 trivia 候选；下一次新标签页、启动、网络恢复或目录刷新在退避窗口允许时获取 payload，不要求它在首次作为未来条目写入时完成。
- 每次刷新即使三个元数据来源都成功，也只从最新已提交目录扫描具有非空且已通过 Archive 规范化的`triviaId`、`triviaState: "missing"`且已到`triviaNextRetryAt`的当前/历史条目。尚未提交、格式不合法或已被目录提交规则拒绝的元数据候选不得直接启动 Trivia。
- Trivia 并发固定为2，并使用按`triviaId`键控的内存 in-flight Map 去重。完整`triviaId`已经是 Quiz payload 的唯一身份；其中虽包含日期和图片名片段，但不等于完整壁纸`imageId`，不得再构造`date + imageId + triviaId`复合身份。
- 并发2是有意的请求风暴限制：首次安装最多分4批补齐8条 trivia，延迟只影响非关键 quiz，不阻塞图片或核心元数据。
- 发起请求时捕获`date`和`triviaId`，但不把 pending 写入目录；date 只用于在结果提交时定位目录条目，不属于 Trivia 身份。成功和失败结果都进入该上下文的串行目录写队列，提交前重新读取最新目录；只有该 date 的条目仍存在且`triviaId`完全一致时才写入结果。成功时写入`triviaData`并设为`complete`，同时清零`triviaRetryLevel`和`triviaNextRetryAt`；失败时保持`missing`，将`triviaRetryLevel`提升一级并按1、3、5分钟序列设置`triviaNextRetryAt`。条目不存在或`triviaId`已变化时丢弃整个结果，不改变新条目的数据或重试状态。
- Worker 在请求中被终止时，目录仍为`missing`；下一次启动在退避窗口允许时自然重试，不需要恢复钩子。
- 壁纸身份替换或 trivia ID 变化会清空旧 Trivia payload，并清零对应条目的`triviaRetryLevel`和重试时间；目标日期窗口变化重新计算候选资格，但`triviaId`未变化时连续失败级别继续保留。Trivia 结果准入不检查 refresh generation：日期滚动后仍存在的同一`triviaId`可以完成，不能只因元数据 generation 变化就丢弃。
- Trivia 退避到期不会建立定时器或 alarm；重试由下一次新标签页、浏览器启动、网络恢复或目录刷新机会触发。因此重试时间是“最早允许时间”，不是保证唤醒时间。

## Quote 抓取与同步

Quote 是独立于壁纸就绪状态的页面任务，不进入壁纸显示关键路径。

Quote 抓取租约使用最小持久化结构：

```js
{
  date: "YYYYMMDD",
  token: "crypto.randomUUID()",
  leaseUntil: 0,
  nextRetryAt: 0,
  retryLevel: 0
}
```

- 页面只从当前上下文已提交目录取得按日期倒序排列的最多8个当前/历史日期；未来日期不参与 Quote 同步，被目录提交规则拒绝的元数据候选也不会进入 Quote 日期列表。
- `todayDate`使用目录中最新的当前/历史条目日期，不使用本地日期，也不再依赖页面侧 IOTD `images[0]`。
- 页面读取当前上下文的 Quote 缓存。若最新日期缺少有效 quote，则向 Worker 请求该日期的 quote 抓取租约。
- 定义`QUOTE_SCRAPE_LEASE_MS = 60_000`。Worker 只在 Quote 缺失、没有未过期租约且已到`nextRetryAt`时授予租约；token 由 Worker/runtime adapter 使用`globalThis.crypto.randomUUID()`生成，`leaseUntil = now + QUOTE_SCRAPE_LEASE_MS`。纯租约逻辑只接收不透明 token 或注入的`generateToken`函数，实际生成器只在真正授予租约时调用一次，Node 测试不得要求共享模块导入`node:crypto`。
- 页面关闭、挂起或未在60秒内提交时，Worker 允许下一页面取得新租约；旧 token 在到期或被替换后不能提交结果，也不能延长新租约。
- 获得租约的页面继续使用现有 Bing quote HTML URL、`credentials: "include"`和`DOMParser`解析逻辑；该请求与目录读取并行，但不阻塞壁纸切换。Worker 的`qotd_url`回退只接受绝对 HTTPS URL，设置校验必须使用同一规则；回退请求使用`credentials: "omit"`、`cache: "no-store"`和`redirect: "error"`，响应体上限为64 KiB，不使用页面 Cookie 或`DOMParser`。
- 页面以租约 token、目录日期列表、最新目录日期和解析结果发送`syncQuotesForImages`。即使 HTML 抓取失败，也发送空结果，让 Worker 尝试现有`qotd_url`远程回退。
- Worker 重新读取上下文 Quote 状态，验证租约后按日期合并、裁剪为8条并立即清除租约。回退响应必须是64 KiB以内的结构化 JSON，包含 quote text 字符串以及可选的 source 和 caption 字符串；字段按文本处理，禁止把回退内容作为 HTML 插入页面。格式错误、超限、非 HTTPS 或重定向不符合策略时视为回退失败并保留已有有效 Quote。结果仍缺失时提升该日期的`retryLevel`，并按1、3、5分钟序列设置独立的 Quote 重试时间。
- 目标日期 Quote 被远程回退、另一有效同步或其他 Worker 内流程补齐时，立即清除该日期租约并重置`retryLevel`和`nextRetryAt`。页面在`syncQuotesForImages`响应完成或收到包含该日期的`quotesUpdated`后丢弃本地 token；持久化租约始终以 Worker 状态为准。
- 所有页面启动时都可以发送日期同步请求，但只有持有租约的页面执行 HTML 抓取；Worker 对已齐全的日期列表直接 no-op。
- `quotesUpdated`仍只通知受影响日期，并使用与壁纸更新相同的安全广播 helper；页面按当前显示状态的 date 重新读取 Quote 缓存，不再回退到`wallpaper_idx`。

## 图片预取、按 URL 防抖与空间控制

下载优先级：

1. 目标日期的 preview。
2. 目标日期用户配置的 HD 或 UHD。
3. 目录中其余7个可导航历史日期的 preview 和配置分辨率：先按日期从近到远补齐 preview，再按同样顺序补齐用户配置的 HD 或 UHD。
4. Model `PreloadMediaContents`返回的全部有效未来日期的 preview，按日期从近到远串行。
5. 同一批未来日期用户配置的 HD 或 UHD，按日期从近到远串行。未来与历史任务共享一个后台串行队列，所有尚未开始的历史补齐任务都排在未来预取之前。

`ensureWallpaperCached`消息结构固定为：

```js
{
  type: "ensureWallpaperCached",
  date: "YYYYMMDD",
  resolution: "preview" | "highDef" | "ultraHighDef"
}
```

- Worker 只接受当前上下文目录中该日期和分辨率对应的 URL，不接受页面传入任意 URL。
- `ensureWallpaperCached`与后台预取共享同一个按规范 URL 键控的任务 Map；它同时覆盖活动 fetch 和尚未开始的排队任务，确保同一 URL 不会在队列中重复出现。任务在成功`cache.put()`或失败退避状态写入完成前不得从 Map 移除。
- 每次先`cache.match()`；命中时不联网。
- 下载失败写入`refreshState.imageFailures[url]`，提升该规范 URL 的`retryLevel`并按1、3、5分钟序列设置`nextRetryAt`。重复新标签页请求遵守该退避窗口；联网恢复每个窗口最多绕过一次，绕过失败继续升级。
- 下载成功后删除该 URL 的失败记录并广播对应日期更新。
- 图片重试与元数据来源退避彼此独立，修改 UHD 设置不会强制重新请求已成功的元数据。
- 每次目录提交、配置分辨率变化或缓存恢复扫描都根据当前目录和 Cache Storage 派生目标与历史任务，不等待 Model 返回；Model 提交有效`PreloadMediaContents`后再追加未来任务。不持久化另一份 URL 列表或游标。目标任务完成后先排列“历史 preview、历史最终分辨率”，再排列“未来 preview、未来最终分辨率”，每一阶段都按日期从近到远。队列中的命中项同步跳过；未命中但仍在退避窗口中的项目本轮跳过，只有已到重试时间的项目才发起网络请求。派发前仍须重新检查任务 Map 和`cache.match()`；因此旧 generation 活动任务刚完成并写入的 URL 会被新队列视为已完成，不会再次联网。退避到期不会单独唤醒 Worker；只有后续合格事件才重新派生队列。
- 每个上下文的目标、用户导航、未来和历史图片都进入同一个单消费者调度器，任一时刻最多1个图片 fetch。已开始的 fetch 不被中断；紧急请求只能重排尚未开始的任务，不能通过启动第二个请求来“抢占”。
- 调度优先级固定为：当前显示或用户导航的最终分辨率、同一日期 preview、历史 preview、历史最终分辨率、未来 preview、未来最终分辨率。紧急 URL 尚未排队时插入待处理队首；已在队列中时把同一任务提升到队首；已经活动时复用其 Promise。用户导航始终可以把对应历史日期提升到其他尚未开始的历史或未来任务之前。
- 未来队列必须等目标日期最终图片以及当前缺失的历史图片完成缓存检查、本轮允许的下载尝试（成功或失败），或因退避窗口尚未到期而跳过后再运行；目标或历史下载失败时记录独立退避状态并继续后续任务，不能永久阻塞未来队列。后台补齐不被页面等待，也不延迟目录广播、Quote、trivia 或导航。导航最多等待当前活动 fetch 结束及自身下载，不等待其前方原有的历史或未来待办。
- 历史和未来阶段都按日期从近到远处理。某项失败时记录其独立退避状态并继续同阶段后续任务，不能让单项失败阻塞剩余批次；下一次新标签页、启动、网络恢复或目录刷新重新派生队列并补齐已到重试时间的缺失项。
- MV3 Worker 在批次中途终止时不需要恢复游标。下一次事件重新扫描所需键，已完成项由`cache.match()`跳过，只继续下载缺失项。
- Worker 为每个上下文维护不持久化的`imagePrefetchGeneration`；目录所需键或配置分辨率变化时递增。generation 不一致会停止旧队列继续派发，但活动 fetch 返回后仍以最新目录、显示状态和配置重新判断该 URL：仍属于最新保留集合则允许`cache.put()`，否则丢弃。每次 fetch 前和写入前都重新确认日期、`imageId`、URL 和分辨率。Worker 重启后从目录和缓存重新派生即可，不恢复旧 image generation。
- 正常每日滚动且上游身份不变时，未来批次中的6个旧日期共12个键命中，只下载新加入最远日期的 preview 和最终分辨率。新目标日期的两种分辨率已由前一日未来批次缓存，不需要再为同步首屏单独下载 preview。
- Model 只返回少于7个有效未来条目时只预取可验证的条目；不得伪造缺失日期。Model 修改已知未来日期的`imageId`或 URL 时，新身份按未命中处理，旧身份在不再受引用后清理。
- `enable_uhd_wallpaper`变化时优先确保当前显示/目标日期的新最终分辨率，然后递增`imagePrefetchGeneration`，先串行补齐历史日期的新配置分辨率，再补齐全部未来日期的新配置分辨率；preview 仍是同一规范键并应命中，不重新请求元数据或 preview。设置切换或随后导航可以提升相应当前/历史 URL；快速 HD→UHD→HD 会重排待办，但相同规范 URL 的活动/排队任务仍复用同一任务。活动旧分辨率 fetch 不被取消；其响应可能消耗带宽，但在写入前发现已不属于最新保留集合时必须丢弃，不计为新配置的缓存成功。旧最终分辨率在不再受目录显示状态保护时清理；清理在新的未来批次开始前执行，切换期间允许短暂存在未引用旧键。

缓存保留集合按当前上下文独立计算：

- 目标日期及过去7天：每个日期最多2个响应，共16个。
- 普通上下文未来第1至第7天：每个日期保留 preview 和配置分辨率，共14个。
- 隐身上下文未来第1天：保留 preview 和配置分辨率，共2个。
- 显示状态引用的 preview 或最终 URL 不属于上述基础集合时，额外保护这些实际在用的键，最多2个；这包括窗口外显示以及设置或图片身份切换期间仍在显示旧 URL 的情况。
- 普通上下文基础保留集合为16 + 14 = 30个精确 URL 键；隐身上下文为16 + 2 = 18个。显示状态最多额外保护2个，因此硬上限分别为32和20。开始新的未来批次前先清理已不受引用的旧窗口和旧分辨率键，避免长时间离线后同时保留两套未来窗口；32/20是清理完成后的稳定上限，分辨率切换期间允许活动响应与新集合短暂重叠，但未被引用的旧键必须在该清理点移除。
- 清理目录或缓存时同步删除不再被目录或显示状态引用的`imageFailures`记录。删除后旧失败不再抑制未来请求；同一 URL 日后重新进入目录时按新任务处理。
- Preview URL 始终规范为同一个`_640x360.jpg`地址，不随 UHD 设置变化。
- 普通上下文全部7个未来日期同时保存 preview 和 UHD 时，实际字节数会明显高于 PLAN7 的差异化预取策略；隐身上下文最多只保存下一未来日期。这是分别控制长期与临时会话成本的明确策略。运行时按上下文硬上限限制精确键，不为统计字节读取所有响应 body，也不以字节阈值清除仍属于保留集合的图片。
- 32 MiB不再是通过/失败阈值。验收分别记录普通上下文 HD/UHD fixture 字节数，并记录隐身上下文较小保留集合的样本；如果以后需要硬字节上限，必须另行决定画质降级或缩短对应未来窗口。
- Cache Storage 是可被浏览器配额和设备存储压力清理的尽力缓存，且没有逐响应 pin 能力；离线可用深度以对应 preview 或最终响应仍命中为前提。普通上下文最多7日，隐身上下文最多1日。
- 每次启动仍执行`cache.match()`，缺失时按正常目标优先级恢复，不能仅凭目录条目假定图片一定存在。反复配额清理会把有效离线窗口缩短为 Chrome 实际保留的子集；本计划接受该限制，不新增`unlimitedStorage`权限。
- 目录根和条目的`updatedAt`也使用数值时间戳，分别表示最近一次目录提交和该条目最近一次成功提交；它们与显示状态的`updatedAt`都只是诊断/来源时间，不参与 last-write-wins、刷新或图片/Trivia 结果准入。显示状态只有在最终图片成功应用时，才将新的`updatedAt`与 date、imageId、url 和 preloadDataUrl 原子写入；失败、身份不匹配或过期回调被拒绝时保留旧快照及其时间戳。
- 内置渐变回退背景不进入 Cache Storage，也不计入上述普通32键、隐身20键上限。

## Worker 通知

目录提交和图片缓存成功后使用同一消息：

```js
{
  type: "wallpaperCatalogUpdated",
  dates: ["YYYYMMDD", "..."]
}
```

- `dates`只包含本次实际变化的日期并去重。
- 通知只是重新检查信号，不声明元数据阶段或缓存命中状态。
- 页面收到通知后重新读取上下文目录并执行`cache.match()`。
- 用一个小型广播 helper 统一处理`wallpaperCatalogUpdated`和`quotesUpdated`的`chrome.runtime.sendMessage` Promise 或 callback 错误。没有页面监听属于预期情况，不产生未处理 rejection；其他错误记录一次警告。

## 新标签页加载与导航

- 按 ADR-0006，`style.css`和`newtab.html`使用单一深色渐变作为`#main-body`初始背景，不新增或加载`assets/default-wallpaper.webp`。
- `boot.js`在配置缓存就绪后读取当前上下文显示状态；存在`preloadDataUrl`时同步覆盖内置回退图。所有 v2 写入必须维持该 data URL 与同一对象中`imageId`对应的隐含不变量，boot 阶段不再猜测或修复身份。
- 页面读取当前上下文显示状态、目录和 Cache Storage，同时非阻塞发送`refreshWallpaperCatalog`。已有有效显示状态时，其`date + imageId + url`是本次新标签页的初始选择；即使`preloadDataUrl`为空，每次新标签页初始化也必须独立检查该已提交身份的最终响应和 preview，不能只等待原提交之后的缓存通知。最终响应命中时立即显示，不等待 preview 修复；preview 命中时可生成 data URL。后台`targetDate`刷新本身不得把页面切回目标日期。显示状态为空时才从目录选择可用目标条目或保留内置回退图。
- 新标签页初始化时，如果所选条目的最终分辨率已缓存，直接显示最终图片；如果最终图片尚未缓存但匹配同一`date + imageId`的 preview 可用，则立即显示 preview 并请求 Worker 缓存最终分辨率，最终图片解码完成后切换一次。该初始化 preview 是页面临时视觉状态，不提前提交新的显示状态。
- 手动日期导航绝不显示目标日期 preview。等待期间继续显示当前最终图片，把 headline 临时设为`Wallpaper is updating...`，并只请求或等待目标最终分辨率；最终图片解码并应用成功后才原子提交目标`date`、`imageId`、最终 URL，以及可用时匹配的`preloadDataUrl`（不可用时明确写空）。加载失败时保留原图片和原显示状态。
- Bing 尚未提供目标日期时保留当前壁纸；首次安装没有历史壁纸时保留内置回退图和空的壁纸元数据状态。
- 页面启动时已有日期等于`targetDate`的未来临时条目时，在发起本轮网络刷新前先检查其配置最终分辨率；缓存命中即可显示。IOTD 同身份到达后原地更新文本，身份变化时等待新身份最终图片后整体切换。
- 每次切换前解码 blob-backed 图片；只有图片完成应用后才原子写入新的显示状态对象。若匹配的新 preview 尚未缓存，新 identity 与旧显示状态相同时可以保留旧`preloadDataUrl`；identity 不同时必须把`preloadDataUrl`写为空，让下次 boot 保持内置回退图，不能把旧图片 data URL 与新`imageId`组合在同一状态中。
- 手动导航使用按日期倒序排列的实际当前/历史条目数组，模数取实时数组长度，不使用固定8或持久化 index。
- 当前索引每次由显示状态的 date 在实时数组中查找。日期滚动或条目数不足8时不会指向另一张图片。
- 实时当前/历史数组为空时禁用前后导航并让命令直接 no-op，不执行模0运算。数组非空但显示 date 不在其中时，在目标最终图片完成前保持当前显示且暂不执行日期导航。
- 用户导航后递增页面本地 generation token；较早的目录刷新、图片加载和 data URL 转换不得覆盖当前选择。
- 用户导航中的目标日期只存在于发起导航的页面本地 pending 状态。Tab1 完成目标图片应用前，全局显示状态仍指向旧图片 A；此时打开的 Tab2 可以读取并继续显示 A，且不要求在 Tab1 随后提交 B 时自动跟随。Tab1 成功提交 B 后才打开的新标签页以 B 为初始选择。
- 成功显示日期 D 后优先从 D 的已缓存 preview 生成`preloadDataUrl`。Preview 缺失时按上述 identity 规则决定保留或清空，并请求 Worker 补齐。缓存通知到达后，仅在 generation token、date 和 imageId 仍匹配时更新`preloadDataUrl`；不得弱化为只检查 generation 和 date，因为同一日期可能已被权威来源纠正为另一身份。通知只是一次修复机会，不是唯一修复机制：即使某个标签页因导航或关闭而拒绝该通知，每次新标签页初始化都重新检查已提交`date + imageId`的 preview。写入修复结果前 fresh-read 全局显示状态，只有`date + imageId + url`仍与修复目标完全一致时才原子更新`preloadDataUrl`；不新增`previewPending`字段。
- 每次渲染先清空 trivia DOM；仅当`triviaState: "complete"`且有`triviaData`时重建题目。
- Quick fact、描述和 quote 都按显示状态 date 重新解析，不使用独立 cursor。

## 其他调用方

- `quick_links.js`根据上下文显示状态的 date 查找目录条目，不再读取`bing_images[wallpaper_idx]`。
- Quote 缺失只触发独立 Quote 同步，不改写任何壁纸日期。
- `offline-detection.js`两个分支不再写`wallpaper_date`；恢复在线时发送刷新消息，实际绕过由 Worker 的有界规则决定。
- 设置页不再写`wallpaper_date = "20000101"`。修改 UHD 设置后，针对当前显示状态 date 发送`ensureWallpaperCached`；Worker 的`chrome.storage.sync.onChanged`监听同时取消旧未来批次并按新配置串行协调所有未来图片，不重复请求元数据或 preview。
- 删除页面侧`wallpaper_fetch_lock`、等待其他标签页刷新、固定`MAX_OLD_DAYS`和基于`wallpaper_date`判断刷新完成的逻辑。

## 迁移与清理

升级时仅由普通上下文 Worker 启动幂等迁移。迁移标记使用`wallpaper_migration_v2_state_regular`键和`writing | verified | complete`三个阶段，但每次启动都以普通上下文的实际 v2 数据校验为准，不能只信任阶段字符串。初始化必须先按`contextId`分支：只有`regular`路径可以读取或写入该标记及 v1 迁移输入；`incognito`路径使用 v2 context-suffixed 键的显式 allowlist 自我播种，禁止读取、等待或修改普通迁移标记、v1 键或普通 v2 键。

- 从旧`bing_images`导入最多8个日期和身份有效的条目，并标记为`legacy`。
- 对旧相对图片 URL 固定使用`https://ts1.tc.mm.bing.net`补全，不因 Model 当前返回的 origin 不同而重写旧缓存键。
- 旧条目存在有效`triviaData`时设为`complete`，否则设为`missing`。
- 保留旧`wallpaper_url`的身份和`wallpaper_date`作为首个页面的迁移输入；页面通过规范化 URL 在导入目录中查找实际显示条目，只有 URL 无法匹配时才考虑日期，并再次验证身份。旧`wallpaper_preload_data_url`没有可独立验证的 imageId，迁移时不复制到 v2；页面初始设为空并从匹配的 v2 preview 缓存重新生成，期间由内置回退图承接。
- 不迁移`wallpaper_idx`。隐身上下文不继承普通上下文的显示状态；它在首次使用时自行建立自己的 v2 状态。
- 普通 Worker 将旧`cache_quote_state`复制到普通上下文 Quote 缓存，再由普通 Worker 独立裁剪和更新；隐身上下文不继承该缓存。
- 普通 Worker 写入普通上下文的新目录和 Quote 状态，随后 fresh-read 验证版本和条目身份；Worker 不写 v2 显示状态，也不得尝试从普通上下文写入隐身上下文的 v2 键。
- 普通 Worker 将 v1 `chrome.storage.local` 中的共享设置迁移到`chrome.storage.sync`：`search_engine_list`、`current_search_engine`、`display_search_box`、`show_top_sites`、`show_clock`、`show_quote`、`enable_uhd_wallpaper`和`qotd_url`。已有有效 sync 值优先保留；否则复制有效 local 值或对应默认值。只有目录、Quote 状态和 sync 设置都 fresh-read 验证成功后才推进到`verified`。sync 失败时保留 local 值并在下一次迁移尝试中重试；验证成功后才删除这些旧 local 设置。
- 首个页面读取`verified`目录和仍保留的 legacy 显示输入，匹配有效的 date、imageId 和 URL 后原子写入普通上下文 v2 显示状态；无法匹配时写入空显示状态并使用渐变回退图。页面发送`migrationDisplayStateReady`后，普通 Worker fresh-read 显示状态，确认迁移输入已被页面消费，再推进到`complete`并删除 legacy 键；marker 为`verified`时首个有效确认完成交接，之后在`complete`阶段收到的重复或迟到确认都是 no-op。
- 所有运行时读取遵守绝对优先级：只要当前上下文存在通过验证的 v2 目录和显示状态，就永远不回退读取 v1 键，即使 Worker 在删除旧键前被终止。
- 每次普通 Worker 启动都执行轻量收尾：v2 有效但标记未完成时继续验证并推进；标记已完成但旧键仍存在时继续删除，直到 fresh-read 确认旧键消失；v2 部分写入或验证失败时从可用 legacy 数据幂等重建。若已存在部分 v2 目录，必须先 fresh-read 并验证，保留所有有效 v2 条目及字段，只把缺失的 legacy 日期或字段按既有身份与来源优先级合并进去，不得用新的 legacy 导入替换有效 v2 数据；仅无效或冲突的 v2 条目按既有校验规则处理。
- 隐身 Worker 启动不得使用`chrome.storage.local.get(null)`或其他全量扫描来决定迁移状态；只能读取自身 context-suffixed v2 目录、Quote、显示状态和必要的共享 sync 设置。普通迁移标记即使处于`writing`、`verified`或`complete`阶段，也不会阻塞隐身自我播种。
- 每个上下文首次使用 v2 Cache Storage 时，只扫描该上下文当时可见的`funbingbing-wallpaper-cache-v1`，按规范 URL 把命中响应复制到自己的 v2 缓存，再对缺失响应走正常 Worker 下载。此规则不声称 v1 Cache Storage 在普通/隐身上下文间共享。
- 普通上下文完成自己的 v1 cache 复制后删除其可见的 v1 cache；如果 Chrome 的实际实现使该删除也影响隐身上下文，隐身上下文只失去迁移命中优化并按正常流程下载，不影响目录或显示正确性。
- 新目录和显示状态验证成功后，运行时立即改用 v2 键。收尾阶段删除旧`bing_images`、`bing_model_preload_wallpaper_urls`、`cache_quick_facts`、`wallpaper_fetch_lock`、`wallpaper_idx`及其他旧壁纸显示键。
- 如果迁移无法建立有效显示状态，保留内置回退图并由正常刷新获取首张壁纸。

## 代码组织与自动化测试

将纯逻辑放入不在模块加载阶段访问`chrome`、DOM 或 Cache Storage 的独立文件。至少包含：

- `getZhCnTargetDate`
- `getWallpaperContextId`和上下文键名生成
- `normalizeImageId`及 URL 规范化
- 来源覆盖范围验证和按来源重试判断
- 刷新 generation 与过期任务提交判断
- 单调`metadataStage`合并
- Archive `enddate`匹配及 trivia ID 日期改写
- 来源、Trivia、Quote 和图片失败的1、3、5分钟递增退避及重置判断
- 当前、历史、未来及受保护日期的保留集合，以及未来日期升序队列派生
- 单消费者图片调度器的优先级、提升、去重，以及`imagePrefetchGeneration`变化后的`cache.put()`判断
- 旧 generation 活动 fetch 成功写入后重新派生队列时，任务 Map/`cache.match()`双重检查确保同一规范 URL 只发生一次网络请求
- 同 identity/不同 identity 下显示状态的 data URL 保留规则
- 根据显示 date 和实时条目数组推导导航索引
- v2 迁移校验和幂等收尾判断
- 迁移标记使用`wallpaper_migration_v2_state_regular`，并验证 incognito 在 regular 标记为`writing`、`verified`、`complete`时均按 allowlist 自我播种且不读取或修改该标记
- 跨标签页 preview 修复：Tab1 提交带空 preview 的 B，Tab2 在 B 修复通知前导航到 C 并拒绝 B 回调；验证该拒绝不写入 C，且在全局仍为 B 时后续新标签页可从 Cache Storage 修复 B；若 C 已提交，则不得把 B preview 写入 C

使用 Node 内置`node:test`和`assert`，不增加测试依赖。测试文件直接运行，例如：

```powershell
node --test tests/wallpaper-catalog.test.js tests/wallpaper-refresh.test.js
```

纯逻辑模块不得 import 当前`base.js`，因为该文件在顶层访问`chrome.runtime`；如需同时支持浏览器脚本和 Node，沿用现有`globalThis.DEFAULT_SEARCH_ENGINES`式的条件导出模式。

Node 测试覆盖：

- 固定`zh-CN`市场日期在 UTC-8、UTC+8、UTC+10 和日期边界下都由`Asia/Shanghai`确定，且不被用户本地时区或`qotd_url`改变。
- IOTD/Model HTTP 成功但缺少目标日期时保持`missing`，目标日期稍后出现后可自愈；只有`PreloadMediaContents`、没有`MediaContents.Ssd === targetDate`的 Model 响应也必须保持`missing`。
- Archive 在 IOTD 少于8条、八日不连续、最老日期不匹配或身份不匹配时保持`missing`；另测“日期连续且恰有8条，但中间任一条仍为`legacy`、`archive`、`preload`或`media`”也必须保持`missing`。只有8条全部为`iotd`才能进入`success`，窗口或身份变化会再次失效。
- 三个来源的`retryLevel`和`nextRetryAt`互不影响；连续失败依次产生1、3、5分钟退避并在5分钟封顶，联网恢复每个退避窗口最多绕过一次且不重置级别。
- “三个来源成功”只跳过元数据，不阻止缺失 trivia 或图片重试。
- 元数据刷新 Promise 在分来源目录提交后完成，不等待 fake trivia 或按上下文限制的图片队列；新 targetDate 可以在旧图片批次尚未结束时启动新元数据刷新。
- 退避到期只使对应任务在下一次合格事件中可尝试，不唤醒 Worker、不打断活动 fetch；模拟历史退避到期时若未来 fetch 正在运行，必须保持单并发，活动 fetch 结束后的下一次派生优先重试已到期历史任务。
- Trivia 不持久化 pending，连续失败按1、3、5分钟退避并在5分钟封顶；模拟 Worker 中断后仍可从持久化级别在下一次事件驱动刷新机会重试。未来条目暂不取 payload，日期进入目标/历史窗口后会成为候选。Trivia 只能从已提交目录派生且 in-flight Map 只按`triviaId`去重；被拒绝的元数据候选不能启动 Trivia。延迟的成功或失败结果提交前用 date 定位最新条目并要求`triviaId`完全一致：ID 已变化时丢弃且不修改新条目的 payload 或重试状态，ID 未变化时不因 refresh generation 滚动而丢弃。测试不假定退避到期会主动唤醒 Worker。
- `metadataStage`在任意响应顺序下只前进不后退。
- 元数据合并使用表驱动的响应顺序矩阵覆盖 IOTD、MediaContents、PreloadMediaContents 和 Archive；断言每个字段的最终来源、不同身份的整体替换、以及 Archive success 后 IOTD 身份变化会使 Archive 立即回到`missing`。
- Archive trivia ID 覆盖缺失、null、非字符串、空值、合法格式、错误格式、多个日期片段和无效日期；错误格式清空为 missing、记录诊断且不得启动 Trivia。
- 迁移 URL 使用固定 origin，缓存键与旧 URL 完全一致。
- Model 样本的`_1920x1080.webp`能结构化规范为`_1920x1080.jpg`，并与同一`imageId`次日 IOTD 生成的 HD 键完全一致；preview 和 UHD 后缀同样稳定。包含多个下划线的完整 identity 不能被截断，未知末尾尺寸必须拒绝而不是猜测替换。
- 普通/隐身上下文生成不同的目录、显示、Quote 和缓存名称。
- `ensureWallpaperCached`拒绝非法日期、分辨率和非目录 URL，并与预取共享去重和退避状态。活动任务不可抢断；紧急新 URL 插到待处理队首；同一 URL 已排队时只提升原任务；同一 URL 已活动时复用 Promise；全部场景中每个上下文的最大图片 fetch 并发仍为1。
- 导航在0至8个条目及日期滚动后始终由 date 正确定位；0条时按钮禁用且命令 no-op。
- Bing 内容日期只按字符串格式化为`YYYY/MM/DD`，在不同时区下结果不变；本地时钟行为不受影响。
- 目标任务之后先排列历史 preview 和历史最终分辨率，再排列未来 preview 和未来最终分辨率；每一阶段都按日期从近到远排序。少于7个有效历史或未来条目时相应阶段缩短。
- 模拟历史与未来全冷缓存时，所有请求严格串行且每个上下文最大并发为1；任何未来请求都不得早于尚未完成缓存检查或下载尝试的历史补齐任务。单项失败后继续同阶段后续任务，模拟 Worker 中断后重新派生队列只返回缺失项。
- 目标日期最终图片下载失败只推进自身退避级别，不阻止历史补齐；历史或未来单项失败也不阻止同阶段后续任务及最终的未来队列。
- 模拟稳定窗口向前滚动一天时6个日期的12个键命中，只有新第7日的 preview 和最终分辨率需要网络；图片身份改变或 HD/UHD 设置变化时只返回真正失效的键。
- image generation 变化时旧队列不再派发；活动响应返回后，URL 仍属于最新目录/显示保留集合时可以写入，不再需要时必须丢弃。持久化 refresh generation 在 Worker 重启后保持，内存 image generation 则重新建立。
- 普通上下文基础保留集合最多30键，额外显示保护后最多32键；隐身上下文对应为18键和20键；HD/UHD fixture 字节数只记录，不设置32 MiB断言，并明确区分32个键与32 MiB。
- `cachedFutureDepth`只计算从目标日期开始连续且 preview 与当前最终分辨率都命中的未来日期；不连续命中、preview-only 命中和过期诊断值都不能作为跳过预取的依据。
- Quote 租约固定60秒并由`crypto.randomUUID()`生成 token；成功同步立即清除，过期或被替换的 token 不能提交或延长新租约。
- Quote 纯逻辑测试注入确定性的`generateToken`；拒绝授予租约时不得调用生成器，浏览器实现由 Worker/runtime adapter 调用`globalThis.crypto.randomUUID()`，共享模块不得强制导入`node:crypto`。
- 旧 refresh generation 晚到时只能补同一`date + imageId`或新增非显示日期，不能替换已有身份；显示 date 身份冲突必须丢弃整个候选且不合并任何字段，同时允许批次中的其他有效候选提交。旧轮次不能改变新 refreshState，失败也不能污染新轮次来源状态。
- 迁移在新状态写入、验证或旧键删除任一步骤中断后都可继续；有效 v2 存在时所有读取拒绝回退到残留 v1。
- 迁移若发现部分 v2 目录，必须保留有效 v2 条目和字段，只合并缺失的 legacy 日期或字段；重复运行不得降级、替换或产生重复日期。`migrationDisplayStateReady`在`verified`阶段只由首个有效确认推进，`complete`阶段的重复或迟到确认必须 no-op。
- 共享设置迁移在已有有效 sync 值、只有有效 local 值、两者都缺失、sync 写入失败和 Worker 重启场景下都保持幂等；sync 验证前不得删除 local 值或把迁移推进到`verified`。
- 显示最终图片但 preview 缺失时，同 imageId 保留旧 data URL，不同 imageId 清空；后续只在 generation、date 和 imageId 一致时更新。迁移不复制无法验证身份的旧 data URL。
- 显示状态带空`preloadDataUrl`且对应最终图片与 preview 已缓存时，新标签页必须立即显示缓存最终图片，并在不依赖旧缓存通知的情况下重建 preview data URL；模拟重建前页面崩溃或原页面 generation 改变，下一次新标签页仍会重试。修复写入前若全局`date + imageId + url`已变化则丢弃结果。
- 网络恢复测试覆盖浏览器`online`事件与现有15秒实际连接检查，两者对同一 retry object 只允许一次 bypass；另验证三个元数据来源的并行启动上限和图片单消费者的串行上限。
- HD/UHD 快速切换测试确认活动旧分辨率 fetch 不被取消，未被最新保留集合引用的响应不会计为成功；切换期间可短暂存在未引用旧键，但新未来批次开始前清理完成后恢复32/20键稳定上限。
- `cachedFutureDepth`跨 Worker 重启保留最近观测值但不影响 cache.match、重试或预取；目录根、条目和显示状态的`updatedAt`分别验证成功更新、失败保持和不参与冲突裁决。
- 重复及迟到的`migrationDisplayStateReady`确认只产生一次完成/清理效果；部分 v2 目录重启测试保留已有条目并只补缺失 legacy 数据。
- Worker 在图片 fetch 未完成时终止的测试确认中断请求不产生 Cache Storage 成功，下一事件从缺失 URL 重试，且跨终止边界没有同 URL 并发请求。

## Chrome 与 Playwright 验收

- 在同一`targetDate`且三个元数据来源均已满足各自覆盖条件并记录为`success`时，重复打开新标签页的 Bing 元数据请求数为0；仅图片缓存命中不抑制尚未成功来源的正常重试。
- 返回200但缺少目标日期的 IOTD/Model 响应不会锁死；目标日期稍后出现后自动更新。
- Archive 仅在完整连续8条 IOTD 窗口下使用`enddate`补足第8天，并正确改写 SantaCatalina trivia ID；部分窗口不会误记成功。
- 某一来源晚失败不会延长其他来源的重试时间；网络每15秒抖动不会造成绕过风暴。
- 网络恢复由`online`事件或现有15秒实际连接检查触发；同一退避窗口只绕过一次，退避到期本身不唤醒 Worker，且三来源并行与图片串行的请求上限保持不变。
- Trivia 请求失败和 Worker 在请求中被终止后，退避到期后的下一次新标签页、启动、联网恢复或目录刷新可再次请求并恢复 quiz。
- Worker 在某个 API 结果提交后或目录提交与图片缓存之间重启，已完成结果不丢失，只补齐缺失工作。
- Worker 在目标、历史或未来图片 fetch 仍未完成时终止，下一次事件只补齐未缓存 URL；中断尝试不写入成功缓存，也不与重试重叠。
- 日期变化期间旧 API 响应晚到时，只能补充相同身份；试图改变当前显示日期或已有历史日期身份的候选被跳过，不回写新日期来源状态或触发旧目标图片预取。
- 首次获得未来条目时，当前图片完成后先补齐所有缺失的可导航历史图片；普通上下文再从最近未来日期开始逐张下载最多7个 preview 和最终分辨率，隐身上下文只下载第1个未来日期的这两个响应；网络面板中每个上下文的背景图片最大并发为1，页面可正常交互且不等待后台批次。
- 未来或历史下载活动期间导航到未缓存日期时，当前 fetch 正常结束，导航最终分辨率成为下一任务；其余未开始任务后移，整个过程没有第二个并发图片请求。若同 URL 已活动或排队，只附着或提升原任务。
- 稳定窗口次日滚动时，普通上下文旧未来日期的 preview 和最终图片命中 Cache Storage，只请求新加入最远日期的2个响应；隐身上下文只维持下一未来日期并同样最多请求2个响应；若 Bing 修改已知未来身份，额外请求仅限发生变化的日期。
- 关闭浏览器后在对应未来窗口内离线重开，日期等于`targetDate`的临时条目从缓存立即显示。超过普通7日或隐身1日窗口且目录/缓存没有当前 targetDate 时，继续显示并保护最后一次实际显示的壁纸，不把任意旧缓存冒充当前图片；当前 IOTD 最终图片完成后再切换，随后先补齐可导航历史缺失图片，再按上下文限制串行补齐未来图片。
- 在未来批次中途终止 Worker，下一次新标签页只补缺失图片；单张失败不会阻塞后续日期，退避到期后的下一次事件可以补齐。
- 模拟浏览器清理某个未来 Cache Storage 响应后，目录存在不能被当作缓存命中；下一次事件只补该缺失键，离线时继续使用仍命中的 preview、当前壁纸或内置回退图。
- 连续模拟配额清理多个 future 键时，有效离线窗口随实际命中缩短但目录不损坏；测试不宣称能在自动化中稳定触发 Chrome 的真实磁盘压力淘汰，也不把重新下载当作 pin 保证。
- Quote HTML 仍由页面解析，使用目录日期同步；慢 Quote 请求不延迟壁纸显示，远程回退仍有效。
- 新标签页初始化且只有匹配 preview 时立即显示该 preview，最终分辨率完成后只切换一次；手动导航即使目标 preview 已缓存也继续显示原最终壁纸和`Wallpaper is updating...`，不渲染目标 preview。
- Preview 被清理或缺失时，同一 imageId 可以保留旧 data URL；imageId 已变化时必须清空并显示内置回退图，不能先画旧图再切新图。补齐后只有 generation、date、imageId 全匹配才更新 data URL。
- 首次安装在线时立即显示内置回退图直到最终图片完成；首次安装离线时仍显示内置回退图。
- 手动导航期间的刷新不会切回目标日期；0条时导航禁用，少于8个条目和日期滚动不会产生索引错位。
- 设置 UHD 后先请求当前缺失的最终分辨率，再串行补齐历史日期的 UHD，最后按上下文限制补齐未来日期的 UHD；普通上下文最多7日，隐身上下文最多1日。不重复下载 preview 或元数据，旧 HD 在失去引用后清理。快速切换并导航时允许任务重排，但相同 URL 不重复排队、每个上下文最大图片并发保持1，最终只保留最新配置和显示状态需要的键。切回 HD 时行为对称。
- 没有页面监听时，目录和图片通知不会产生未处理 Promise rejection。
- 在允许隐身运行的 Chrome 中同时打开普通和隐身新标签页，确认目录、显示状态、Quote 状态、缓存命中和清理互不覆盖。
- 从 v1 local 设置升级后，确认有效值迁移到 sync、已有有效 sync 值不被覆盖、sync 写入失败时 local 值仍保留；普通窗口修改 UHD 或 Quote 设置后，隐身上下文读取同一 sync 值并触发相应配置更新。
- Tab1 从 A 导航到 B 时，在 B 最终图片应用前打开 Tab2，确认 Tab2 可以从已提交状态初始化为 A 且不必随后自动切换；Tab1 提交 B 后再打开的新标签页以 B 的同一`date + imageId + url`初始化，并且只允许短暂显示 B 的匹配 preview。并发写入仍保持每个快照字段一致，last-write-wins 只决定后续读取者的起点，不要求已打开标签页实时收敛。
- 从旧版本升级时，当前上下文能以相同 URL 命中其可见的旧缓存；迁移在新状态写入或旧键删除时中断，重启后仍使用 v2 并完成收尾。
- 普通上下文最终目录最多15条（目标日期、过去7天、未来7天），隐身上下文最多9条（目标日期、过去7天、未来1天）；Cache Storage 最多分别为32和20个有效键；分别记录 HD 和 UHD 场景总字节数，但不以32 MiB作为通过条件。

## 实施顺序

1. 新增纯日期、上下文、URL、合并、重试和保留集合 helper，并先让 Node 测试通过。
2. 在 Worker 中实现上下文目录、分来源刷新、单消费者图片优先级调度器、trivia/图片重试、通知和迁移；用单元测试及 Worker 重启场景验证没有永久抑制状态，每个上下文的所有图片任务最大并发为1。
3. 将页面改为目录和 Cache Storage 只读消费者，加入统一显示状态、实时日期导航和内置回退图；验证 warm/cold/offline 首屏。
4. 拆出非阻塞 Quote 抓取与租约流程，并迁移 quick links、设置页、离线检测等调用方。
5. 在安装后的 MV3 扩展中完成普通/隐身并发、网络时序、图片任务提升与串行性、配额清理模拟、缓存键数和 HD/UHD 字节用量记录。
</proposed_plan>
