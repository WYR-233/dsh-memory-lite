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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { libraryStats, searchLibrary } from './search.js'

export const name = 'dsh-memory-lite'
export const inject = ['tools', 'systemPrompt', 'webServer']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const config = {
  memoryRoot: '',
  stateDir: '',
  searchScript: 'tools/memory-find.mjs',
  indexFile: 'INDEX.md',
  searchArgs: [],
  // 0.4.0：检索默认走**内置实现**（零依赖：用户不必先有外部脚本）。
  // 'script' = 只用配置的 searchScript；'auto' = 有脚本就用脚本，否则内置。
  searchMode: 'builtin',
  skipDirs: [],              // 额外跳过的目录（archive / node_modules / .git 默认已跳过）
  commandName: 'memory',     // 斜杠命令名（/memory …）
  skillEnabled: true,        // 注册自带的 memory-library skill
  // 2026-10-11 治理仪表盘：常读文件（开场税）、可触发脚本与外部链接 —— **全走配置**。
  // 代码里不留任何个人路径或私有域名：未配置的块在面板上显示「—」，不会报错。
  taxFiles: [],              // 开场税要统计的文件（相对 memoryRoot）
  guardScript: '',           // 「立即体检」按钮要跑的脚本（绝对路径或 ~/…）
  backupScript: '',          // 「立即备份」按钮要跑的脚本
  backupDir: '',             // 备份产物目录（面板显示最新一份）
  guardLog: '',              // 守卫日志（面板显示上次运行）
  coldDir: 'archive',        // 冷区目录（相对 memoryRoot），不进索引/检索
  synonymFile: '',           // 可选：同义词表（相对 memoryRoot），用于「同义词组数」
  consolidationDir: '',      // 可选：巩固卡目录（上次巩固时间来源之一）
  siteUrl: '',               // 可选：记忆库网页地址；留空则面板不显示「打开网页」按钮
}

const DEFAULTS = {
  memoryRoot: '',
  injectSummary: true,
  injectBudget: 900,
  toolEnabled: true,
  searchTop: 5,
  // 2026-10-11：治理仪表盘 —— 开场税预算与可调阈值
  taxBudget: 30000,
  upkeepDays: 21,
  upkeepCards: 8,
  upkeepHardDays: 90,
}

