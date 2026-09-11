// dsh-memory-lite — 只读记忆库增强插件(片②D 首片)
// 能力：
//   1) memory_find 工具      → 调记忆库检索脚本找卡片（省 token，替代 glob/盲翻目录）
//   2) systemPrompt 摘要注入 → 开场告诉模型「记忆库在哪、有哪些主题、要查就先检索」
//   3) 设置页(侧边栏)        → 概览 / 健康 / 开关；host 端只读统计 + 轻量配置读写
// 设计红线：
//   · 只读记忆库内容：不写卡片、不 commit、不 push（机械动作交给外部定时守卫）
//   · 配置写在记忆库根目录 .dsh-memory-lite.json（在 git 里，改坏可回滚；不碰 DSH 配置文件）
//   · 纯追加：只注册 systemPrompt section，绝不改写会话历史
//   · 硬预算：注入文本默认 ≤900 字符，只注索引不注卡片全文
//   · 配置读写只做原子写 + 解析失败回默认，绝不静默清空
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'memory-lite'
export const inject = ['tools', 'systemPrompt', 'webServer']

const NS = 'memory-lite'
const ROOT = process.env.DSH_MEMORY_ROOT || 'G:\\deepseek\\deepseek-memory'
const FIND_SCRIPT = join(ROOT, 'tools', 'memory-find.mjs')
const INDEX_FILE = join(ROOT, 'INDEX.md')
const RULES_FILE = join(ROOT, 'RULES.md')
const CONFIG_FILE = join(ROOT, '.dsh-memory-lite.json')

const DEFAULTS = {
  injectSummary: true,
  injectBudget: 900,
  toolEnabled: true,
  searchTop: 5,
}

// ---------- 配置（记忆库内 JSON + 原子写；坏了就用默认，绝不覆盖成空） ----------
function loadConfig() {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    if (raw === null || typeof raw !== 'object') return { ...DEFAULTS }
    const out = { ...DEFAULTS }
    if (typeof raw.injectSummary === 'boolean') out.injectSummary = raw.injectSummary
    if (Number.isFinite(raw.injectBudget)) out.injectBudget = Math.max(200, Math.min(2000, Math.round(raw.injectBudget)))
    if (typeof raw.toolEnabled === 'boolean') out.toolEnabled = raw.toolEnabled
    if (Number.isFinite(raw.searchTop)) out.searchTop = Math.max(1, Math.min(10, Math.round(raw.searchTop)))
    return out
  } catch {
    return { ...DEFAULTS }
  }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch }
  try {
    const tmp = CONFIG_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8' })
    renameSync(tmp, CONFIG_FILE)
  } catch { /* best effort，不阻断界面 */ }
  return next
}

// ---------- 统计（只读；扫 memory/ 下卡片） ----------
function stats() {
  const out = {
    root: ROOT,
    cards: 0,
    chars: 0,
    topics: 0,
    longest: { name: '', lines: 0 },
    updatedAt: '',
    findScript: existsSync(FIND_SCRIPT),
    indexFile: existsSync(INDEX_FILE),
  }
  const memDir = join(ROOT, 'memory')
  if (existsSync(memDir)) {
    try {
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name)
          if (e.isDirectory()) { walk(p); continue }
          if (!/\.md$/i.test(e.name)) continue
          out.cards += 1
          try {
            const st = statSync(p)
            if (!out.updatedAt || st.mtime.toISOString() > out.updatedAt) out.updatedAt = st.mtime.toISOString()
            const text = readFileSync(p, 'utf8')
            out.chars += text.length
            const lines = (text.match(/\n/g) || []).length + 1
            if (lines > out.longest.lines) out.longest = { name: e.name, lines }
          } catch { /* 单张卡片读不了不影响整体 */ }
        }
      }
      walk(memDir)
    } catch { /* ignore */ }
  }
  try {
    for (const line of readFileSync(INDEX_FILE, 'utf8').split(/\r?\n/)) {
      if (/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(memory[\\/][^|]+?)\s*\|\s*$/.test(line)) out.topics += 1
    }
  } catch { /* ignore */ }
  const summary = buildSummary()
  out.config = loadConfig()
  out.injectedChars = summary.length
  return out
}

// ---------- 注入摘要（≤ 配置预算；只注索引 + 怎么用） ----------
function readRulesHead() {
  try {
    for (const line of readFileSync(RULES_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*/)
      if (m) return m[2].replace(/\s+/g, ' ').slice(0, 60)
    }
  } catch { /* 记忆库不在就静默降级 */ }
  return ''
}

function buildSummary() {
  const cfg = loadConfig()
  if (!cfg.injectSummary) return ''
  const topics = []
  try {
    for (const line of readFileSync(INDEX_FILE, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(memory[\\/][^|]+?)\s*\|\s*$/)
      if (m) topics.push(`${m[1].trim()}(${m[2].trim().slice(0, 24)})`)
    }
  } catch { return '' }
  if (topics.length === 0) return ''
  const shown = topics.slice(0, 18).join('、')
  const more = topics.length > 18 ? ` 等 ${topics.length} 个主题` : ''
  const rule = readRulesHead()
  let text = [
    `记忆库（外置笔记本，md + Git）：${ROOT}`,
    `主题：${shown}${more}。（完整目录见 INDEX.md）`,
    '要用记忆里的旧结论时，先调 memory_find 检索卡片，别 glob、别盲翻目录；开场接力按 memory-hygiene skill 走。',
    `写入规矩见 RULES.md${rule ? `（开篇第 1 条：${rule}）` : ''}；写卡后无需手动 push，计划任务 MemoryGuard 每 30 分钟自动提交推送。`,
  ].join('\n')
  if (text.length > cfg.injectBudget) text = text.slice(0, cfg.injectBudget - 1) + '…'
  return text
}

