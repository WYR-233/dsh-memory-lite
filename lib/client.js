// dsh-memory-lite — client half: settings page ("Memory library"): overview / health / toggles.
// Zero build, hand-written React, same wiring as other DSH client plugins:
//   window.__ModuleLoader__.load({ id, factory(require) })  →  exports.apply / exports.inject
// Bilingual (follows the browser language) and free of any project-specific wording.
window.__ModuleLoader__.load({ id: "dsh-memory-lite", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const React = require("react");
const h = React.createElement;

const NS = "memory-lite";
const API = "/" + NS;

// ---------------- my icon (shared by the page header and the settings nav) ----------------
// 手绘矢量，与 dsh-whale-guard / dsh-memory-lite / dsh-multi-tts 成套（设计稿来自千问）。
// 以字符串形式内联：浏览器侧模块表只认 React，不能 import 另一个文件。
const ICON_D = [
    'M4.6 5.2C7 3.9 9.6 3.9 12 5.9c2.4-2 5-2 7.4-.7v12.4c-2.4-1.3-5-1.3-7.4.7-2.4-2-5-2-7.4-.7z',
    'M12 5.9v12.4',
    'M5.5 17.6c2.2-1.1 4.5-1.1 6.5.7',
    'M18.5 17.6c-2.2-1.1-4.5-1.1-6.5.7',
    'M14.6 3.4h5.2v6.4h-3.4l-1.8 1.6v-1.6h0z',
]
const NAV_MARK = 'data-whale-icon'

/**
 * 渲染本插件图标。
 * @param {{size?: number, className?: string, strokeWidth?: number}} [props] 参数
 * @returns {object} React 元素
 */
function Icon(props) {
  const size = (props && props.size) || 16
  const sw = (props && props.strokeWidth) || 1.7
  return h('svg', {
    viewBox: '0 0 24 24', width: size, height: size,
    className: props && props.className, [NAV_MARK]: '1',
    fill: 'none', stroke: 'currentColor', 'stroke-width': sw,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, ICON_D.map((d, i) => h('path', { key: i, d: d })))
}

// 让图标与文字并排的小容器
const iconRow = { display: 'inline-flex', alignItems: 'center', gap: 6 };

/**
 * 把设置导航里本插件那一行的默认齿轮换成自己的图标。
 *
 * DSH 的 navIcon(id) 是写死的表，未登记的 section 一律回退齿轮，而 settings.section
 * 的注册只接受 id/order/label —— 没有图标位。所以只在「自己那一行」替换图标节点：
 * 幂等、不动他人 DOM；React 重渲染会把它换回来，故用 MutationObserver 持续纠偏。
 */
function installNavIcon() {
  if (typeof document === 'undefined') return
  const applyIcon = () => {
    const btns = document.querySelectorAll('button')
    for (const btn of btns) {
      const txt = (btn.textContent || '').trim()
      if (txt !== '记忆库' && txt !== 'Memory library') continue
      const old = btn.querySelector('svg')
      if (!old) continue
      if (old.hasAttribute(NAV_MARK)) return
      const span = document.createElement('span')
      span.style.display = 'inline-flex'
      span.style.flex = 'none'
      span.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" '
        + 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" '
        + NAV_MARK + '="1" class="' + (old.getAttribute('class') || '') + '">'
        + ICON_D.map((d) => '<path d="' + d + '"/>').join('') + '</svg>'
      old.replaceWith(span)
      return
    }
  }
  applyIcon()
  if (typeof MutationObserver !== 'undefined' && document.body) {
    let last = 0
    new MutationObserver(() => {
      const now = Date.now()
      if (now - last < 100) return
      last = now
      applyIcon()
    }).observe(document.body, { childList: true, subtree: true })
  }
}

// ---------------- i18n (zh / en) ----------------
const TEXT = {
  zh: {
    title: "📚 记忆库治理仪表盘",
    refresh: "↻ 刷新数据",
    cards: "卡片", cardUnit: "张",
    size: "正文体量", sizeUnit: (chars, tok) => chars + " 字符（≈ " + tok + " token 全读）",
    topics: "主题", topicsUnit: "个",
    updated: "最近更新",
    longest: "最长卡片",
    root: "记忆库路径",
    // 告警条
    alertTax: (pct, used, budget) => "⚠ 开场税超预算：" + used + " / " + budget + " 字符（" + pct + "%）",
    alertOversize: (n, lines, kb) => "⚠ " + n + " 张超长卡（>" + lines + " 行或 >" + kb + "KB）该拆压了",
    alertDue: (days, recent) => "📌 该做一轮巩固了：距上次 " + days + " 天、已改动 " + recent + " 张",
    alertDirty: (n) => "📝 记忆库有 " + n + " 个未提交改动（守卫会自动提交）",
    allGood: "✅ 各项指标正常（税在预算内、无超长卡、暂不需要巩固）",
    // ① 开场税
    taxTitle: "① 开场税（核心健康度）",
    taxUsed: "常读文件合计",
    taxBudget: "预算",
    taxRemaining: "余量",
    taxPct: "占比",
    taxTokens: "≈ token",
    taxTrend: "趋势（7 天前 → 现在）",
    taxTrendNone: "还没有一周前的快照，攒够就显示",
    taxTrendLine: (prev, now, delta) => prev + " → " + now + " 字符（" + (delta >= 0 ? "+" : "") + delta + "）",
    // ② 规模与趋势
    scaleTitle: "② 规模与趋势",
    scaleTokens: "正文 token 量级",
    todayNew: "今日新增/改动",
    dist: "各主题卡数",
    distMore: (n) => "还有 " + n + " 个主题未列出",
    // ③ 分层健康
    layersTitle: "③ 分层健康",
    warm: "温层卡片（memory/）",
    cold: "冷区（archive/，不进检索）",
    oversize: "超长卡（>60 行或 >8KB）",
    oversizeTop: "最长的几张",
    over50: "单主题超 50 张（红线）",
    over50None: "无",
    dupTitles: "标题重复",
    none: "无",
    // ④ 巩固
    upkeepTitle: "④ 巩固状态",
    upkeepLast: "上次巩固",
    upkeepNever: "从未巩固过",
    upkeepDays: "距今天数",
    upkeepRecent: "自上次改动卡数",
    upkeepDue: "📌 该做一轮巩固了",
    upkeepIdle: "暂不需要（静默期不打扰）",
    upkeepHint: "活跃度触发：>天数阈值且改动 ≥ 卡数阈值，或 > 保底天数；也可以直接让我跑一轮巩固。",
    // ⑤ 守卫与备份
    guardTitle: "⑤ 守卫与备份",
    gitDirty: "未提交改动",
    gitClean: "干净（无未提交）",
    gitLast: "最后提交",
    guardAt: "守卫上次运行",
    guardNone: "还没读到守卫日志",
    backupLast: "最新备份",
    backupCount: "备份份数",
    // ⑥ 工具
    toolsTitle: "⑥ 检索与工具",
    toolScript: "memory-find 脚本",
    toolIndex: "INDEX 索引行数",
    toolSyn: "同义词组数",
    toolInject: "开场注入",
    okShort: "可用",
    badShort: "不可用",
    // 控件
    slidersTitle: "⚙ 阈值与预算（滑块 + 数字）",
    sInject: "摘要预算", sInjectUnit: "字符", sInjectHint: "开场注入的记忆库摘要长度上限",
    sTopN: "检索条数", sTopNUnit: "张", sTopNHint: "memory_find 每次返回的卡片数",
    sTax: "开场税预算", sTaxUnit: "字符", sTaxHint: "开场税进度条的基准，超了就告警",
    sDays: "巩固-天数阈值", sDaysUnit: "天", sDaysHint: "距上次巩固超过它、且改动够多就提醒",
    sCards: "巩固-卡数阈值", sCardsUnit: "张", sCardsHint: "配套天数阈值：改动卡数达标才提醒",
    sHard: "巩固-保底天数", sHardUnit: "天", sHardHint: "无论改动多少，超过它一律提醒",
    togglesTitle: "⚙ 开关",
    injectOn: "开场注入记忆库摘要",
    toolOn: "启用 memory_find 工具（关闭后无法检索记忆库）",
    // 按钮
    actionsTitle: "🛠 一键操作",
    bCheckup: "🏥 立即体检", bBackup: "💾 立即备份", bScan: "🧹 治理扫描",
    bNewChat: "🌙 开新对话 + 复制提示词", bSearch: "🔍 面板内搜索", bSite: "🗂 打开记忆库网页",
    running: "运行中…",
    doneIn: (ms) => "完成（" + (ms / 1000).toFixed(1) + "s）",
    failed: "失败",
    scanTitle: "治理扫描结果",
    scanCand: "可降级候选（已收官 + 超过保底天数无更新）",
    scanOversize: "超长卡",
    scanDup: "标题重复",
    scanOver50: "单主题超 50 张",
    candUnit: (days) => days + " 天没动",
    // 提示词
    promptLabel: "复制提示词",
    promptPickHint: "选一套现成措辞，复制后粘进新对话即可开工",
    prompts: {
      govern: "【记忆库治理】请对记忆库做一轮治理：1) 先读常读文件与索引；2) 用 memory-find 定位超长卡、标题重复与可下沉的旧卡；3) 按你记忆库的规则拆压/合并，结论留原地、原文移 archive；4) 更新索引与进度卡；5) 写一张治理小结卡并提交。",
      consolidate: "【巩固一轮】请做一轮记忆库巩固：读自上次巩固以来改动过的卡片 → 压成一张结论卡 → 已收官项目退场到结项总账 → 更新索引与进度卡 → 提交。",
      checkup: "【体检一轮】请检查记忆库健康度：常读文件字符是否超预算、有无超长卡（>60 行或 >8KB）、单主题是否超 50 张、标题重复与死链；只给问题清单 + 修复建议，先不要动手改。",
      cleanup: "【清理冷区】请盘点 archive 冷区与已收官项目：列出「可下沉/可删除」清单（源 → 目标 + 理由），等我确认后再执行。",
    },
    promptCopied: "已复制 ✓（开新对话后粘贴一次即可）",
    // 搜索
    searchPh: "输入 2-4 个关键词（如：插件 崩溃）",
    searchRun: "搜索记忆库",
    searchNone: "没命中，换个词试试",
    searchHits: (n) => "命中 " + n + " 张卡",
    copied: "已复制 ✓",
    libTitle: "🔗 记忆库位置",
    libPath: "当前路径",
    libChange: "换目录 / 新建库",
    libChangeHide: "收起",
    setupTitle: "🚀 先给记忆库安个家",
    setupIntro: "这个插件把结论、决定、踩过的坑存成普通 markdown 卡片，让你和 agent 都记得住。选一个文件夹就能开工，大约 10 秒。",
    setupPick: "选择已有文件夹…",
    setupUse: "就用这个文件夹",
    setupCreate: "一键建一个新库",
    setupAgent: "交给 agent 初始化",
    setupAgentHint: "「交给 agent 初始化」会复制一段提示词并开一个新对话，让 agent 按你的习惯把库搭起来（推荐用 DSH 自带的「创造模式」预设）。",
    setupDefaultHint: (p) => "默认位置：" + p,
    setupFoundLibrary: "这个文件夹已经是一个记忆库 ✓",
    setupFoundDir: "文件夹可用，但还没有索引文件（可以直接用，或让插件补骨架）",
    setupDirMissing: "这个文件夹还不存在：点「一键建一个新库」来创建它",
    setupOtherPlatform: "⚠ 这看起来是另一台机器的路径，请选择本机路径",
    setupPickUnsupported: "当前环境拿不到系统目录选择器：请手动把路径填进插件的 memoryRoot 配置",
    setupPickFailed: "目录选择失败，请重试或手动填路径",
    setupCreated: (n) => "已建好 ✓（新建 " + n + " 个文件）",
    setupExists: "已接入 ✓（检测到已经是记忆库，未改动任何文件）",
    setupFailed: "操作失败，请重试",
    setupAgentPrompt: "【初始化记忆库】我刚装好「记忆库」插件，请帮我初始化：1) 先读库里的 INDEX.md 和使用说明；2) 问我几个问题（这个库主要记什么、想按哪些主题分文件夹）；3) 按我的回答在 memory/ 下建好主题目录，并更新 INDEX.md 的表格；4) 把这次对话里值得留的结论写成第一张卡（含日期/背景/结论/关键词）；5) 告诉我以后怎么让你「记进记忆库」。",
    bannerText: "记忆库还没设置好：选个文件夹或一键建库，agent 就能开始记东西了",
    bannerCreate: "一键建库",
    bannerOpen: "去设置",
    bannerHide: "先不管",
    cardTitle: "记忆库（memory-library）",
    cardDesc: "把你的结论、决定和踩过的坑存成普通 markdown 卡片；agent 开场读索引、回答前先检索，跨对话不失忆。",
    cardStatus: "状态",
    cardReady: "已就绪",
    cardNotReady: "还没选库文件夹",
    bSiteLabel: "记忆库",
    cardOpen: "打开记忆库设置",
    cardHow: "用法：设置里选好目录后，直接跟 agent 说「记进记忆库」；也可以在输入框打 /memory 命令。",
    foot: "开关与阈值即时生效；运行时配置 = ",
    notConfigured: "尚未配置记忆库路径：请在插件配置里设置 memoryRoot（或环境变量 DSH_MEMORY_ROOT）",
    errStats: "取不到数据（host 端路由未就绪？）",
  },
  en: {
    title: "📚 Memory governance dashboard",
    refresh: "↻ Refresh",
    cards: "Cards", cardUnit: "",
    size: "Body size", sizeUnit: (chars, tok) => chars + " chars (≈ " + tok + " tokens if read whole)",
    topics: "Topics", topicsUnit: "",
    updated: "Last updated",
    longest: "Longest card",
    root: "Library path",
    alertTax: (pct, used, budget) => "⚠ Opening tax over budget: " + used + " / " + budget + " chars (" + pct + "%)",
    alertOversize: (n, lines, kb) => "⚠ " + n + " oversized card(s) (>" + lines + " lines or >" + kb + "KB) need splitting",
    alertDue: (days, recent) => "📌 Consolidation due: " + days + " days, " + recent + " cards changed",
    alertDirty: (n) => "📝 " + n + " uncommitted change(s) in the library (the guard commits automatically)",
    allGood: "✅ All good (tax within budget, no oversized cards, no consolidation due)",
    taxTitle: "① Opening tax",
    taxUsed: "Always-read files", taxBudget: "Budget", taxRemaining: "Remaining", taxPct: "Used", taxTokens: "≈ tokens",
    taxTrend: "Trend (7 days ago → now)",
    taxTrendNone: "No week-old snapshot yet — it appears once one is stored",
    taxTrendLine: (prev, now, delta) => prev + " → " + now + " chars (" + (delta >= 0 ? "+" : "") + delta + ")",
    scaleTitle: "② Scale & trend",
    scaleTokens: "Body tokens", todayNew: "Changed today", dist: "Cards per topic", distMore: (n) => "+" + n + " more topics",
    layersTitle: "③ Layer health",
    warm: "Warm cards (memory/)", cold: "Cold area (archive/, not searched)",
    oversize: "Oversized cards (>60 lines or >8KB)", oversizeTop: "Longest ones",
    over50: "Topic over 50 cards (red line)", over50None: "none", dupTitles: "Duplicate titles", none: "none",
    upkeepTitle: "④ Consolidation",
    upkeepLast: "Last consolidation", upkeepNever: "Never consolidated", upkeepDays: "Days since", upkeepRecent: "Cards changed since",
    upkeepDue: "📌 Due for a consolidation pass", upkeepIdle: "Not needed yet (quiet period)",
    upkeepHint: "Activity trigger: > days threshold with ≥ card threshold changed, or > hard-days floor.",
    guardTitle: "⑤ Guard & backup",
    gitDirty: "Uncommitted", gitClean: "Clean (nothing pending)", gitLast: "Last commit",
    guardAt: "Guard last run", guardNone: "No guard log read yet", backupLast: "Latest backup", backupCount: "Backups kept",
    toolsTitle: "⑥ Search & tools",
    toolScript: "memory-find script", toolIndex: "INDEX rows", toolSyn: "Synonym groups", toolInject: "Start digest",
    okShort: "ready", badShort: "missing",
    slidersTitle: "⚙ Thresholds & budgets (slider + number)",
    sInject: "Digest budget", sInjectUnit: "chars", sInjectHint: "Max length of the injected memory digest",
    sTopN: "Search results", sTopNUnit: "cards", sTopNHint: "Cards returned per memory_find call",
    sTax: "Opening-tax budget", sTaxUnit: "chars", sTaxHint: "Baseline for the tax bar; exceeding it raises an alert",
    sDays: "Consolidation: days", sDaysUnit: "days", sDaysHint: "Remind when this many days passed and enough cards changed",
    sCards: "Consolidation: cards", sCardsUnit: "cards", sCardsHint: "Companion of the days threshold",
    sHard: "Consolidation: floor", sHardUnit: "days", sHardHint: "Always remind after this many days",
    togglesTitle: "⚙ Toggles",
    injectOn: "Inject the memory digest at start", toolOn: "Enable the memory_find tool",
    actionsTitle: "🛠 One-click actions",
    bCheckup: "🏥 Run checkup", bBackup: "💾 Back up now", bScan: "🧹 Governance scan",
    bNewChat: "🌙 New chat + copy prompt", bSearch: "🔍 Search here", bSite: "🗂 Open memory site",
    running: "Running…", doneIn: (ms) => "done (" + (ms / 1000).toFixed(1) + "s)", failed: "failed",
    scanTitle: "Governance scan",
    scanCand: "Demote candidates (finished + untouched beyond the floor)",
    scanOversize: "Oversized", scanDup: "Duplicate titles", scanOver50: "Topics over 50 cards",
    candUnit: (days) => days + " days idle",
    promptLabel: "Copy prompt", promptPickHint: "Pick a ready-made wording, copy it into a new chat",
    prompts: {
      govern: "[Memory governance] Run a governance pass: read the always-read files and the index, find oversized/duplicate/demotable cards with memory-find, split or merge per your memory rules (keep conclusions, move originals to archive), refresh the index and the progress card, then write one summary card and commit.",
      consolidate: "[Consolidate] Run one consolidation pass: read the cards changed since the last pass → write ONE conclusion card → retire finished projects → refresh the index and the progress card → commit.",
      checkup: "[Checkup] Inspect library health: core-file tax vs budget, oversized cards (>60 lines or >8KB), topics over 50 cards, duplicate titles, dead links. Report findings and fixes only — do not change anything yet.",
      cleanup: "[Cold area] Inventory the archive area and finished projects: list what can be demoted or deleted (source → target + reason) and wait for my confirmation.",
    },
    promptCopied: "Copied ✓ (paste once in the new chat)",
    searchPh: "2-4 keywords (e.g. plugin crash)",
    searchRun: "Search library",
    searchNone: "No hits — try other words",
    searchHits: (n) => n + " card(s) matched",
    copied: "Copied ✓",
    libTitle: "🔗 Library location",
    libPath: "Current path",
    libChange: "Change folder / new library",
    libChangeHide: "Collapse",
    setupTitle: "🚀 Give your memory a home first",
    setupIntro: "This plugin keeps conclusions, decisions and gotchas as plain markdown cards so both you and your agent remember them. Picking a folder takes about ten seconds.",
    setupPick: "Choose an existing folder…",
    setupUse: "Use this folder",
    setupCreate: "Create a new library",
    setupAgent: "Let an agent initialise it",
    setupAgentHint: "\"Let an agent initialise it\" copies a prompt and opens a new chat, so the agent can shape the library around your habits (the built-in Creation preset works well).",
    setupDefaultHint: (p) => "Default location: " + p,
    setupFoundLibrary: "This folder already looks like a memory library ✓",
    setupFoundDir: "Folder is usable, but it has no index file yet (you can use it as is, or let the plugin add the scaffold)",
    setupDirMissing: "This folder does not exist yet — use \"Create a new library\" to make it",
    setupOtherPlatform: "⚠ This looks like a path from another machine — please pick a local one",
    setupPickUnsupported: "No system directory picker here: set the plugin's memoryRoot option manually instead",
    setupPickFailed: "Folder picking failed — retry or set the path manually",
    setupCreated: (n) => "Created ✓ (" + n + " file(s))",
    setupExists: "Attached ✓ (already a library — nothing was overwritten)",
    setupFailed: "That did not work — please retry",
    setupAgentPrompt: "[Initialise my memory library] I just installed the memory-library plugin. Please: 1) read INDEX.md and the usage note in the library; 2) ask me what I want to remember and which topics I want; 3) create the topic folders under memory/ and update INDEX.md; 4) write the first card from this conversation (date / context / conclusion / keywords); 5) tell me how to ask you to remember things later.",
    bannerText: "Memory library is not set up yet — pick a folder (or create one in one click) and your agent can start remembering",
    bannerCreate: "Create library",
    bannerOpen: "Open settings",
    bannerHide: "Later",
    cardTitle: "Memory library",
    cardDesc: "Keeps your conclusions, decisions and gotchas as plain markdown cards; the agent reads the index at start and searches before guessing, so nothing is forgotten between chats.",
    cardStatus: "Status",
    cardReady: "Ready",
    cardNotReady: "No library folder yet",
    bSiteLabel: "Memory library",
    cardOpen: "Open memory-library settings",
    cardHow: "How to use: pick a folder in settings, then just tell your agent \"remember this\"; or type the /memory command in the composer.",
    foot: "Toggles and thresholds apply immediately; runtime config = ",
    notConfigured: "Memory library path is not configured: set the plugin option memoryRoot (or the DSH_MEMORY_ROOT env var).",
    errStats: "Cannot read data (host route not ready?)",
  },
};

function fmtNum(n) { return typeof n === "number" ? n.toLocaleString() : "-"; }
function fmtTime(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    const p = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  } catch (_) { return "-"; }
}
const approxTokens = (chars) => (chars > 0 ? Math.round(chars / 3.2) : 0);

function Card(props) {
  return h("div", {
    style: Object.assign({
      border: "1px solid var(--dsh-border, rgba(127,127,127,.28))",
      borderRadius: 10, padding: "12px 14px", marginBottom: 10,
      background: "var(--dsh-surface, rgba(127,127,127,.06))",
    }, props.style || {}),
  }, props.children);
}
function Row(props) {
  return h("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", alignItems: "baseline" } },
    h("span", { style: { opacity: .75, flex: "0 0 auto" } }, props.label),
    h("span", { style: { fontWeight: 600, textAlign: "right", wordBreak: "break-all" } }, props.value));
}
function Toggle(props) {
  return h("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0" } },
    h("input", {
      type: "checkbox", checked: !!props.checked, disabled: !!props.disabled,
      onChange: (e) => props.onChange(e.target.checked),
      style: { width: 16, height: 16, cursor: "pointer" },
    }),
    h("span", null, props.label));
}
function CopyButton(props) {
  const [done, setDone] = React.useState(false);
  return h("button", {
    onClick: () => {
      try { navigator.clipboard.writeText(props.text); setDone(true); setTimeout(() => setDone(false), 1200); } catch (_) { }
    },
    style: {
      padding: "4px 10px", borderRadius: 6, cursor: "pointer",
      border: "1px solid var(--dsh-border, rgba(127,127,127,.35))",
      background: "transparent", color: "inherit", fontSize: 12,
    },
  }, done ? props.copiedLabel : props.label);
}

