// dsh-memory-lite — client 端：设置页「记忆库」侧边栏（概览 / 健康 / 开关）
// 零构建手写，与 dsh-multi-tts 同款路线：window.__ModuleLoader__ + 工厂函数
window.__ModuleLoader__.load({ id: "dsh-memory-lite", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
const React = require("react");
const h = React.createElement;

const NS = "memory-lite";
const API = "/" + NS;

// ---------------- 小工具 ----------------
function fmtNum(n) { return typeof n === "number" ? n.toLocaleString("zh-CN") : "-"; }
function fmtTime(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    const p = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  } catch (_) { return "-"; }
}
function approxTokens(chars) { return chars > 0 ? Math.round(chars / 3.2) : 0; }

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
      try {
        navigator.clipboard.writeText(props.text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      } catch (_) { }
    },
    style: {
      padding: "4px 10px", borderRadius: 6, cursor: "pointer",
      border: "1px solid var(--dsh-border, rgba(127,127,127,.35))",
      background: "transparent", color: "inherit", fontSize: 12,
    },
  }, done ? "已复制 ✓" : props.label || "复制命令");
}

// ---------------- 设置页 ----------------
function SettingsPage() {
  const [stats, setStats] = React.useState(null);
  const [health, setHealth] = React.useState(null);
  const [cfg, setCfg] = React.useState(null);
  const [err, setErr] = React.useState("");

  const load = () => {
    fetch(API + "/stats").then((r) => r.json()).then((j) => {
      if (j && j.ok) { setStats(j.stats); setCfg(j.config); } else setErr("统计接口异常");
    }).catch(() => setErr("取不到统计（host 端路由未就绪？）"));
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
  const root = s.root || "(未知)";

  return h("div", null,
    // ① 概览
    h(Card, null,
      h("div", { style: { fontWeight: 700, marginBottom: 8 } }, "📚 记忆库概览"),
      h(Row, { label: "卡片", value: fmtNum(s.cards) + " 张" }),
      h(Row, { label: "正文体量", value: fmtNum(s.chars) + " 字符（≈ " + fmtNum(approxTokens(s.chars)) + " token 全读）" }),
      h(Row, { label: "主题", value: fmtNum(s.topics) + " 个" }),
      h(Row, { label: "最近更新", value: fmtTime(s.updatedAt) }),
      s.longest && s.longest.lines > 0
        ? h(Row, { label: "最长卡片", value: s.longest.name + "（" + s.longest.lines + " 行）" })
        : null,
      h("div", { style: { opacity: .6, fontSize: 12, marginTop: 6, wordBreak: "break-all" } }, root)),

    // ② 健康（来自定时守卫的体检日志）
    h(Card, null,
      h("div", { style: { fontWeight: 700, marginBottom: 8 } }, "🩺 健康（定时守卫 MemoryGuard）"),
      health && health.exists
        ? h("div", null,
          h(Row, {
            label: "上次体检",
            value: (health.at || "-") + (health.issues !== null ? "　问题 " + health.issues + " / 提示 " + health.notes : ""),
          }),
          health.detail
            ? h("pre", {
              style: {
                margin: "8px 0 0", padding: 8, borderRadius: 6, fontSize: 12, lineHeight: 1.5,
                whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 160, overflow: "auto",
                background: "var(--dsh-code-bg, rgba(127,127,127,.12))",
              },
            }, health.detail)
            : h("div", { style: { opacity: .6, fontSize: 12 } }, "本轮无问题/提示"))
        : h("div", { style: { opacity: .7, fontSize: 13 } }, "还没读到体检日志（计划任务尚未跑过，或非 Windows 端）"),
      h("div", { style: { marginTop: 8 } }, h(CopyButton, { text: "powershell -File " + root + "\\tools\\memory-guard.ps1 -DryRun", label: "复制「立刻体检」命令" }))),

    // ③ 开关
    h(Card, null,
      h("div", { style: { fontWeight: 700, marginBottom: 6 } }, "⚙ 开关"),
      h(Toggle, {
        label: "开场注入记忆库摘要（" + fmtNum(s.injectedChars) + " / " + fmtNum(cfg && cfg.injectBudget) + " 字符）",
        checked: !!(cfg && cfg.injectSummary),
        onChange: (v) => save({ injectSummary: v }),
      }),
      h(Toggle, {
        label: "启用 memory_find 工具（关闭后模型无法检索记忆库）",
        checked: !!(cfg && cfg.toolEnabled),
        onChange: (v) => save({ toolEnabled: v }),
      }),
      h("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" } },
        h("span", { style: { opacity: .75 } }, "摘要预算"),
        h("input", {
          type: "range", min: 200, max: 2000, step: 50,
          value: (cfg && cfg.injectBudget) || 900,
          onChange: (e) => setCfg((c) => Object.assign({}, c, { injectBudget: Number(e.target.value) })),
          onMouseUp: (e) => save({ injectBudget: Number(e.target.value) }),
          onTouchEnd: (e) => save({ injectBudget: Number(e.target.value) }),
          style: { flex: 1, maxWidth: 260 },
        }),
        h("span", { style: { fontWeight: 600, minWidth: 54, textAlign: "right" } }, fmtNum(cfg && cfg.injectBudget) + " 字符")),
      h("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0" } },
        h("span", { style: { opacity: .75 } }, "检索条数上限"),
        h("input", {
          type: "number", min: 1, max: 10, step: 1,
          value: (cfg && cfg.searchTop) || 5,
          onChange: (e) => setCfg((c) => Object.assign({}, c, { searchTop: Number(e.target.value) })),
          onBlur: (e) => save({ searchTop: Number(e.target.value) }),
          style: { width: 72, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--dsh-border, rgba(127,127,127,.35))", background: "transparent", color: "inherit" },
        }),
        h("span", { style: { opacity: .6, fontSize: 12 } }, "每次检索返回的卡片数")),
      h("div", { style: { marginTop: 6, display: "flex", gap: 8, alignItems: "center" } },
        h(CopyButton, { text: "node " + root + "\\tools\\memory-find.mjs \"关键词 关键词\" --top 5", label: "复制检索命令" }),
        h("span", { style: { opacity: .55, fontSize: 12 } }, "或直接在对话里让我 search（我会调 memory_find）")),
      h("div", { style: { marginTop: 10, opacity: .6, fontSize: 12 } },
        "开关即时生效；配置文件 = 记忆库根目录 .dsh-memory-lite.json（在 git 里，改坏可回滚）")));
}

// ---------------- 注册 ----------------
const inject = [
  "@deepseek-ai/dsh-client-runtime",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-settings",
];

function apply(ctx) {
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: NS, order: 58, locale: NS,
    label: () => "记忆库",
    inject: () => ({ api: API }),
  }, SettingsPage));
}

exports.inject = inject;
exports.apply = apply;
return module.exports; } });