// ---------- 检索（走 stdin 传查询，规避 Windows 中文 argv 坑） ----------
function runFind(args, input, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, [FIND_SCRIPT, ...args], { windowsHide: true })
    } catch (error) {
      resolve({ ok: false, text: '', error: String(error?.message ?? error) })
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, timeoutMs)
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { err += chunk.toString('utf8') })
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, text: '', error: String(error?.message ?? error) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, text: out.trim(), error: err.trim() }) })
    try {
      if (typeof input === 'string' && input !== '') child.stdin.end(input, 'utf8')
      else child.stdin.end()
    } catch { /* ignore */ }
  })
}

// ---------- HTTP 路由（设置页数据源） ----------
function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

function health() {
  // 守卫体检日志（Windows 计划任务写入 %LOCALAPPDATA%\memory-guard\memory-guard.log）
  const logFile = join(process.env.LOCALAPPDATA || '', 'memory-guard', 'memory-guard.log')
  const out = { logFile, exists: false, issues: null, notes: null, at: '', detail: '' }
  try {
    if (existsSync(logFile)) {
      const lines = readFileSync(logFile, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '')
      out.exists = true
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = lines[i].match(/^\[([^\]]+)\]\s+issues=(\d+)\s+notes=(\d+)/)
        if (m) { out.at = m[1]; out.issues = Number(m[2]); out.notes = Number(m[3]); break }
      }
      const tail = []
      for (let i = lines.length - 1; i >= 0 && tail.length < 6; i--) {
        if (/^\s+(issue|note):/.test(lines[i])) tail.unshift(lines[i].trim())
      }
      out.detail = tail.join('\n')
    }
  } catch { /* ignore */ }
  return out
}

export function apply(ctx) {
  if (process.env.DSH_MEMORY_LITE_DEBUG === '1') {
    console.log('[memory-lite] apply: 工具 + 摘要 + 设置页(' + ROOT + ')')
  }

  // 1) 工具
  ctx.tools.register({
    name: 'memory_find',
    description: '在鲸鱼娘记忆库（md 卡片 + Git，跨会话长期记忆）里检索。中文按相邻双字词匹配、英文整词，'
      + '按「标题 ×6 / 关键词 ×4 / 正文 ×1」加权排序，返回最相关的卡片路径 + 命中词 + 原文片段，'
      + '随后用 read 打开命中的卡片即可。当需要回忆以前的结论、坑、路径、配置、项目进展时用它，'
      + '比 glob 或逐层翻目录更省 token、更不容易漏。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索词，一次 2~4 个词最好（如「插件 中毒」「片② 方案」）。连写长词会被切成双字词而漏命中。' },
        top: { type: 'number', description: '返回条数，默认取插件设置里的值（初始 5），最大 20。' },
        stats: { type: 'boolean', description: '设为 true 时只返回记忆库概览（卡片总数、字符量、最长卡片），忽略 query。' },
      },
      required: [],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        if (!value || value.ok !== true) return [{ type: 'text', text: `memory_find 调用失败：${(value && value.error) || '未知错误'}\n记忆库根：${ROOT}` }]
        return [{ type: 'text', text: value.text || '（检索无输出）' }]
      },
    },
    timeoutMs: 30_000,
    async execute(args) {
      const cfg = loadConfig()
      if (!cfg.toolEnabled) return { ok: false, error: 'memory_find 已在插件设置里关闭' }
      if (args.stats === true) {
        const r = await runFind(['--stats'], '', 20_000)
        return { ok: r.ok, text: r.text, error: r.ok ? undefined : (r.error || '检索脚本返回非零退出码') }
      }
      const query = String(args.query ?? '').trim()
      if (query === '') return { ok: false, error: '缺少 query（或把 stats 设为 true 看库概览）' }
      const top = Math.max(1, Math.min(Number(args.top ?? cfg.searchTop) || cfg.searchTop, 20))
      const r = await runFind(['--stdin', '--top', String(top)], query, 20_000)
      return { ok: r.ok, text: r.text, error: r.ok ? undefined : (r.error || '检索脚本返回非零退出码'), query }
    },
  })

  // 2) 摘要（每次组装读一遍配置，开关/预算即时生效）
  ctx.systemPrompt.section({
    name: 'memory-lite',
    order: 120,
    text: () => buildSummary(),
  })

  // 3) 设置页数据源
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/${NS}/stats`,
    handler: (req, res) => sendJson(res, 200, { ok: true, stats: stats(), config: loadConfig() }),
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/${NS}/health`,
    handler: (req, res) => sendJson(res, 200, { ok: true, health: health() }),
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/${NS}/config`,
    handler: async (req, res) => {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, config: loadConfig() })
      if (req.method === 'POST') {
        let body = {}
        try { body = JSON.parse(await readBody(req)) || {} } catch { return sendJson(res, 400, { ok: false, error: 'bad-json' }) }
        const patch = {}
        if (typeof body.injectSummary === 'boolean') patch.injectSummary = body.injectSummary
        if (Number.isFinite(body.injectBudget)) patch.injectBudget = body.injectBudget
        if (typeof body.toolEnabled === 'boolean') patch.toolEnabled = body.toolEnabled
        if (Number.isFinite(body.searchTop)) patch.searchTop = body.searchTop
        return sendJson(res, 200, { ok: true, config: saveConfig(patch) })
      }
      return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
    },
  }))
}