function Bar(props) {
  const pct = Math.max(0, Math.min(100, Number(props.pct) || 0));
  return h("div", { style: { height: 8, borderRadius: 4, background: "rgba(127,127,127,.18)", overflow: "hidden", margin: "6px 0" } },
    h("div", {
      style: {
        width: pct + "%", height: "100%", transition: "width .2s",
        background: props.over ? "#e2584f" : (props.color || "var(--dsw-alias-brand-primary-new-color, #4a9a8a)"),
      },
    }));
}

// 滑块 + 数字双联（主人点名：滑块必须配数字输入）
function Slider(props) {
  const [v, setV] = React.useState(Number(props.value));
  React.useEffect(() => { setV(Number(props.value)); }, [props.value]);
  const commit = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) { setV(Number(props.value)); return; }
    props.onCommit(Math.min(props.max, Math.max(props.min, Math.round(num))));
  };
  const numStyle = {
    width: 84, padding: "3px 6px", borderRadius: 6, fontSize: 13, textAlign: "right",
    border: "1px solid var(--dsh-border, rgba(127,127,127,.35))", background: "transparent", color: "inherit",
  };
  return h("div", { style: { padding: "7px 0", borderBottom: "1px dashed rgba(127,127,127,.18)" } },
    h("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
      h("span", { style: { opacity: .78, flex: "1 1 150px", minWidth: 130 } }, props.label),
      h("input", {
        type: "range", min: props.min, max: props.max, step: props.step, value: v,
        onChange: (e) => setV(Number(e.target.value)),
        onMouseUp: (e) => commit(e.target.value), onTouchEnd: (e) => commit(e.target.value),
        onKeyUp: (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") commit(e.target.value); },
        style: { flex: "0 0 168px", cursor: "pointer" },
      }),
      h("input", {
        type: "number", min: props.min, max: props.max, step: props.step, value: v,
        onChange: (e) => setV(Number(e.target.value)),
        onBlur: (e) => commit(e.target.value),
        onKeyDown: (e) => { if (e.key === "Enter") commit(e.target.value); },
        style: numStyle,
      }),
      h("span", { style: { opacity: .6, fontSize: 12, minWidth: 30 } }, props.unit || "")),
    props.hint ? h("div", { style: { opacity: .55, fontSize: 12, marginTop: 3 } }, props.hint) : null);
}

