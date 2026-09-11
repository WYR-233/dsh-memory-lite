// dsh-memory-lite — read-only enhancer for a file-based (markdown + git) memory library.
//
// What it does
//   1) memory_find tool      — search the memory library's cards via its own search script
//                              (saves tokens; better than glob or walking folders)
//   2) systemPrompt section  — a small, budgeted digest: where the library is, which topics
//                              exist, and "search before guessing"
//   3) settings page         — overview / health / toggles; host side is read-only stats
//                              plus a tiny runtime config
//
// Design rules
//   · The library content is READ-ONLY: no card writes, no commits, no pushes.
//   · Runtime config lives in <stateDir>/config.json (atomic write; parse failure falls back
//     to defaults — never silently wipes values).
//   · Injection is append-only: one extra systemPrompt section, never rewrites history.
//   · Hard budget: injected text stays within the configured character budget (default 900).
//
// Configuration (plugin config / cordis.patch.yml)
//   memoryRoot?    absolute path of the memory library (else env DSH_MEMORY_ROOT)
//   stateDir?      where this plugin's own config.json lives (default $DSH_HOME/memory-lite)
//   searchScript?  relative path of the search script (default tools/memory-find.mjs)
//   indexFile?     relative path of the topic index   (default INDEX.md)
//   searchArgs?    extra argv passed to the search script (optional)
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export const name = 'dsh-memory-lite'
export const inject = ['tools', 'systemPrompt', 'webServer']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const config = {
  memoryRoot: '',
  stateDir: '',
  searchScript: 'tools/memory-find.mjs',
  indexFile: 'INDEX.md',
  searchArgs: [],
}

const DEFAULTS = {
  injectSummary: true,
  injectBudget: 900,
  toolEnabled: true,
  searchTop: 5,
}