export function apply(ctx, pluginConfig) {
  const cfg = { ...config, ...(pluginConfig || {}) }
  const stateDir = resolveDir(cfg.stateDir) || join(HOME, 'memory-lite')
  const configFile = join(stateDir, 'config.json')

  // 优先级的真相源：**运行时配置 > profile 插件配置 > 环境变量**。
  // 运行时配置存在本机 $DSH_HOME 下（各端各一份），所以在两个系统上用同一个插件不会互相打架；
  // 路径永远是「本机绝对路径」（面板里点选得到），跨端不需要写两套。
  const readRuntimeRoot = () => {
    try {
      const raw = JSON.parse(readFileSync(configFile, 'utf8'))
      const v = raw && typeof raw.memoryRoot === 'string' ? raw.memoryRoot.trim() : ''
      return v === '' ? '' : resolveDir(v)
    } catch { return '' }
  }
  const runtimeRoot = readRuntimeRoot()
  let memoryRoot = runtimeRoot !== '' && existsSync(runtimeRoot) ? runtimeRoot : resolveRoot(cfg)
  let indexPath = memoryRoot ? join(memoryRoot, cfg.indexFile) : ''
  let searchScript = memoryRoot ? join(memoryRoot, cfg.searchScript) : ''

  if (process.env.DSH_MEMORY_LITE_DEBUG === '1') {
    console.log('[dsh-memory-lite] apply: root=' + (memoryRoot || '(not configured)') + ' stateDir=' + stateDir)
  }

  // ---------- runtime config ----------
  const loadConfig = () => {
    try {
      const raw = JSON.parse(readFileSync(configFile, 'utf8'))
      if (raw === null || typeof raw !== 'object') return { ...DEFAULTS }
      const out = { ...DEFAULTS }
      if (typeof raw.memoryRoot === 'string') out.memoryRoot = raw.memoryRoot.slice(0, 500)
      if (typeof raw.injectSummary === 'boolean') out.injectSummary = raw.injectSummary
      if (Number.isFinite(raw.injectBudget)) out.injectBudget = clamp(raw.injectBudget, 200, 2000)
      if (typeof raw.toolEnabled === 'boolean') out.toolEnabled = raw.toolEnabled
      if (Number.isFinite(raw.searchTop)) out.searchTop = clamp(raw.searchTop, 1, 10)
      if (Number.isFinite(raw.taxBudget)) out.taxBudget = clamp(raw.taxBudget, 5000, 200000)
      if (Number.isFinite(raw.upkeepDays)) out.upkeepDays = clamp(raw.upkeepDays, 1, 365)
      if (Number.isFinite(raw.upkeepCards)) out.upkeepCards = clamp(raw.upkeepCards, 1, 200)
      if (Number.isFinite(raw.upkeepHardDays)) out.upkeepHardDays = clamp(raw.upkeepHardDays, 7, 365)
      return out
    } catch {
      return { ...DEFAULTS }
    }
  }
  const saveConfig = (patch) => {
    const next = { ...loadConfig(), ...patch }
    try {
      // 目录可能还不存在：必须**真的建目录**再写，否则整次写入会静默失败
      //（2026-10-11 实测：面板里配好的库路径重启后丢失，根因就是这里的写文件失败被 catch 吞掉）。
      try { mkdirSync(stateDir, { recursive: true }) } catch { /* ignore */ }
      const tmp = configFile + '.tmp'
      writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8' })
      renameSync(tmp, configFile)
    } catch { /* best effort — never blocks the UI */ }
    return next
  }

  // ---------- scan (read-only, 60s cache) ----------
  // 2026-10-11 片④：顺带算「维护闹钟」需要的量（改动卡数 / 超长卡 / 距上次巩固天数）
  let scanCache = { at: 0, data: null }
  let consolidationDir = memoryRoot && cfg.consolidationDir ? join(memoryRoot, cfg.consolidationDir) : ''
  let coldDir = memoryRoot && cfg.coldDir ? join(memoryRoot, cfg.coldDir) : ''

  // 面板里改库路径：写运行时配置 + 立刻重算所有派生值（不需要重启 DSH）
  const applyRoot = (next) => {
    const p = resolveDir(String(next ?? ''))
    if (p === '' || !existsSync(p)) {
      saveConfig({ memoryRoot: '' })
      memoryRoot = resolveRoot(cfg)
    } else {
      saveConfig({ memoryRoot: p })
      memoryRoot = p
    }
    indexPath = memoryRoot ? join(memoryRoot, cfg.indexFile) : ''
    searchScript = memoryRoot ? join(memoryRoot, cfg.searchScript) : ''
    consolidationDir = memoryRoot && cfg.consolidationDir ? join(memoryRoot, cfg.consolidationDir) : ''
    coldDir = memoryRoot && cfg.coldDir ? join(memoryRoot, cfg.coldDir) : ''
    scanCache = { at: 0, data: null }
    gitCache = { at: 0, data: null }
    backupCache = { at: 0, data: null }
    return memoryRoot
  }

  // ---------- 库目录校验 / 一键建库 / 跨端提示（0.4.0）----------

  // 跨端：路径永远存「本机绝对路径」（面板里点选得到）。如果看到的是另一端的形态
  // （Linux 上出现 D:\… ，Windows 上出现 /home/…），就明确提示换个本地路径，
  // 而不是让插件神秘失灵。`~` 由 homedir() 展开，两端写同一种写法。
  const pathHint = (p) => {
    const v = String(p ?? '').trim()
    if (v === '') return 'empty'
    const winStyle = /^[A-Za-z]:[\\/]/.test(v) || v.includes('\\')
    if (process.platform === 'win32') return (!winStyle && v.startsWith('/') && !existsSync(v)) ? 'other-platform' : ''
    return (winStyle && !existsSync(v)) ? 'other-platform' : ''
  }

  const validateDir = (dir) => {
    const p = resolveDir(dir)
    const out = { dir: p, exists: false, writable: false, looksLikeLibrary: false, entries: 0, hint: '', platform: process.platform }
    out.hint = pathHint(p)
    if (p === '') return out
    try {
      out.exists = existsSync(p)
      if (!out.exists) return out
      out.entries = readdirSync(p).length
      out.looksLikeLibrary = existsSync(join(p, cfg.indexFile)) || existsSync(join(p, 'memory'))
      const probe = join(p, '.memory-lite-write-probe')
      try {
        writeFileSync(probe, '')
        unlinkSync(probe)
        out.writable = true
      } catch { out.writable = false }
    } catch { /* ignore */ }
    return out
  }

  // 骨架只补缺、绝不覆盖：用户已有的 INDEX.md / 使用说明 一律保留。
  const scaffold = (dir) => {
    const created = []
    const put = (rel, content) => {
      const target = join(dir, rel)
      if (existsSync(target)) return
      try {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content, 'utf8')
        created.push(rel)
      } catch { /* one bad file must not abort the scaffold */ }
    }
    put(cfg.indexFile, [
      '# 记忆总目录',
      '',
      '> 用法：一行一个主题。开场先读本索引，再按需进入 `memory/<主题>/` 翻卡片。',
      '> 卡片就是普通 markdown；过时的卡移到 `archive/`（冷区，不参与检索）。',
      '',
      '| 主题 | 说明 | 位置 |',
      '| --- | --- | --- |',
      '| 示例主题 | 这个主题收什么卡（写一句） | memory/示例主题/ |',
      '',
    ].join('\n'))
    put('使用说明.md', [
      '# 这个文件夹是「记忆库」',
      '',
      '- 卡片＝普通 markdown 文件，放在 `memory/<主题>/` 下，文件名建议 `YYYY-MM-DD_简短标题.md`',
      '- 每张卡建议五段：标题 / 日期 / 背景 / 结论 / 关键词',
      '- 记忆库插件会：开场读 `INDEX.md`、检索时按关键词与同义词找卡、在设置页里显示健康度',
      '- 维护三条：单卡 ≤60 行｜单主题超 50 张压成 `历史摘要.md`｜过时的卡移 `archive/`',
      '- 写卡交给你的 agent：直接说「把这次的结论记进记忆库」即可',
      '',
    ].join('\n'))
    put('memory/示例主题/0000-00-00_示例卡.md', [
      '# 示例卡：标题写清「做了什么 + 结论」',
      '- 日期：0000-00-00',
      '- 背景：一句话说清为什么做这件事',
      '- 结论：要点式；写清结果、踩过的坑、下次怎么做',
      '- 关键词：换成你的词 方便以后被搜到',
      '',
    ].join('\n'))
    return created
  }

  // 卡片清单：一次遍历，超长卡 / 主题分布 / 今日新增 / 标题重复 / 降级候选全部复用
  const listCards = () => {
    const cards = []
    const memDir = memoryRoot ? join(memoryRoot, 'memory') : ''
    if (!memDir || !existsSync(memDir)) return cards
    const walk = (dir, rel) => {
      let entries = []
      try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const p = join(dir, entry.name)
        const r = rel === '' ? entry.name : `${rel}/${entry.name}`
        if (entry.isDirectory()) { walk(p, r); continue }
        if (!/\.md$/i.test(entry.name)) continue
        try {
          const st = statSync(p)
          const text = readFileSync(p, 'utf8')
          cards.push({
            rel: r,
            name: entry.name,
            title: text.split(/\r?\n/).slice(0, 3).join(' ').replace(/^#+\s*/, '').trim().slice(0, 80),
            lines: (text.match(/\n/g) || []).length + 1,
            bytes: st.size,
            chars: text.length,
            mtimeMs: st.mtimeMs,
            mtime: st.mtime.toISOString(),
            // 粗略的「已收官」信号：治理扫描据此给出降级候选（最终由人工确认）
            finished: /已结项|结项|已完工|已归档|退场到|archive\//.test(text.slice(0, 6000)),
          })
        } catch { /* one unreadable card must not break the scan */ }
      }
    }
    walk(memDir, '')
    return cards
  }

  const countMd = (dir) => {
    let n = 0
    if (!dir || !existsSync(dir)) return 0
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) n += countMd(join(dir, e.name))
        else if (/\.md$/i.test(e.name)) n += 1
      }
    } catch { /* ignore */ }
    return n
  }

  const brief = (c) => ({ name: c.name, rel: c.rel, lines: c.lines, kb: Math.round(c.bytes / 1024) })

  const lastConsolidationMs = () => {
    let ms = 0
    try {
      if (consolidationDir && existsSync(consolidationDir)) {
        for (const e of readdirSync(consolidationDir, { withFileTypes: true })) {
          if (!e.isFile() || !/\.md$/i.test(e.name)) continue
          const m = statSync(join(consolidationDir, e.name)).mtimeMs
          if (m > ms) ms = m
        }
      }
    } catch { /* ignore */ }
    try {
      const raw = JSON.parse(readFileSync(join(stateDir, 'upkeep.json'), 'utf8'))
      const t = Date.parse(raw && raw.lastConsolidation ? raw.lastConsolidation : '')
      if (Number.isFinite(t) && t > ms) ms = t
    } catch { /* no record */ }
    return ms
  }

  const scan = () => {
    if (scanCache.data && Date.now() - scanCache.at < 60_000) return scanCache.data
    const lastMs = lastConsolidationMs()
    const cards = listCards()
    const today = new Date().toISOString().slice(0, 10)
    const topicsMap = new Map()
    const byTitle = new Map()
    const oversizeList = []
    let chars = 0, updatedAt = '', recentCards = 0, todayNew = 0, longestName = '', longestLines = 0
    for (const c of cards) {
      chars += c.chars
      if (!updatedAt || c.mtime > updatedAt) updatedAt = c.mtime
      if (lastMs && c.mtimeMs > lastMs) recentCards += 1
      if (c.mtime.slice(0, 10) === today) todayNew += 1
      if (c.lines > longestLines) { longestLines = c.lines; longestName = c.name }
      const key = c.rel.split('/')[1] || c.rel.split('/')[0] || '(root)'
      topicsMap.set(key, (topicsMap.get(key) || 0) + 1)
      if (c.lines > 60 || c.bytes > 8192) oversizeList.push(c)
      if (c.title) {
        const arr = byTitle.get(c.title) || []
        arr.push(c.rel)
        byTitle.set(c.title, arr)
      }
    }
    oversizeList.sort((a, b) => b.lines - a.lines || b.bytes - a.bytes)
    const topicsDist = [...topicsMap.entries()]
      .map(([tname, count]) => ({ name: tname, count }))
      .sort((a, b) => b.count - a.count)
    const out = {
      cards: cards.length, chars,
      longest: { name: longestName, lines: longestLines },
      updatedAt,
      oversize: oversizeList.length, oversizeList: oversizeList.slice(0, 5).map(brief),
      recentCards, todayNew, topicsDist, cold: countMd(coldDir),
      dupTitles: [...byTitle.entries()]
        .filter(([, files]) => files.length > 1)
        .map(([title, files]) => ({ title, count: files.length, files: files.slice(0, 5) })),
      over50: topicsDist.filter((t) => t.count > 50),
      lastConsolidation: lastMs ? new Date(lastMs).toISOString().slice(0, 10) : '',
      daysSinceConsolidation: lastMs ? Math.floor((Date.now() - lastMs) / 86_400_000) : -1,
    }
    scanCache = { at: Date.now(), data: out }
    return out
  }

  // ---------- stats ----------
  const stats = () => {
    const s = scan()
    const out = {
      root: memoryRoot,
      configured: memoryRoot !== '',
      cards: s.cards,
      chars: s.chars,
      topics: readTopics().length,
      longest: s.longest,
      updatedAt: s.updatedAt,
      oversize: s.oversize,
      recentCards: s.recentCards,
      lastConsolidation: s.lastConsolidation,
      daysSinceConsolidation: s.daysSinceConsolidation,
      searchScript: memoryRoot !== '' && existsSync(searchScript),
      indexFile: memoryRoot !== '' && existsSync(indexPath),
      stateDir,
      configFile,
    }
    out.config = loadConfig()
    out.injectedChars = buildSummary().length
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

  const buildSummary = () => {
    const cfgNow = loadConfig()
    if (!cfgNow.injectSummary) return ''
    if (memoryRoot === '') {
      // 装上了但还没配库：不能静默，否则用户永远不知道这个插件在等他做一件事
      const tip = 'A memory-library plugin is installed but no library folder is configured yet. '
        + 'Tell the user they can open Settings → Memory library and either pick an existing folder or create a new library in one click; '
        + 'after that, look things up with the memory_find tool before guessing.'
      return tip.length > cfgNow.injectBudget ? tip.slice(0, cfgNow.injectBudget - 1) + '…' : tip
    }
    const topics = readTopics()
    if (topics.length === 0) return ''
    const shown = topics.slice(0, 18).map((t) => (t.note ? `${t.name} (${t.note.slice(0, 24)})` : t.name)).join(', ')
    const more = topics.length > 18 ? `, +${topics.length - 18} more` : ''
    let text = [
      `Memory library (markdown + git): ${memoryRoot}`,
      `Topics: ${shown}${more}. Full index: ${cfg.indexFile}.`,
      `When you need a past decision, bug, path or config, search it first with the memory_find tool instead of guessing or walking the folder tree.`,
    ].join('\n')
    const hint = upkeepHint()
    if (hint) text += '\n' + hint
    if (text.length > cfgNow.injectBudget) text = text.slice(0, cfgNow.injectBudget - 1) + '…'
    return text
  }

  // ---------- upkeep 闹钟（2026-10-11 片④）----------
  // 活跃度驱动：攒够料才提醒（>21 天且期间改动 ≥8 张卡；或 >90 天保底），静默期完全不打扰。
  const upkeepHint = () => {
    const cfgNow = loadConfig()
    const s = scan()
    const days = s.daysSinceConsolidation
    if (days < 0) return ''                       // 从未巩固过：先不打扰
    if (!upkeepDue(s, cfgNow)) return ''
    const bits = [`Memory upkeep: ${s.recentCards} cards changed since last consolidation (${days} days ago).`]
    if (s.oversize > 0) bits.push(`${s.oversize} oversized card(s) (>60 lines or >8KB).`)
    bits.push('Consider a consolidation pass: read the changed cards, write ONE summary card, demote finished ones.')
    return bits.join(' ')
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

  // ---------- 统一检索入口（0.4.0：内置优先，外部脚本可选）----------
  const synonymPath = () => (cfg.synonymFile && memoryRoot ? join(memoryRoot, cfg.synonymFile) : '')

  const doSearch = async ({ query, top = 5, full = false, pathFilter = '' }) => {
    const mode = String(cfg.searchMode || 'builtin')
    const scriptReady = memoryRoot !== '' && existsSync(searchScript)
    const useScript = mode === 'script' || (mode === 'auto' && scriptReady)
    if (!useScript) {
      if (memoryRoot === '') {
        return { ok: false, text: '', error: 'memory library is not configured yet (set memoryRoot in the plugin settings or DSH_MEMORY_ROOT)', mode: 'builtin' }
      }
      try {
        const r = searchLibrary({ root: memoryRoot, query, top, full, skipDirs: cfg.skipDirs, synonymFile: synonymPath(), pathFilter })
        const out = { ok: r.ok === true, text: r.text || '', mode: 'builtin' }
        if (out.ok) out.count = r.count
        else out.error = r.error || 'search failed'
        return out
      } catch (error) {
        return { ok: false, text: '', error: String(error?.message ?? error), mode: 'builtin' }
      }
    }
    const args = ['--stdin', '--top', String(top)]
    if (full) args.push('--full')
    if (pathFilter) args.push('--path', pathFilter)
    if (Array.isArray(cfg.searchArgs)) args.push(...cfg.searchArgs.map(String))
    const r = await runSearch(args, query, 20_000)
    const out = { ok: r.ok === true, text: r.text || '', mode: 'script' }
    if (!out.ok) out.error = r.error || 'search script exited non-zero'
    return out
  }

  const doStats = async () => {
    const mode = String(cfg.searchMode || 'builtin')
    const scriptReady = memoryRoot !== '' && existsSync(searchScript)
    const useScript = mode === 'script' || (mode === 'auto' && scriptReady)
    if (!useScript) {
      if (memoryRoot === '') return { ok: false, text: '', error: 'memory library is not configured yet', mode: 'builtin' }
      try {
        const s = libraryStats({ root: memoryRoot, skipDirs: cfg.skipDirs })
        return { ok: true, text: s.text, cards: s.cards, chars: s.chars, mode: 'builtin' }
      } catch (error) {
        return { ok: false, text: '', error: String(error?.message ?? error), mode: 'builtin' }
      }
    }
    const r = await runSearch(['--stats'], '', 20_000)
    const out = { ok: r.ok === true, text: r.text || '', mode: 'script' }
    if (!out.ok) out.error = r.error || 'search script exited non-zero'
    return out
  }

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

  // ---------- 治理仪表盘数据块（2026-10-11 扩展）----------
  const expandHome = (p) => {
    const v = String(p ?? '').trim()
    if (v === '') return ''
    return v.startsWith('~/') ? join(homedir(), v.slice(2)) : v
  }

  // 通用子进程执行（脚本按钮 / git 都用它；超时必杀，绝不留僵尸）
  const runProcess = (cmd, args, timeoutMs) => new Promise((resolve) => {
    let child
    try { child = spawn(cmd, args, { windowsHide: true }) } catch (error) {
      resolve({ ok: false, code: -1, out: '', err: String(error?.message ?? error) })
      return
    }
    let out = '', err = ''
    const timer = setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, timeoutMs)
    child.stdout.on('data', (c) => { out += c.toString('utf8') })
    child.stderr.on('data', (c) => { err += c.toString('utf8') })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: -1, out, err: String(e?.message ?? e) }) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code: code ?? -1, out: out.trim(), err: err.trim() }) })
  })

  const upkeepDue = (s, cfgNow) => s.daysSinceConsolidation >= 0
    && ((s.daysSinceConsolidation >= cfgNow.upkeepDays && s.recentCards >= cfgNow.upkeepCards)
      || s.daysSinceConsolidation >= cfgNow.upkeepHardDays)

  // ① 开场税：每个常读文件的字符数 + 合计 vs 预算
  const taxFile = join(stateDir, 'trend.json')
  const readTrend = () => {
    try {
      const raw = JSON.parse(readFileSync(taxFile, 'utf8'))
      return Array.isArray(raw) ? raw.filter((x) => x && typeof x.at === 'string') : []
    } catch { return [] }
  }
  const writeTrend = (list) => { try { writeFileSync(taxFile, JSON.stringify(list.slice(-180), null, 2) + '\n', 'utf8') } catch { /* ignore */ } }

  // 趋势快照：每次打开面板记一个点（6 小时窗口内只刷新数值，免得曲线被刷新按钮刷爆）
  const trendSnapshot = (taxChars) => {
    const now = Date.now()
    let list = readTrend()
    const last = list[list.length - 1]
    if (last && now - Date.parse(last.at) < 6 * 3_600_000) {
      if (last.taxChars !== taxChars) { last.taxChars = taxChars; writeTrend(list) }
    } else {
      list.push({ at: new Date(now).toISOString(), taxChars })
      list = list.slice(-180)
      writeTrend(list)
    }
    let base = null
    for (const item of list) {
      const t = Date.parse(item.at)
      if (Number.isFinite(t) && t <= now - 6.5 * 86_400_000) base = item
    }
    if (!base) return { points: list.length, baselineAt: '', baselineChars: null, delta: null }
    return { points: list.length, baselineAt: base.at, baselineChars: base.taxChars, delta: taxChars - base.taxChars }
  }

  const tax = () => {
    const cfgNow = loadConfig()
    const files = (Array.isArray(cfg.taxFiles) ? cfg.taxFiles : []).map((rel) => {
      const p = memoryRoot ? join(memoryRoot, rel) : ''
      let chars = 0, exists = false
      try { if (p !== '' && existsSync(p)) { chars = readFileSync(p, 'utf8').length; exists = true } } catch { /* ignore */ }
      return { rel, name: String(rel).split('/').pop(), chars, exists }
    })
    const total = files.reduce((a, f) => a + f.chars, 0)
    const budget = cfgNow.taxBudget
    return {
      files, total, budget,
      pct: budget > 0 ? Math.round((total / budget) * 100) : 0,
      remaining: budget - total,
      tokens: Math.round(total / 3.2),
      trend: trendSnapshot(total),
    }
  }

  // ⑤a 记忆库 git：未提交数 + 最后提交
  let gitCache = { at: 0, data: null }
  const gitInfo = async () => {
    if (gitCache.data && Date.now() - gitCache.at < 90_000) return gitCache.data
    const out = { ok: false, dirty: 0, files: [], lastCommit: null, error: '' }
    if (memoryRoot === '') return out
    const st = await runProcess('git', ['-C', memoryRoot, 'status', '--porcelain'], 8000)
    if (!st.ok) {
      out.error = st.err || 'git status failed'
      return out
    }
    out.ok = true
    const lines = st.out === '' ? [] : st.out.split(/\r?\n/).filter((l) => l.trim() !== '')
    out.dirty = lines.length
    out.files = lines.slice(0, 5)
    const lg = await runProcess('git', ['-C', memoryRoot, 'log', '-1', '--format=%h|%cI|%s'], 8000)
    if (lg.ok && lg.out !== '') {
      const parts = lg.out.split('|')
      out.lastCommit = { hash: parts[0] || '', at: parts[1] || '', subject: (parts[2] || '').slice(0, 80) }
    }
    gitCache = { at: Date.now(), data: out }
    return out
  }

  // ⑤b 备份：最新产物（时间 + 体积）+ 份数
  let backupCache = { at: 0, data: null }
  const backupInfo = (force) => {
    if (!force && backupCache.data && Date.now() - backupCache.at < 60_000) return backupCache.data
    const dir = expandHome(cfg.backupDir)
    const out = { dir, exists: false, count: 0, latest: null }
    try {
      if (dir !== '' && existsSync(dir)) {
        out.exists = true
        const files = readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => { const st = statSync(join(dir, e.name)); return { name: e.name, size: st.size, mtimeMs: st.mtimeMs, at: st.mtime.toISOString() } })
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
        out.count = files.length
        out.latest = files[0]
          ? { name: files[0].name, at: files[0].at, mb: Math.round((files[0].size / 1_048_576) * 10) / 10 }
          : null
      }
    } catch { /* ignore */ }
    backupCache = { at: Date.now(), data: out }
    return out
  }

  // ⑤c 守卫：读守卫日志尾部（Linux 版格式：===== 时间 ===== / 无改动|已推送 / 卡片总数 / 正文总字符）
  const guardInfo = () => {
    const logFile = expandHome(cfg.guardLog)
    const out = { logFile, exists: false, at: '', action: '', cards: null, chars: null, tail: [] }
    try {
      if (logFile === '' || !existsSync(logFile)) return out
      const lines = readFileSync(logFile, 'utf8').split(/\r?\n/)
      out.exists = true
      let start = -1
      for (let i = lines.length - 1; i >= 0; i--) { if (/^=====/.test(lines[i])) { start = i; break } }
      const block = (start >= 0 ? lines.slice(start) : lines.slice(-8)).filter((l) => l.trim() !== '').slice(0, 8)
      out.tail = block
      const m = block.length > 0 ? block[0].match(/^=====\s*(.+?)\s*=====$/) : null
      out.at = m ? m[1] : ''
      out.action = block.find((l) => /无改动|已推送|推送失败|提交失败|记忆库不存在/.test(l)) || ''
      const cards = block.find((l) => /^卡片总数：/.test(l))
      if (cards) out.cards = Number((cards.match(/(\d+)/) || [])[1]) || null
      const chars = block.find((l) => /^正文总字符：/.test(l))
      if (chars) out.chars = Number((chars.match(/正文总字符：(\d+)/) || [])[1]) || null
    } catch { /* ignore */ }
    return out
  }

  // ⑥ 检索工具：脚本可用性 / 索引卡数 / 同义词组数 / 开场注入 vs 预算
  const toolsInfo = () => {
    const cfgNow = loadConfig()
    let synonymGroups = 0
    let indexRows = 0
    try {
      if (indexPath && existsSync(indexPath)) {
        for (const line of readFileSync(indexPath, 'utf8').split(/\r?\n/)) {
          if (/^\|\s*[^|]+\s*\|/.test(line) && !/^\|\s*:?-{2,}/.test(line)) indexRows += 1
        }
        indexRows = Math.max(0, indexRows - 1)   // 去掉表头行
      }
    } catch { /* ignore */ }
    const synFile = cfg.synonymFile && memoryRoot ? join(memoryRoot, cfg.synonymFile) : ''
    try {
      if (synFile !== '' && existsSync(synFile)) {
        for (const line of readFileSync(synFile, 'utf8').split(/\r?\n/)) {
          const s = line.trim()
          if (s === '' || s.startsWith('#') || s.startsWith('-') || s.startsWith('>')) continue
          synonymGroups += 1
        }
      }
    } catch { /* ignore */ }
    const injectedChars = buildSummary().length
    return {
      script: searchScript, scriptOK: memoryRoot !== '' && existsSync(searchScript),
      indexFile: indexPath, indexOK: memoryRoot !== '' && existsSync(indexPath), indexRows,
      synonymFile: synFile, synonymGroups,
      injectedChars, injectBudget: cfgNow.injectBudget,
      topics: readTopics().length,
    }
  }

  // ⑤d/治理扫描：可降级候选 + 超长卡 + 标题重复 + 单主题超 50
  const governance = () => {
    const cfgNow = loadConfig()
    const cards = listCards()
    const now = Date.now()
    const hardMs = cfgNow.upkeepHardDays * 86_400_000
    const candidates = cards
      .filter((c) => c.finished && now - c.mtimeMs > hardMs)
      .map((c) => ({ rel: c.rel, name: c.name, days: Math.floor((now - c.mtimeMs) / 86_400_000) }))
      .sort((a, b) => b.days - a.days)
      .slice(0, 20)
    const oversize = cards
      .filter((c) => c.lines > 60 || c.bytes > 8192)
      .sort((a, b) => b.lines - a.lines || b.bytes - a.bytes)
      .map(brief)
    const byTitle = new Map()
    for (const c of cards) {
      if (!c.title) continue
      const arr = byTitle.get(c.title) || []
      arr.push(c.rel)
      byTitle.set(c.title, arr)
    }
    const dupTitles = [...byTitle.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([title, files]) => ({ title, count: files.length, files: files.slice(0, 5) }))
    const topicsMap = new Map()
    for (const c of cards) {
      const key = c.rel.split('/')[1] || c.rel.split('/')[0] || '(root)'
      topicsMap.set(key, (topicsMap.get(key) || 0) + 1)
    }
    const over50 = [...topicsMap.entries()].filter(([, n]) => n > 50).map(([tname, count]) => ({ name: tname, count }))
    return {
      scannedAt: new Date().toISOString(),
      cards: cards.length,
      hardDays: cfgNow.upkeepHardDays,
      candidates, oversize, oversizeCount: oversize.length, dupTitles, over50,
    }
  }

  // 动作按钮：跑脚本（checkup / backup）或纯计算（scan）
  const runAction = async (action) => {
    const started = Date.now()
    if (action === 'scan') {
      const report = governance()
      return { ok: true, action, code: 0, ms: Date.now() - started, out: '', report }
    }
    const map = { checkup: cfg.guardScript, backup: cfg.backupScript }
    const script = expandHome(map[action])
    if (!script || !existsSync(script)) return { ok: false, action, error: 'script not found: ' + (script || '(empty)'), ms: Date.now() - started }
    const timeoutMs = action === 'backup' ? 180_000 : 60_000
    const r = await runProcess('/bin/bash', [script], timeoutMs)
    if (action === 'backup') backupCache = { at: 0, data: null }
    if (action === 'checkup') { /* 守卫日志每次重读，走 guardInfo() 实时取 */ }
    return {
      ok: r.ok, action, code: r.code, ms: Date.now() - started,
      out: r.out.slice(-2000), error: r.err.slice(-600) || (r.ok ? '' : 'exit ' + r.code),
      artifact: action === 'backup' ? backupInfo(true).latest : null,
      guard: action === 'checkup' ? guardInfo() : null,
    }
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
      // 返回值里绝不能出现 undefined：harness 的 lossless-JSON 校验会直接判整次工具调用失败
      //（0.3.0 的 bug：`error: undefined` 让 memory_find 稳定报 "returned invalid output"）。
      if (args.stats === true) return await doStats()
      const query = String(args.query ?? '').trim()
      if (query === '') return { ok: false, error: 'missing query (or set stats: true for a library overview)' }
      const top = clamp(Number(args.top ?? cfgNow.searchTop) || cfgNow.searchTop, 1, 20)
      const r = await doSearch({ query, top })
      return r.ok ? { ok: true, text: r.text, query, mode: r.mode } : { ok: false, error: r.error || 'search failed' }
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

  // 片④（2026-10-11）：维护闹钟状态——设置页/调试用，也给「该巩固了」一个可查的口径
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/${NS}/upkeep`,
    handler: (req, res) => {
      const cfgNow = loadConfig()
      const s = scan()
      sendJson(res, 200, {
        ok: true,
        upkeep: {
          cards: s.cards,
          oversize: s.oversize,
          recentCards: s.recentCards,
          lastConsolidation: s.lastConsolidation,
          daysSinceConsolidation: s.daysSinceConsolidation,
          due: upkeepDue(s, cfgNow),
          thresholds: { days: cfgNow.upkeepDays, cards: cfgNow.upkeepCards, hardDays: cfgNow.upkeepHardDays },
          hint: upkeepHint(),
        },
      })
    },
  }))

  // 治理仪表盘：一次返回「数据六块」（2026-10-11 扩展；旧 /stats 等路由保留兼容）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/${NS}/dashboard`,
    handler: async (req, res) => {
      const cfgNow = loadConfig()
      const s = scan()
      const [git, backup] = [await gitInfo(), backupInfo(false)]
      const t = tax()
      sendJson(res, 200, {
        ok: true,
        config: cfgNow,
        configFile,
        root: memoryRoot,
        configured: memoryRoot !== '',
        defaultDir: join(HOME, 'memory'),
        siteUrl: cfg.siteUrl || '',
        now: new Date().toISOString(),
        tax: t,
        scale: {
          cards: s.cards, chars: s.chars, tokens: Math.round(s.chars / 3.2),
          topics: readTopics().length, topicsDist: s.topicsDist.slice(0, 12), topicsTotal: s.topicsDist.length,
          todayNew: s.todayNew, updatedAt: s.updatedAt, trend: t.trend,
        },
        layers: {
          cards: s.cards, cold: s.cold,
          oversize: s.oversize, oversizeList: s.oversizeList,
          over50: s.over50, dupTitles: s.dupTitles.slice(0, 5),
          longest: s.longest,
        },
        upkeep: {
          lastConsolidation: s.lastConsolidation, daysSinceConsolidation: s.daysSinceConsolidation,
          recentCards: s.recentCards, due: upkeepDue(s, cfgNow),
          thresholds: { days: cfgNow.upkeepDays, cards: cfgNow.upkeepCards, hardDays: cfgNow.upkeepHardDays },
        },
        guard: { git, backup, log: guardInfo() },
        tools: toolsInfo(),
      })
    },
  }))

  // 面板内直接搜记忆库（复用 memory-find 脚本，免开对话）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/${NS}/search`,
    handler: async (req, res) => {
      let q = '', top = loadConfig().searchTop
      try {
        const u = new URL(req.url || '', 'http://localhost')
        q = (u.searchParams.get('q') || '').trim()
        top = clamp(Number(u.searchParams.get('top') || top) || top, 1, 20)
      } catch { /* ignore */ }
      if (q === '') return sendJson(res, 400, { ok: false, error: 'missing q' })
      const r = await doSearch({ query: q, top })
      return sendJson(res, 200, { ok: r.ok, query: q, top, text: r.text, mode: r.mode, error: r.ok ? '' : (r.error || 'search failed') })
    },
  }))

  // 动作按钮：checkup（体检）/ backup（备份）/ scan（治理扫描）
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/${NS}/run`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      let body = {}
      try { body = JSON.parse(await readBody(req)) || {} } catch { return sendJson(res, 400, { ok: false, error: 'bad-json' }) }
      const action = String(body.action || '')
      if (!['checkup', 'backup', 'scan'].includes(action)) return sendJson(res, 400, { ok: false, error: 'unknown action: ' + action })
      const result = await runAction(action)
      return sendJson(res, result.ok ? 200 : 500, result)
    },
  }))

  // 建库 / 选目录：面板里的「选择已有目录」「一键建库」都走它
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/${NS}/library`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      let body = {}
      try { body = JSON.parse(await readBody(req)) || {} } catch { return sendJson(res, 400, { ok: false, error: 'bad-json' }) }
      const action = String(body.action || 'validate')
      const info = validateDir(body.dir)
      if (action === 'validate') return sendJson(res, 200, { ok: true, info })
      if (info.hint === 'other-platform' && body.force !== true) {
        return sendJson(res, 400, { ok: false, action, info, error: 'other-platform-path' })
      }
      if (action === 'attach') {
        if (!info.exists) return sendJson(res, 400, { ok: false, action, info, error: 'directory-not-found' })
        const created = scaffold(info.dir)
        const root = applyRoot(info.dir)
        return sendJson(res, 200, { ok: true, action, info: validateDir(info.dir), created, root })
      }
      if (action !== 'create') return sendJson(res, 400, { ok: false, error: 'unknown action: ' + action })
      // 没给目录就用默认位置（DSH 自己的 home 下，跨端都成立），让「一键建库」真的只要一下
      const rawDir = body.dir === undefined || body.dir === null || String(body.dir).trim() === ''
        ? join(HOME, 'memory') : String(body.dir)
      const dir = resolveDir(rawDir)
      try { mkdirSync(dir, { recursive: true }) } catch (error) {
        return sendJson(res, 500, { ok: false, action, error: String(error?.message ?? error) })
      }
      const created = scaffold(dir)
      let git = 'skipped'
      if (body.initGit !== false && !existsSync(join(dir, '.git'))) {
        const g = await runProcess('git', ['-C', dir, 'init'], 15_000)
        git = g.ok ? 'ok' : (g.err || 'git unavailable')
      }
      const root = applyRoot(dir)
      return sendJson(res, 200, { ok: true, action, info: validateDir(dir), created, git, root })
    },
  }))

  // ---------- 斜杠命令 + 自带 skill（0.4.0：让用户「看得见」这个插件）----------
  // 两个服务都按可选获取：老版本 DSH 没有它们时，插件照常工作，不会 pending。
  const svc = (n) => (typeof ctx.get === 'function' ? ctx.get(n) : null)

  const commandName = String(cfg.commandName || 'memory').replace(/[^A-Za-z0-9_-]/g, '') || 'memory'
  const commands = svc('commands')
  if (commands && typeof commands.register === 'function') {
    ctx.effect(() => commands.register({
      name: commandName,
      description: 'Memory library: show status, search cards, create or point at a library',
      input: { hint: 'status | search <words> | init [folder] | root <folder>' },
      handler: async (invocation) => {
        const line = String(invocation && invocation.rawInput ? invocation.rawInput : '').trim()
        const parts = line.split(/\s+/)
        const sub = (parts.shift() || 'status').toLowerCase()
        const arg = parts.join(' ').trim()

        if (sub === 'status' || sub === 'info') {
          const st = scan()
          const tx = tax()
          const days = st.daysSinceConsolidation
          const out = [
            '记忆库：' + (memoryRoot === '' ? '（还没配置）' : memoryRoot),
            '卡片 ' + st.cards + ' 张 · 正文 ' + st.chars + ' 字符（≈ ' + Math.round(st.chars / 3.2) + ' token 全读）· 主题 ' + readTopics().length + ' 个',
            '开场税 ' + tx.total + ' / ' + tx.budget + ' 字符（' + tx.pct + '%）· 超长卡 ' + st.oversize + ' · 冷区 ' + st.cold,
            days >= 0 ? '距上次巩固 ' + days + ' 天 · 自上次改动 ' + st.recentCards + ' 张' : '还没做过巩固',
            memoryRoot === ''
              ? '下一步：/memory init 建一个新库，或 /memory root <目录> 指向已有库'
              : '下一步：/memory search <关键词> 直接搜卡片',
          ]
          return { kind: 'success', text: out.join('\n') }
        }

        if (sub === 'search' || sub === 'find') {
          if (arg === '') return { kind: 'error', text: '用法：/memory search <关键词>' }
          const r = await doSearch({ query: arg, top: loadConfig().searchTop })
          return r.ok ? { kind: 'success', text: r.text } : { kind: 'error', text: r.error || 'search failed' }
        }

        if (sub === 'init') {
          const target = resolveDir(arg === '' ? join(HOME, 'memory') : arg)
          if (target === '') return { kind: 'error', text: '用法：/memory init [目录]' }
          const info = validateDir(target)
          if (info.hint === 'other-platform') return { kind: 'error', text: '这看起来是另一台机器的路径：' + target + '\n请用本机路径，或在设置页里点「选择目录」。' }
          try { mkdirSync(target, { recursive: true }) } catch (error) {
            return { kind: 'error', text: String(error && error.message ? error.message : error) }
          }
          const created = scaffold(target)
          const root = applyRoot(target)
          return {
            kind: 'success',
            text: '已把记忆库设到：' + root + '\n' + (created.length ? '新建：' + created.join('、') : '（目录里已有这些文件，未覆盖任何内容）')
              + '\n接下来：让 agent 把结论写成卡（说「记进记忆库」即可），或用 /memory search 试试检索。',
          }
        }

        if (sub === 'root' || sub === 'use') {
          if (arg === '') return { kind: 'error', text: '用法：/memory root <目录>' }
          const info = validateDir(arg)
          if (info.hint === 'other-platform') return { kind: 'error', text: '这看起来是另一台机器的路径（当前系统：' + process.platform + '）：' + arg + '\n请用本机路径，或在设置页里点「选择目录」。' }
          if (!info.exists) return { kind: 'error', text: '目录不存在：' + info.dir + '\n用 /memory init <目录> 可以直接建一个。' }
          const root = applyRoot(info.dir)
          return { kind: 'success', text: '记忆库路径已设为：' + root + (info.looksLikeLibrary ? '' : '\n注意：这个目录里还没有 ' + cfg.indexFile + '，面板里可以一键补骨架。') }
        }

        return { kind: 'error', text: '子命令：status ｜ search <关键词> ｜ init [目录] ｜ root <目录>' }
      },
    }))
  }

  // 自带 skill：教任何 agent（不依赖用户的预设）怎么用这个库
  const skills = svc('skills')
  if (cfg.skillEnabled !== false && skills && typeof skills.register === 'function') {
    ctx.effect(() => skills.register({
      name: 'memory-library',
      description: 'Use the configured markdown memory library: search before guessing, write cards after real progress, keep the library small.',
      whenToUse: 'When a past decision, path, config or project status is needed, or the user says "记一下 / 存档 / remember this".',
      source: 'runtime',
      invocation: { modelInvocable: true, userInvocable: true },
      content: [
        '# 记忆库（memory-library）',
        '',
        '## 怎么用',
        '1. **先搜再猜**：任何「以前怎么定的 / 路径是什么 / 之前踩过什么坑」，先用 `memory_find` 搜（2-4 个关键词最准），再决定要不要读整卡。',
        '2. **开场读索引**：会话开始读库根的 `INDEX.md`（主题清单）和常读文件；**不要把整库读进上下文**。',
        '3. **写卡时机**：结论定型 / 功能完成 / 坑定位到根因 → 立刻写卡；同一项目优先**更新既有卡**，别每小步新建。',
        '4. **卡片格式**：文件名 `YYYY-MM-DD_简短标题.md`；正文五段：标题 / 日期 / 背景 / 结论 / 关键词；单卡 ≤60 行。',
        '5. **防堆积**：单主题超 50 张压成 `历史摘要.md`（只留结论），细节移 `archive/`（冷区，不参与检索）。',
        '6. **别做**：不灌流水账、不把整库贴进对话、不删用户的卡（除非用户明确要求）。',
        '',
        '## 入口',
        '- 面板：设置 → 记忆库（健康度、阈值、体检/备份/治理扫描）',
        '- 命令：`/memory`（status ｜ search ｜ init ｜ root）',
        '- 工具：`memory_find`（检索）',
      ].join('\n'),
    }))
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `/${NS}/config`,
    handler: async (req, res) => {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, config: loadConfig() })
      if (req.method === 'POST') {
        let body = {}
        try { body = JSON.parse(await readBody(req)) || {} } catch { return sendJson(res, 400, { ok: false, error: 'bad-json' }) }
        const patch = {}
        // 面板里换库路径：写运行时配置并立刻重算派生值（不动用户的 profile 文件）
        if (typeof body.memoryRoot === 'string') applyRoot(body.memoryRoot)
        if (typeof body.injectSummary === 'boolean') patch.injectSummary = body.injectSummary
        if (Number.isFinite(body.injectBudget)) patch.injectBudget = clamp(body.injectBudget, 200, 2000)
        if (typeof body.toolEnabled === 'boolean') patch.toolEnabled = body.toolEnabled
        if (Number.isFinite(body.searchTop)) patch.searchTop = clamp(body.searchTop, 1, 10)
        if (Number.isFinite(body.taxBudget)) patch.taxBudget = clamp(body.taxBudget, 5000, 200000)
        if (Number.isFinite(body.upkeepDays)) patch.upkeepDays = clamp(body.upkeepDays, 1, 365)
        if (Number.isFinite(body.upkeepCards)) patch.upkeepCards = clamp(body.upkeepCards, 1, 200)
        if (Number.isFinite(body.upkeepHardDays)) patch.upkeepHardDays = clamp(body.upkeepHardDays, 7, 365)
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