function ActionButton(props) {
  return h("button", {
    onClick: props.disabled ? undefined : props.onClick,
    disabled: !!props.disabled,
    style: {
      padding: "7px 12px", borderRadius: 8, fontSize: 13, color: "inherit",
      cursor: props.disabled ? "default" : "pointer", opacity: props.disabled ? .55 : 1,
      border: "1px solid var(--dsh-border, rgba(127,127,127,.35))",
      background: props.primary ? "var(--dsw-alias-brand-primary-new-color, rgba(90,140,190,.16))" : "transparent",
    },
  }, props.label);
}

function Pre(props) {
  return h("pre", {
    style: {
      margin: "8px 0 0", padding: 8, borderRadius: 6, fontSize: 12, lineHeight: 1.5,
      whiteSpace: "pre-wrap", wordBreak: "break-all", overflow: "auto",
      maxHeight: props.maxHeight || 200,
      background: "var(--dsh-code-bg, rgba(127,127,127,.12))",
    },
  }, props.text);
}

function Section(props) {
  return h(Card, null,
    h("div", { style: { fontWeight: 700, marginBottom: 6 } }, props.title),
    props.children);
}


// ---------------- 记忆库的位置：选目录 / 一键建库 / 交给 agent 初始化 ----------------
const langOf = () => {
  const lang = (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en").toLowerCase();
  return lang.indexOf("zh") === 0 ? TEXT.zh : TEXT.en;
};
const useT = () => React.useMemo(langOf, []);

const libApi = (body) => fetch(API + "/library", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());

const wsService = () => (pluginCtx && typeof pluginCtx.get === "function" ? pluginCtx.get("uiWorkspace") : null);
const openSettingsPanel = () => {
  try {
    const l = pluginCtx && typeof pluginCtx.get === "function" ? pluginCtx.get("layout") : null;
    if (l && typeof l.selectPanel === "function") l.selectPanel("settings");
  } catch (_) { /* 老版本没有 layout 服务时静默 */ }
};


// 侧栏底部的常驻入口：不打开设置也能看见「记忆库」在不在
function FooterEntry(props) {
  const t = useT();
  const [stats, setStats] = React.useState(null);
  React.useEffect(() => {
    fetch(API + "/stats").then((r) => r.json()).then((j) => { if (j && j.ok) setStats(j.stats); }).catch(() => { });
  }, []);
  const ready = !!(stats && stats.configured);
  const wide = props && props.wide === true;
  return h("button", {
    type: "button", onClick: openSettingsPanel, title: t.bSiteLabel,
    style: {
      display: "flex", alignItems: "center", gap: 6, width: wide ? "100%" : 36, height: 32,
      padding: wide ? "0 10px" : 0, justifyContent: wide ? "flex-start" : "center",
      borderRadius: 8, cursor: "pointer", color: "inherit", fontSize: 13,
      border: "1px solid transparent", background: "transparent",
    },
  },
    h("span", { style: { fontSize: 14, lineHeight: 1 } }, "📚"),
    wide ? h("span", null, t.bSiteLabel) : null,
    !ready && wide ? h("span", { style: { fontSize: 11, opacity: .6 } }, "· " + t.cardNotReady) : null);
}

function LibrarySetup(props) {
  const t = props.t || TEXT.zh;
  const [busy, setBusy] = React.useState("");
  const [picked, setPicked] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [tone, setTone] = React.useState("hint");

  const done = (text, kind) => { setMsg(text); setTone(kind); if (typeof props.onDone === "function") props.onDone(); };
  const pick = async () => {
    setBusy("pick"); setMsg("");
    try {
      const ws = wsService();
      if (!ws || typeof ws.pickDirectory !== "function") { setMsg(t.setupPickUnsupported); setTone("warn"); return; }
      const dir = await ws.pickDirectory();
      if (!dir) return;
      setPicked(dir);
      const v = await libApi({ action: "validate", dir: dir });
      const info = v && v.info ? v.info : null;
      if (info && info.hint === "other-platform") { setMsg(t.setupOtherPlatform); setTone("warn"); return; }
      if (!info || !info.exists) { setMsg(t.setupDirMissing); setTone("hint"); return; }
      setMsg(info.looksLikeLibrary ? t.setupFoundLibrary : t.setupFoundDir);
      setTone(info.looksLikeLibrary ? "ok" : "hint");
    } catch (_) { setMsg(t.setupPickFailed); setTone("warn"); } finally { setBusy(""); }
  };
  const usePicked = async () => {
    if (picked === "") return;
    setBusy("attach");
    try {
      const r = await libApi({ action: "attach", dir: picked });
      if (r && r.ok) done(r.created && r.created.length > 0 ? t.setupCreated(r.created.length) : t.setupExists, "ok");
      else { setMsg(r && r.info && r.info.hint === "other-platform" ? t.setupOtherPlatform : t.setupFailed); setTone("warn"); }
    } catch (_) { setMsg(t.setupFailed); setTone("warn"); } finally { setBusy(""); }
  };
  const create = async () => {
    setBusy("create");
    try {
      const r = await libApi({ action: "create", dir: picked === "" ? (props.defaultDir || "") : picked });
      if (r && r.ok) done(t.setupCreated((r.created || []).length), "ok");
      else { setMsg(r && r.info && r.info.hint === "other-platform" ? t.setupOtherPlatform : t.setupFailed); setTone("warn"); }
    } catch (_) { setMsg(t.setupFailed); setTone("warn"); } finally { setBusy(""); }
  };
  const handToAgent = () => {
    try { navigator.clipboard.writeText(t.setupAgentPrompt); } catch (_) { }
    const ws = wsService();
    try { if (ws && typeof ws.startSession === "function") ws.startSession(); } catch (_) { }
    setMsg(t.promptCopied); setTone("ok");
  };
  const toneColor = tone === "ok" ? "#5aa078" : (tone === "warn" ? "#e2584d" : "inherit");
  return h("div", null,
    h("div", { style: { opacity: .75, fontSize: 13, lineHeight: 1.75 } }, t.setupIntro),
    h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 } },
      h(ActionButton, { label: busy === "pick" ? "…" : t.setupPick, onClick: pick, disabled: !!busy }),
      h(ActionButton, { label: t.setupUse, onClick: usePicked, disabled: !!busy || picked === "" }),
      h(ActionButton, { label: t.setupCreate, onClick: create, disabled: !!busy, primary: true }),
      h(ActionButton, { label: t.setupAgent, onClick: handToAgent })),
    picked ? h("div", { style: { fontSize: 12, marginTop: 8, wordBreak: "break-all", opacity: .85 } }, "📁 " + picked) : null,
    props.defaultDir ? h("div", { style: { fontSize: 12, marginTop: 4, opacity: .55 } }, t.setupDefaultHint(props.defaultDir)) : null,
    h("div", { style: { fontSize: 12, marginTop: 4, opacity: .55, lineHeight: 1.6 } }, t.setupAgentHint),
    msg ? h("div", { style: { fontSize: 13, marginTop: 8, color: toneColor } }, msg) : null);
}