export function apply(ctx, pluginConfig) {
  const cfg = { ...config, ...(pluginConfig || {}) }
  const memoryRoot = resolveRoot(cfg)
  const stateDir = resolveDir(cfg.stateDir) || join(HOME, 'memory-lite')
  const configFile = join(stateDir, 'config.json')
  const indexPath = memoryRoot ? join(memoryRoot, cfg.indexFile) : ''
  const searchScript = memoryRoot ? join(memoryRoot, cfg.searchScript) : ''

  if (process.env.DSH_MEMORY_LITE_DEBUG === '1') {
    console.log('[dsh-memory-lite] apply: root=' + (memoryRoot || '(not configured)') + ' stateDir=' + stateDir)
  }

  // ---------- runtime config ----------
  // performance: memoize config + summary so prompt assembly does not re-read files every step.
  // Invalidated by mtime, so hand-editing the config or the index still takes effect immediately.
  let cfgCache = null
  let cfgCacheMtime = -1
  let cfgCacheAt = 0
  let summaryCache = null
  let summaryCacheAt = 0
  const loadConfig = () => {
    try {
      let mtimeMs = -1
      try { mtimeMs = statSync(configFile).mtimeMs } catch { /* missing file is normal */ }
      const now = Date.now()
      if (cfgCache !== null && mtimeMs === cfgCacheMtime && now - cfgCacheAt < 60_000) return { ...cfgCache }
      const raw = JSON.parse(readFileSync(configFile, 'utf8'))
      if (raw === null || typeof raw !== 'object') return { ...DEFAULTS }
      const out = { ...DEFAULTS }
      if (typeof raw.injectSummary === 'boolean') out.injectSummary = raw.injectSummary
      if (Number.isFinite(raw.injectBudget)) out.injectBudget = clamp(raw.injectBudget, 200, 2000)
      if (typeof raw.toolEnabled === 'boolean') out.toolEnabled = raw.toolEnabled
      if (Number.isFinite(raw.searchTop)) out.searchTop = clamp(raw.searchTop, 1, 10)
      cfgCache = { ...out }
      cfgCacheMtime = mtimeMs
      cfgCacheAt = now
      return out
    } catch {
      return { ...DEFAULTS }
    }
  }
  const saveConfig = (patch) => {
    const next = { ...loadConfig(), ...patch }
    try {
      if (!existsSync(stateDir)) { try { writeFileSync(join(stateDir, '.keep'), '') } catch { /* ignore */ } }
      const tmp = configFile + '.tmp'
      writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8' })
      renameSync(tmp, configFile)
      cfgCache = { ...next }
      try { cfgCacheMtime = statSync(configFile).mtimeMs } catch { cfgCacheMtime = -1 }
      cfgCacheAt = Date.now()
      summaryCache = null
    } catch { /* best effort — never blocks the UI */ }
    return next
  }

  // ---------- stats (read-only scan) ----------
  const stats = () => {
    const out = {
      root: memoryRoot,
      configured: memoryRoot !== '',
      cards: 0,
      chars: 0,
      topics: 0,
      longest: { name: '', lines: 0 },
      updatedAt: '',
      searchScript: memoryRoot !== '' && existsSync(searchScript),
      indexFile: memoryRoot !== '' && existsSync(indexPath),
      stateDir,
      configFile,
    }
    const memDir = memoryRoot ? join(memoryRoot, 'memory') : ''
    if (memDir && existsSync(memDir)) {
      try {
        const walk = (dir) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name)
            if (entry.isDirectory()) { walk(p); continue }
            if (!/\.md$/i.test(entry.name)) continue
            out.cards += 1
            try {
              const st = statSync(p)
              if (!out.updatedAt || st.mtime.toISOString() > out.updatedAt) out.updatedAt = st.mtime.toISOString()
              const text = readFileSync(p, 'utf8')
              out.chars += text.length
              const lines = (text.match(/\n/g) || []).length + 1
              if (lines > out.longest.lines) out.longest = { name: entry.name, lines }
            } catch { /* one unreadable card must not break the scan */ }
          }
        }
        walk(memDir)
      } catch { /* ignore */ }
    }
    out.topics = readTopics().length
    const summary = buildSummary()
    out.config = loadConfig()
    out.injectedChars = summary.length
    return out
  }

  // ---------- summary (budgeted, generic wording) ----------
  const readTopics = () => {
    const topics = []
    if (!indexPath) return topics
    try {
      for (const line of readFileSync(indexPath, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]+?)\s*\|\s*$/)
        if (m && !/^:?-+/.test(m[1])) topics.push({ name: m[1].trim(), note: m[2].trim() })
      }
    } catch { /* no index yet */ }
    return topics
  }

  const buildSummary = (force) => {
    const cfgNow = loadConfig()
    if (!cfgNow.injectSummary || !memoryRoot) return ''
    const now = Date.now()
    // performance: the digest is re-assembled on every prompt build — cache it briefly so a long
    // turn does not re-read INDEX.md dozens of times. Config edits clear the cache explicitly.
    if (!force && summaryCache !== null && now - summaryCacheAt < 30_000) return summaryCache
    const topics = readTopics()
    if (topics.length === 0) { summaryCache = ''; summaryCacheAt = now; return '' }
    const MAX_TOPICS = 18
    // perf/token: topic NAMES only (they carry the search vocabulary) — the parenthetical notes
    // were ~40% of the digest and are already discoverable through the index file.
    const shown = topics.slice(0, MAX_TOPICS).map((t) => t.name).join(', ')
    const more = topics.length > MAX_TOPICS ? ` (+${topics.length - MAX_TOPICS} more)` : ''
    let text = [
      `Memory library (markdown + git): ${memoryRoot}`,
      `Topics: ${shown}${more}.`,
      'Need a past decision, bug, path or config? Search it with the memory_find tool instead of guessing or walking the folder tree.',
    ].join('\n')
    if (text.length > cfgNow.injectBudget) text = text.slice(0, cfgNow.injectBudget - 1) + '…'
    summaryCache = text
    summaryCacheAt = now
    return text
  }

  // ---------- search (query goes through stdin) ----------
  const runSearch = (args, input, timeoutMs) => new Promise((resolve) => {
    if (!memoryRoot || !existsSync(searchScript)) {
      resolve({ ok: false, text: '', error: 'memory library not configured or search script missing' })
      return
    }
    let child
    try {
      child = spawn(process.execPath, [searchScript, ...args], { windowsHide: true })
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

  // ---------- health (optional external checker log; path is configurable) ----------
  const health = () => {
    const logFile = process.env.MEMORY_LITE_HEALTH_LOG || ''
    const out = { logFile, exists: false, issues: null, notes: null, at: '', detail: '' }
    if (logFile === '') return out
    try {
      if (!existsSync(logFile)) return out
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
    } catch { /* ignore */ }
    return out
  }

  // ---------- HTTP routes (settings page data source) ----------
  const sendJson = (res, code, obj) => {
    const body = Buffer.from(JSON.stringify(obj), 'utf8')
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length })
    res.end(body)
  }
  const readBody = (req) => new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })

  // ---------- tool ----------
  ctx.tools.register({
    name: 'memory_find',
    description: 'Search the configured long-term memory library (markdown cards kept in git). '
      + 'Matches terms adjacently: CJK by friendliness bigrams, Latin by whole words, weighted by '
      + 'title ×6 / keywords ×4 / body ×1, and returns the most relevant card paths with matched terms '
      + 'and a snippet — then open the card with read. Use it whenever you need a past decision, bug, '
      + 'path, config or project status instead of guessing, globbing, or walking the folder tree.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms — 2-4 words work best (e.g. "plugin crash", "MiniMax TTS"). Long unbroken CJK strings are split into bigrams and may miss.' },
        top: { type: 'number', description: 'How many cards to return (default: the plugin setting, initially 5; max 20).' },
        stats: { type: 'boolean', description: 'When true, return a library overview (card count, characters, longest card) and ignore query.' },
      },
      required: [],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        if (!value || value.ok !== true) {
          const hint = memoryRoot
            ? `Memory library: ${memoryRoot}`
            : 'Memory library is not configured yet — set the plugin option `memoryRoot` (or the DSH_MEMORY_ROOT env var).'
          return [{ type: 'text', text: `memory_find failed: ${(value && value.error) || 'unknown error'}\n${hint}` }]
        }
        return [{ type: 'text', text: value.text || '(no output)' }]
      },
    },
    timeoutMs: 30_000,
    async execute(args) {
      const cfgNow = loadConfig()
      if (!cfgNow.toolEnabled) return { ok: false, error: 'memory_find is disabled in the plugin settings' }
      if (args.stats === true) {
        const r = await runSearch(['--stats'], '', 20_000)
        return { ok: r.ok, text: r.text, error: r.ok ? undefined : (r.error || 'search script exited non-zero') }
      }
      const query = String(args.query ?? '').trim()
      if (query === '') return { ok: false, error: 'missing query (or set stats: true for a library overview)' }
      const top = clamp(Number(args.top ?? cfgNow.searchTop) || cfgNow.searchTop, 1, 20)
      const r = await runSearch(['--stdin', '--top', String(top)], query, 20_000)
      return { ok: r.ok, text: r.text, error: r.ok ? undefined : (r.error || 'search script exited non-zero'), query }
    },
  })

  // ---------- summary section (re-read each assembly → toggles take effect immediately) ----------
  ctx.systemPrompt.section({
    name: NS,
    order: 120,
    text: () => buildSummary(),
  })

  // ---------- settings routes ----------
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
        if (Number.isFinite(body.injectBudget)) patch.injectBudget = clamp(body.injectBudget, 200, 2000)
        if (typeof body.toolEnabled === 'boolean') patch.toolEnabled = body.toolEnabled
        if (Number.isFinite(body.searchTop)) patch.searchTop = clamp(body.searchTop, 1, 10)
        return sendJson(res, 200, { ok: true, config: saveConfig(patch) })
      }
      return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
    },
  }))
}

// ---------- helpers ----------
const NS = 'memory-lite'

function clamp(value, min, max) {
  const n = Math.round(Number(value))
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min))
}

function resolveDir(value) {
  const v = String(value ?? '').trim()
  return v === '' ? '' : (isAbsolute(v) ? v : join(HOME, v))
}

function resolveRoot(cfg) {
  const fromConfig = resolveDir(cfg.memoryRoot)
  if (fromConfig !== '' && existsSync(fromConfig)) return fromConfig
  const fromEnv = resolveDir(process.env.DSH_MEMORY_ROOT)
  if (fromEnv !== '' && existsSync(fromEnv)) return fromEnv
  return fromConfig || fromEnv || ''
}
