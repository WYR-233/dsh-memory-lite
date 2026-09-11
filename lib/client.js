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

// ---------------- i18n (zh / en) ----------------
const TEXT = {
  zh: {
    title: "📚 记忆库概览",
    cards: "卡片", cardUnit: "张",
    size: "正文体量", sizeUnit: (chars, tok) => chars + " 字符（≈ " + tok + " token 全读）",
    topics: "主题", topicsUnit: "个",
    updated: "最近更新",
    longest: "最长卡片",
    root: "记忆库路径",
    healthTitle: "🩺 健康",
    healthAt: "上次体检",
    healthNone: "还没读到体检日志（未配置外部检查器，或尚未运行过）",
    healthClean: "本轮无问题/提示",
    copyCheck: "复制「立刻体检」命令",
    togglesTitle: "⚙ 开关",
    injectOn: "开场注入记忆库摘要",
    toolOn: "启用 memory_find 工具（关闭后无法检索记忆库）",
    budget: "摘要预算",
    budgetUnit: "字符",
    topN: "检索条数上限",
    topNHint: "每次检索返回的卡片数",
    copySearch: "复制检索命令",
    searchHint: "或在对话里直接让我 search（我会调 memory_find）",
    foot: "开关即时生效；运行时配置 = ",
    notConfigured: "尚未配置记忆库路径：请在插件配置里设置 memoryRoot（或环境变量 DSH_MEMORY_ROOT）",
    errStats: "取不到统计（host 端路由未就绪？）",
    copied: "已复制 ✓",
  },
  en: {
    title: "📚 Memory library",
    cards: "Cards", cardUnit: "",
    size: "Body size", sizeUnit: (chars, tok) => chars + " chars (≈ " + tok + " tokens if read whole)",
    topics: "Topics", topicsUnit: "",
    updated: "Last updated",
    longest: "Longest card",
    root: "Library path",
    healthTitle: "🩺 Health",
    healthAt: "Last check",
    healthNone: "No checker log found yet (no external checker configured, or it has not run)",
    healthClean: "No issues this round",
    copyCheck: "Copy \"run check now\" command",
    togglesTitle: "⚙ Toggles",
    injectOn: "Inject the memory-library digest at start",
    toolOn: "Enable the memory_find tool (turning it off removes library search)",
    budget: "Digest budget",
    budgetUnit: "chars",
    topN: "Search result limit",
    topNHint: "Cards returned per search",
    copySearch: "Copy search command",
    searchHint: "or just ask me to search (I call memory_find)",
    foot: "Toggles apply immediately; runtime config = ",
    notConfigured: "Memory library path is not configured: set the plugin option memoryRoot (or the DSH_MEMORY_ROOT env var).",
    errStats: "Cannot read stats (host route not ready?)",
    copied: "Copied ✓",
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

function SettingsPage() {
  const [stats, setStats] = React.useState(null);
  const [health, setHealth] = React.useState(null);
  const [cfg, setCfg] = React.useState(null);
  const [err, setErr] = React.useState("");
  const t = React.useMemo(() => {
    const lang = (typeof navigator !== "undefined" && navigator.language ? navigator.language : "en").toLowerCase();
    return lang.indexOf("zh") === 0 ? TEXT.zh : TEXT.en;
  }, []);

  const load = () => {
    fetch(API + "/stats").then((r) => r.json()).then((j) => {
      if (j && j.ok) { setStats(j.stats); setCfg(j.config); } else setErr(t.errStats);
    }).catch(() => setErr(t.errStats));
    fetch(API + "/health").then((r) => r.json()).then((j) => { if (j && j.ok) setHealth(j.health); }).catch(() => { });
  };
  React.useEffect(load, []);

  const save = (patch) => {
    setCfg((c) => Object.assign({}, c, patch));
    fetch(API + "/config", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => r.json()).then((j) => { if (j && j.ok) setCfg(j.config); }).catch(() => { });
  };

  if (err) return h(Card, null, h("div", { style: { color: "#e88" } }, "⚠ " + err));

  const s = stats || {};
  const root = s.root || "";
  const configured = s.configured !== false && root !== "";
  if (!configured) return h(Card, null, h("div", { style: { padding: "4px 0" } }, "⚠ " + t.notConfigured));

  return h("div", null,
    // ① overview
    h(Card, null,
      h("div", { style: { fontWeight: 700, marginBottom: 8 } }, t.title),
      h(Row, { label: t.cards, value: fmtNum(s.cards) + (t.cardUnit ? " " + t.cardUnit : "") }),
      h(Row, { label: t.size, value: t.sizeUnit(fmtNum(s.chars), fmtNum(approxTokens(s.chars))) }),
      h(Row, { label: t.topics, value: fmtNum(s.topics) + (t.topicsUnit ? " " + t.topicsUnit : "") }),
      h(Row, { label: t.updated, value: fmtTime(s.updatedAt) }),
      s.longest && s.longest.lines > 0 ? h(Row, { label: t.longest, value: s.longest.name + " (" + s.longest.lines + ")" }) : null,
      h("div", { style: { opacity: .6, fontSize: 12, marginTop: 6, wordBreak: "break-all" } }, root)),

    // ② health
    h(Card, null,
      h("div", { style: { fontWeight: 700, marginBottom: 8 } }, t.healthTitle),
      health && health.exists
        ? h("div", null,
          h(Row, {
            label: t.healthAt,
            value: (health.at || "-") + (health.issues !== null ? "  ⚠ " + health.issues + " / " + health.notes : ""),
          }),
          health.detail
            ? h("pre", {
              style: {
                margin: "8px 0 0", padding: 8, borderRadius: 6, fontSize: 12, lineHeight: 1.5,
                whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 160, overflow: "auto",
                background: "var(--dsh-code-bg, rgba(127,127,127,.12))",
              },
            }, health.detail)
            : h("div", { style: { opacity: .6, fontSize: 12 } }, t.healthClean))
        : h("div", { style: { opacity: .7, fontSize: 13 } }, t.healthNone),
      h("div", { style: { marginTop: 8 } },
        h(CopyButton, {
          text: "powershell -File " + root + "\\tools\\memory-guard.ps1 -DryRun",
          label: t.copyCheck, copiedLabel: t.copied,
        }))),

    // ③ toggles
    h(Card, null,
      h("div", { style: { fontWeight: 700, marginBottom: 6 } }, t.togglesTitle),
      h(Toggle, {
        label: t.injectOn + "（" + fmtNum(s.injectedChars) + " / " + fmtNum(cfg && cfg.injectBudget) + "）",
        checked: !!(cfg && cfg.injectSummary),
        onChange: (v) => save({ injectSummary: v }),
      }),
      h(Toggle, {
        label: t.toolOn,
        checked: !!(cfg && cfg.toolEnabled),
        onChange: (v) => save({ toolEnabled: v }),
      }),
      h("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" } },
        h("span", { style: { opacity: .75 } }, t.budget),
        h("input", {
          type: "range", min: 200, max: 2000, step: 50,
          value: (cfg && cfg.injectBudget) || 900,
          onChange: (e) => setCfg((c) => Object.assign({}, c, { injectBudget: Number(e.target.value) })),
          onMouseUp: (e) => save({ injectBudget: Number(e.target.value) }),
          onTouchEnd: (e) => save({ injectBudget: Number(e.target.value) }),
          style: { flex: 1, maxWidth: 260 },
        }),
        h("span", { style: { fontWeight: 600, minWidth: 76, textAlign: "right" } }, fmtNum(cfg && cfg.injectBudget) + " " + t.budgetUnit)),
      h("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" } },
        h("span", { style: { opacity: .75 } }, t.topN),
        h("input", {
          type: "number", min: 1, max: 10, step: 1,
          value: (cfg && cfg.searchTop) || 5,
          onChange: (e) => setCfg((c) => Object.assign({}, c, { searchTop: Number(e.target.value) })),
          onBlur: (e) => save({ searchTop: Number(e.target.value) }),
          style: { width: 72, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--dsh-border, rgba(127,127,127,.35))", background: "transparent", color: "inherit" },
        }),
        h("span", { style: { opacity: .6, fontSize: 12 } }, t.topNHint)),
      h("div", { style: { marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
        h(CopyButton, {
          text: "node " + root + "/tools/memory-find.mjs \"keywords\" --top 5",
          label: t.copySearch, copiedLabel: t.copied,
        }),
        h("span", { style: { opacity: .55, fontSize: 12 } }, t.searchHint)),
      h("div", { style: { marginTop: 10, opacity: .6, fontSize: 12, wordBreak: "break-all" } },
        t.foot + (s.configFile || ""))));
}

// ---------------- registration ----------------
// Client services are injected by SHORT names in this deployment
// (see dsh-multi-tts / dsh-config-manager client halves). The legacy
// full-package name "@deepseek-ai/dsh-client-runtime" no longer exists as a
// client entry in dsh 0.1.5-rc.1, which left this entry pending forever.
const inject = ["slots", "locale"];

function apply(ctx) {
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