// 未配置时在输入框下方提示一条（可关掉），让「装上了但没配」这件事被看见
function ComposerNotice() {
  const t = useT();
  const [stats, setStats] = React.useState(null);
  const [hidden, setHidden] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    const tick = () => fetch(API + "/stats").then((r) => r.json())
      .then((j) => { if (alive && j && j.ok) setStats(j.stats); }).catch(() => { });
    tick();
    return () => { alive = false; };
  }, []);
  if (hidden || !stats || stats.configured !== false) return null;
  const btn = { padding: "3px 9px", borderRadius: 6, fontSize: 12, cursor: "pointer", color: "inherit",
    border: "1px solid var(--dsh-border, rgba(127,127,127,.35))", background: "transparent" };
  return h("div", {
    style: { position: "fixed", right: 16, bottom: 96, zIndex: 60, maxWidth: 380,
      display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
      padding: "9px 12px", borderRadius: 10, fontSize: 12.5, lineHeight: 1.6,
      boxShadow: "0 8px 28px rgba(0,0,0,.18)",
      border: "1px solid var(--dsh-border, rgba(127,127,127,.35))",
      background: "var(--dsw-alias-bg-overlay, var(--dsh-surface, rgba(40,40,44,.94)))" },
  },
    h("span", null, "📚 " + t.bannerText),
    h("button", { style: btn, onClick: () => { libApi({ action: "create" }).then((r) => { if (r && r.ok) { setHidden(true); try { window.location.reload(); } catch (_) { } } }).catch(() => { }); } }, t.bannerCreate),
    h("button", { style: btn, onClick: openSettingsPanel }, t.bannerOpen),
    h("button", { style: btn, onClick: () => setHidden(true) }, t.bannerHide));
}

// 插件页里的一张卡：不打开设置也能知道这个插件在干嘛、状态如何
function PluginCard() {
  const t = useT();
  const [stats, setStats] = React.useState(null);
  React.useEffect(() => {
    fetch(API + "/stats").then((r) => r.json()).then((j) => { if (j && j.ok) setStats(j.stats); }).catch(() => { });
  }, []);
  const ready = !!(stats && stats.configured);
  return h(Card, null,
    h("div", { style: { fontWeight: 700, marginBottom: 6 } }, "📚 " + t.cardTitle),
    h("div", { style: { fontSize: 13, opacity: .78, lineHeight: 1.75 } }, t.cardDesc),
    h(Row, { label: t.cardStatus, value: ready ? (t.cardReady + " · " + fmtNum(stats.cards) + " " + (t.cardUnit || "")).trim() : t.cardNotReady }),
    ready && stats.root ? h("div", { style: { fontSize: 12, opacity: .6, marginTop: 4, wordBreak: "break-all" } }, stats.root) : null,
    h("div", { style: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" } },
      h(ActionButton, { label: t.cardOpen, onClick: openSettingsPanel, primary: true }),
      h(CopyButton, { text: t.setupAgentPrompt, label: t.promptLabel, copiedLabel: t.copied })),
    h("div", { style: { fontSize: 12, opacity: .55, marginTop: 6, lineHeight: 1.6 } }, t.cardHow));
}

function SettingsPage() {
  const PROMPT_KEYS = [["govern", "治理 Governance"], ["consolidate", "巩固 Consolidate"], ["checkup", "体检 Checkup"], ["cleanup", "清理 Cold area"]];
  const [data, setData] = React.useState(null);
  const [cfg, setCfg] = React.useState(null);
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [runOut, setRunOut] = React.useState(null);
  const [promptKey, setPromptKey] = React.useState("govern");
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState(null);
  const [toast, setToast] = React.useState("");
  const searchRef = React.useRef(null);
  const [showSetup, setShowSetup] = React.useState(false);
  const t = React.useMemo(() => {
    const lang = (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en").toLowerCase();
    return lang.indexOf("zh") === 0 ? TEXT.zh : TEXT.en;
  }, []);

  const load = () => {
    fetch(API + "/dashboard").then((r) => r.json()).then((j) => {
      if (j && j.ok) { setData(j); setCfg(j.config); setErr(""); } else setErr(t.errStats);
    }).catch(() => setErr(t.errStats));
  };
  React.useEffect(load, []);

  const save = (patch) => {
    setCfg((c) => Object.assign({}, c, patch));
    fetch(API + "/config", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => r.json()).then((j) => { if (j && j.ok) setCfg(j.config); }).catch(() => { });
  };

  const run = (action) => {
    setBusy(action); setRunOut(null);
    fetch(API + "/run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: action }),
    }).then((r) => r.json()).then((j) => { setRunOut(j); if (j && j.ok) load(); })
      .catch(() => setRunOut({ ok: false, action: action, error: t.errStats }))
      .finally(() => setBusy(""));
  };

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 1800); };
  const copy = (text, msg) => { try { navigator.clipboard.writeText(text); flash(msg || t.copied); } catch (_) { } };

  // 「开新对话 + 复制提示词」：起点是新会话，提示词进剪贴板（没有输入框注入接口，粘贴一次即可）
  const newChat = () => {
    copy(t.prompts[promptKey], t.promptCopied);
    try {
      const ws = pluginCtx && typeof pluginCtx.get === "function" ? pluginCtx.get("uiWorkspace") : null;
      if (ws && typeof ws.startSession === "function") ws.startSession();
    } catch (_) { /* 服务缺失时只复制提示词，不报错 */ }
  };

  const doSearch = () => {
    const q = query.trim();
    if (q === "") return;
    setHits({ ok: true, text: "…" });
    fetch(API + "/search?q=" + encodeURIComponent(q) + "&top=" + ((cfg && cfg.searchTop) || 5))
      .then((r) => r.json()).then((j) => setHits(j))
      .catch(() => setHits({ ok: false, error: t.errStats }));
  };

  if (err) return h(Card, null, h("div", { style: { color: "#e88" } }, "⚠ " + err));
  if (!data) return h(Card, null, h("div", { style: { opacity: .7 } }, "…"));
  if (!data.configured) {
    return h("div", null,
      h(Section, { title: t.setupTitle },
        h(LibrarySetup, { t: t, defaultDir: data.defaultDir, onDone: load })));
  }

  const tax = data.tax || {}, scale = data.scale || {}, layers = data.layers || {};
  const up = data.upkeep || {}, guard = data.guard || {}, tools = data.tools || {};
  const git = guard.git || {}, glog = guard.log || {}, bkp = guard.backup || {};
  const conf = cfg || {};
  const pctOf = (v, total) => (total > 0 ? Math.round((v / total) * 100) : 0);
  const topics = scale.topicsDist || [];
  const maxTopic = topics.length ? Math.max(1, topics[0].count) : 1;

  // 告警条：税超预算 / 超长卡 / 该巩固 / 未提交
  const alerts = [];
  if (tax.budget > 0 && tax.pct > 100) alerts.push({ c: "#e2584f", text: t.alertTax(tax.pct, fmtNum(tax.total), fmtNum(tax.budget)) });
  if (layers.oversize > 0) alerts.push({ c: "#e8a33d", text: t.alertOversize(layers.oversize, 60, 8) });
  if (up.due) alerts.push({ c: "#e8a33d", text: t.alertDue(up.daysSinceConsolidation, up.recentCards) });
  if (git.dirty > 0) alerts.push({ c: "var(--dsh-border, #888)", text: t.alertDirty(git.dirty) });
  const alertBar = h("div", {
    style: {
      borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 13, lineHeight: 1.6,
      border: "1px solid var(--dsh-border, rgba(127,127,127,.3))",
      background: alerts.length ? "rgba(232,163,61,.08)" : "rgba(90,160,120,.10)",
    },
  }, alerts.length
    ? alerts.map((a, i) => h("div", { key: i, style: { color: a.c } }, a.text))
    : h("div", { style: { color: "#5aa078" } }, t.allGood));

  const trendText = tax.trend && tax.trend.delta !== null && tax.trend.delta !== undefined
    ? t.taxTrendLine(fmtNum(tax.trend.baselineChars), fmtNum(tax.total), tax.trend.delta)
    : t.taxTrendNone;

  const renderRunOut = (r) => {
    if (!r) return "";
    const lines = [(r.ok ? "✓ " : "✗ ") + String(r.action || "") + " — "
      + (r.ok ? t.doneIn(r.ms || 0) : t.failed + ": " + (r.error || ""))];
    if (r.artifact) lines.push("📦 " + r.artifact.name + " · " + r.artifact.mb + " MB · " + fmtTime(r.artifact.at));
    if (r.guard && r.guard.at) lines.push("🛡 " + r.guard.at + (r.guard.action ? " · " + r.guard.action : ""));
    if (r.report) {
      lines.push(t.scanCand + "：" + r.report.candidates.length);
      for (const c of r.report.candidates.slice(0, 8)) lines.push("   · " + c.rel + "（" + t.candUnit(c.days) + "）");
      lines.push(t.scanOversize + "：" + r.report.oversizeCount);
      for (const c of r.report.oversize.slice(0, 8)) lines.push("   · " + c.rel + "（" + c.lines + " 行 / " + c.kb + "KB）");
      lines.push(t.scanDup + "：" + r.report.dupTitles.length);
      if (r.report.over50.length) lines.push(t.scanOver50 + "：" + r.report.over50.map((x) => x.name + "(" + x.count + ")").join(", "));
    }
    if (r.out) lines.push(r.out);
    return lines.join("\n");
  };

  return h("div", null,
    alertBar,

    // ① 开场税
    h(Section, { title: t.taxTitle },
      (tax.files || []).map((f) => h("div", { key: f.rel, style: { margin: "4px 0" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 } },
          h("span", { style: { wordBreak: "break-all" } }, f.rel),
          h("span", { style: { fontWeight: 600, flex: "0 0 auto" } }, f.exists ? fmtNum(f.chars) : "—")),
        h(Bar, { pct: pctOf(f.chars, tax.total), color: "rgba(120,170,210,.75)" }))),
      h(Bar, { pct: tax.pct, over: tax.pct > 100 }),
      h(Row, { label: t.taxUsed, value: fmtNum(tax.total) + " / " + fmtNum(tax.budget) }),
      h(Row, { label: t.taxPct, value: tax.pct + "%" }),
      h(Row, { label: t.taxRemaining, value: fmtNum(tax.remaining) }),
      h(Row, { label: t.taxTokens, value: fmtNum(tax.tokens) }),
      h(Row, { label: t.taxTrend, value: trendText })),

    // ①b 记忆库位置（换目录 / 补骨架 / 交给 agent 初始化）
    h(Section, { title: t.libTitle },
      h(Row, { label: t.libPath, value: data.root || "—" }),
      h("div", { style: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" } },
        h(ActionButton, { label: showSetup ? t.libChangeHide : t.libChange, onClick: () => setShowSetup(!showSetup) })),
      showSetup ? h("div", { style: { marginTop: 10 } },
        h(LibrarySetup, { t: t, defaultDir: data.defaultDir, onDone: load })) : null),

    // ② 规模与趋势
    h(Section, { title: t.scaleTitle },
      h(Row, { label: t.cards, value: fmtNum(scale.cards) + (t.cardUnit ? " " + t.cardUnit : "") }),
      h(Row, { label: t.size, value: t.sizeUnit(fmtNum(scale.chars), fmtNum(scale.tokens)) }),
      h(Row, { label: t.topics, value: fmtNum(scale.topics) + (t.topicsUnit ? " " + t.topicsUnit : "") }),
      h(Row, { label: t.todayNew, value: fmtNum(scale.todayNew) }),
      h(Row, { label: t.updated, value: fmtTime(scale.updatedAt) }),
      h("div", { style: { marginTop: 8, opacity: .75, fontSize: 13 } }, t.dist),
      topics.map((x) => h("div", { key: x.name, style: { margin: "3px 0" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12 } },
          h("span", null, x.name),
          h("span", { style: { fontWeight: 600 } }, x.count)),
        h(Bar, { pct: pctOf(x.count, maxTopic), color: "rgba(120,170,210,.55)" }))),
      scale.topicsTotal > topics.length
        ? h("div", { style: { opacity: .55, fontSize: 12 } }, t.distMore(scale.topicsTotal - topics.length))
        : null),

    // ③ 分层健康
    h(Section, { title: t.layersTitle },
      h(Row, { label: t.warm, value: fmtNum(layers.cards) }),
      h(Row, { label: t.cold, value: fmtNum(layers.cold) }),
      h(Row, { label: t.oversize, value: fmtNum(layers.oversize) }),
      (layers.oversizeList || []).length
        ? h("div", { style: { marginTop: 4 } },
          h("div", { style: { opacity: .65, fontSize: 12 } }, t.oversizeTop),
          h(Pre, { maxHeight: 120, text: (layers.oversizeList || []).map((c) => "· " + c.lines + " 行 / " + c.kb + "KB  " + c.rel).join("\n") }))
        : null,
      h(Row, { label: t.over50, value: (layers.over50 || []).length ? (layers.over50 || []).map((x) => x.name + "(" + x.count + ")").join(", ") : t.over50None }),
      h(Row, { label: t.dupTitles, value: (layers.dupTitles || []).length ? (layers.dupTitles || []).map((x) => x.title.slice(0, 24) + " ×" + x.count).join("；") : t.none }),
      h(Row, { label: t.longest, value: layers.longest && layers.longest.lines ? layers.longest.name + " (" + layers.longest.lines + ")" : "—" })),

    // ④ 巩固状态
    h(Section, { title: t.upkeepTitle },
      h(Row, { label: t.upkeepLast, value: up.daysSinceConsolidation >= 0 ? (up.lastConsolidation || "-") : t.upkeepNever }),
      h(Row, { label: t.upkeepDays, value: up.daysSinceConsolidation >= 0 ? up.daysSinceConsolidation : "—" }),
      h(Row, { label: t.upkeepRecent, value: fmtNum(up.recentCards) }),
      h(Row, {
        label: (t === TEXT.zh ? "阈值" : "Thresholds"),
        value: "> " + (up.thresholds ? up.thresholds.days : "-") + " 天 且 ≥ " + (up.thresholds ? up.thresholds.cards : "-")
          + " 张 ／ 保底 " + (up.thresholds ? up.thresholds.hardDays : "-") + " 天",
      }),
      h("div", { style: { marginTop: 4, fontSize: 13, fontWeight: 600, color: up.due ? "#e8a33d" : "inherit", opacity: up.due ? 1 : .7 } },
        up.due ? t.upkeepDue : t.upkeepIdle),
      h("div", { style: { opacity: .55, fontSize: 12, marginTop: 4, lineHeight: 1.6 } }, t.upkeepHint)),

    // ⑤ 守卫与备份
    h(Section, { title: t.guardTitle },
      h(Row, { label: t.gitDirty, value: git.dirty > 0 ? fmtNum(git.dirty) : t.gitClean }),
      h(Row, {
        label: t.gitLast,
        value: git.lastCommit ? (git.lastCommit.hash + " · " + fmtTime(git.lastCommit.at) + " · " + git.lastCommit.subject) : "—",
      }),
      h(Row, { label: t.guardAt, value: glog.at ? (glog.at + (glog.action ? " · " + glog.action : "")) : t.guardNone }),
      h(Row, { label: t.backupLast, value: bkp.latest ? (bkp.latest.name + " · " + bkp.latest.mb + " MB · " + fmtTime(bkp.latest.at)) : "—" }),
      h(Row, { label: t.backupCount, value: fmtNum(bkp.count) })),

    // ⑥ 检索与工具
    h(Section, { title: t.toolsTitle },
      h(Row, { label: t.toolScript, value: tools.scriptOK ? t.okShort : t.badShort }),
      h(Row, { label: t.toolIndex, value: fmtNum(tools.indexRows) }),
      h(Row, { label: t.toolSyn, value: fmtNum(tools.synonymGroups) }),
      h(Row, { label: t.toolInject, value: fmtNum(tools.injectedChars) + " / " + fmtNum(tools.injectBudget) }),
      h(Bar, { pct: pctOf(tools.injectedChars, tools.injectBudget) }),
      h("div", { style: { display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" } },
        h("input", {
          ref: searchRef, value: query, placeholder: t.searchPh,
          onChange: (e) => setQuery(e.target.value),
          onKeyDown: (e) => { if (e.key === "Enter") doSearch(); },
          style: {
            flex: "1 1 200px", padding: "6px 9px", borderRadius: 6, fontSize: 13,
            border: "1px solid var(--dsh-border, rgba(127,127,127,.35))", background: "transparent", color: "inherit",
          },
        }),
        h(ActionButton, { label: t.searchRun, primary: true, onClick: doSearch }),
        h(CopyButton, { text: "node " + (data.root || "") + "/tools/memory-find.mjs \"关键词\" --top " + ((conf && conf.searchTop) || 5), label: "复制命令行", copiedLabel: t.copied })),
      hits
        ? (hits.ok
          ? h(Pre, { text: hits.text || "…", maxHeight: 260 })
          : h("div", { style: { color: "#e88", fontSize: 12, marginTop: 6 } }, "⚠ " + (hits.error || "")))
        : null),

    // 控件：滑块 + 数字双联
    h(Section, { title: t.slidersTitle },
      h(Slider, { label: t.sTax, value: conf.taxBudget, min: 5000, max: 200000, step: 1000, unit: t.sTaxUnit, hint: t.sTaxHint, onCommit: (v) => save({ taxBudget: v }) }),
      h(Slider, { label: t.sInject, value: conf.injectBudget, min: 200, max: 2000, step: 50, unit: t.sInjectUnit, hint: t.sInjectHint, onCommit: (v) => save({ injectBudget: v }) }),
      h(Slider, { label: t.sTopN, value: conf.searchTop, min: 1, max: 10, step: 1, unit: t.sTopNUnit, hint: t.sTopNHint, onCommit: (v) => save({ searchTop: v }) }),
      h(Slider, { label: t.sDays, value: conf.upkeepDays, min: 1, max: 365, step: 1, unit: t.sDaysUnit, hint: t.sDaysHint, onCommit: (v) => save({ upkeepDays: v }) }),
      h(Slider, { label: t.sCards, value: conf.upkeepCards, min: 1, max: 200, step: 1, unit: t.sCardsUnit, hint: t.sCardsHint, onCommit: (v) => save({ upkeepCards: v }) }),
      h(Slider, { label: t.sHard, value: conf.upkeepHardDays, min: 7, max: 365, step: 1, unit: t.sHardUnit, hint: t.sHardHint, onCommit: (v) => save({ upkeepHardDays: v }) }),
      h("div", { style: { height: 6 } }),
      h(Toggle, { label: t.injectOn, checked: !!conf.injectSummary, onChange: (v) => save({ injectSummary: v }) }),
      h(Toggle, { label: t.toolOn, checked: !!conf.toolEnabled, onChange: (v) => save({ toolEnabled: v }) }),
      h("div", { style: { opacity: .55, fontSize: 12, marginTop: 8, wordBreak: "break-all" } }, t.foot + (data.configFile || ""))),

    // 按钮区
    h(Section, { title: t.actionsTitle },
      h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
        h(ActionButton, { label: busy === "checkup" ? t.running : t.bCheckup, disabled: !!busy, primary: true, onClick: () => run("checkup") }),
        h(ActionButton, { label: busy === "backup" ? t.running : t.bBackup, disabled: !!busy, onClick: () => run("backup") }),
        h(ActionButton, { label: busy === "scan" ? t.running : t.bScan, disabled: !!busy, onClick: () => run("scan") }),
        h(ActionButton, { label: t.bNewChat, onClick: newChat }),
        h(ActionButton, { label: t.bSearch, onClick: () => { const el = searchRef.current; if (el && el.focus) el.focus(); } }),
        data.siteUrl ? h(ActionButton, { label: t.bSite, onClick: () => { try { window.open(data.siteUrl, "_blank"); } catch (_) { } } }) : null,
        h(ActionButton, { label: t.refresh, onClick: load })),
      h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" } },
        h("select", {
          value: promptKey, onChange: (e) => setPromptKey(e.target.value),
          style: {
            padding: "5px 8px", borderRadius: 6, fontSize: 13, color: "inherit",
            border: "1px solid var(--dsh-border, rgba(127,127,127,.35))",
            background: "var(--dsh-surface, rgba(127,127,127,.08))",
          },
        }, PROMPT_KEYS.map((k) => h("option", { key: k[0], value: k[0] }, k[1]))),
        h(CopyButton, { text: t.prompts[promptKey], label: t.promptLabel, copiedLabel: t.copied })),
      h("div", { style: { opacity: .55, fontSize: 12, marginTop: 4 } }, t.promptPickHint),
      runOut ? h(Pre, { text: renderRunOut(runOut), maxHeight: 300 }) : null,
      toast ? h("div", { style: { marginTop: 6, fontSize: 12, color: "#5aa078" } }, toast) : null))
}
// ---------------- registration ----------------
// Client services are injected by SHORT names in this deployment
// (see dsh-multi-tts / dsh-config-manager client halves). The legacy
// full-package name "@deepseek-ai/dsh-client-runtime" no longer exists as a
// client entry in dsh 0.1.5-rc.1, which left this entry pending forever.
const inject = ["slots", "locale"];

function apply(ctx) {
  installNavIcon()
  // 未配置时的提醒（发现性）：主视觉挂在页面级浮层上（不用先开会话就能看到），
  // 顺带也挂到输入框下方的 ambient 位（该插槽渲染时同样出现）。
  // 侧栏底部常驻入口（已验证可用的插槽）：第一眼就能看到，点一下去设置页
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action", id: NS + "-footer", order: 55, locale: NS,
  }, FooterEntry));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay", id: NS + "-notice", order: 80, locale: NS,
  }, ComposerNotice));
  ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
    name: "conversation.composer.dock", id: NS + "-notice-dock", order: 60, locale: NS,
  }, ComposerNotice));
  // 插件页里的卡片（key = 包名）
  ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
    name: "plugins.bundle.config", id: NS + "-bundle-config", key: "dsh-memory-lite", locale: NS,
  }, (ownerProps = {}) => (ownerProps && ownerProps.view === "summary" ? null : h(PluginCard, {}))));

  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: NS, order: 58, locale: NS,
    label: () => {
      const lang = (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en").toLowerCase();
      return lang.indexOf("zh") === 0 ? "记忆库" : "Memory library";
    },
    inject: () => ({ api: API }),
  }, SettingsPage));
}

exports.inject = inject;
exports.apply = apply;
return module.exports; } });
