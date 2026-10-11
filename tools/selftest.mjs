// Unit checks (no DSH boot): mock ctx, verify tool / digest / HTTP routes / runtime config.
// Usage: node tools/selftest.mjs
//   env MEMORY_LITE_TEST_ROOT   real memory library (default: <repo>/../deepseek-memory if present)
//   env MEMORY_LITE_TEST_STATE  temp dir for runtime config (default: os.tmpdir())
// The second static assertion guards the 2026-09-11 incident: an undeclared ctx service makes the
// whole DSH plugin tree fail to load (instance would not start).
import { apply, name, inject } from '../lib/index.js'
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir as tmpDirPath } from 'node:os'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let fail = 0
const ck = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) fail++ }

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || ''
// 默认取家目录下的 deepseek-memory；换别处就用 env MEMORY_LITE_TEST_ROOT 指定真实记忆库
const testRoot = process.env.MEMORY_LITE_TEST_ROOT
  || [join(HOME_DIR, 'deepseek-memory'), join(HOME_DIR, 'Documents', 'deepseek-memory')].find((p) => p && existsSync(p))
  || join(HOME_DIR, 'deepseek-memory')
const stateDir = process.env.MEMORY_LITE_TEST_STATE || mkdtempSync(join(tmpdir(), 'memory-lite-selftest-'))
const configFile = join(stateDir, 'config.json')

console.log('plugin name =', name, '| inject =', JSON.stringify(inject))
console.log('test root  =', testRoot, '| state dir =', stateDir)

// ── static check: inject must cover every ctx service used ───────────────────
// whitelist = cordis Context built-ins (always available, no injection needed)
const BUILTIN = new Set(['effect', 'on', 'get', 'set', 'inject', 'provide', 'plugin', 'scope', 'fiber', 'logger'])
const src = readFileSync(join(repo, 'lib', 'index.js'), 'utf8')
const used = [...new Set([...src.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]
const missing = used.filter((s) => !new Set(inject).has(s) && !BUILTIN.has(s))
ck('inject covers every ctx service (' + used.join(', ') + ')', missing.length === 0)
if (missing.length > 0) console.log('     ⚠ undeclared: ' + missing.join(', ') + ' → DSH would fail to start!')

// ── mock ctx (webServer backed by a real HTTP server) ────────────────────────
const registered = []
const sections = []
const routes = []
// 命令与 skill 服务（0.4.0 的可选依赖）：假实现收集注册，验证「用户看得见的入口」确实挂上了
const commandDefs = []
const skillDefs = []
const fakeServices = {
  commands: { register: (def) => { commandDefs.push(def); return () => { } } },
  skills: { register: (def) => { skillDefs.push(def); return () => { } } },
}
const server = createServer((req, res) => {
  const url = (req.url || '').split('?')[0]
  const hit = routes.find((r) => r.path === url)
  if (!hit) { res.writeHead(404); res.end('not found'); return }
  Promise.resolve(hit.handler(req, res)).catch(() => { try { res.writeHead(500); res.end('err') } catch (_) { } })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port

const ctx = {
  get: (n) => fakeServices[n] || null,
  tools: { register: (def) => { registered.push(def); return () => {} } },
  systemPrompt: { section: (def) => { sections.push(def); return () => {} } },
  effect: (fn) => fn(),
  webServer: { register: (def) => { routes.push(def); return () => {} } },
}

// 假守卫脚本：验证「按钮 → spawn 脚本 → 回显输出」链路，且不碰真实记忆库
const fakeGuard = join(stateDir, 'fake-guard.sh')
writeFileSync(fakeGuard, '#!/usr/bin/env bash\necho FAKE-CHECKUP-OK\n', 'utf8')
try { chmodSync(fakeGuard, 0o755) } catch (_) { }

apply(ctx, { memoryRoot: testRoot, stateDir, guardScript: fakeGuard, taxFiles: ['INDEX.md', 'RULES.md'] })

ck('registers exactly one tool', registered.length === 1)
const tool = registered[0]
ck('tool name = memory_find', tool?.name === 'memory_find')
ck('tool has execute()', typeof tool?.execute === 'function')
ck('registers one systemPrompt section', sections.length === 1)
ck('section text is a function (reads config each assembly)', typeof sections[0]?.text === 'function')
const summary = String(sections[0]?.text() ?? '')
ck('digest is non-empty', summary.length > 0)
ck('digest respects default budget (≤900)', summary.length <= 900)
// project-neutral wording: the configured path itself may contain anything (it is the user's own
// path) and topic names come from the user's INDEX.md — so only the *plugin-authored* wording is
// checked for personal/project vocabulary.
const authored = summary.split('\n').filter((l) => /^Memory library|^When you need/.test(l)).join('\n')
ck('digest authored text is project-neutral', !/whalemaid|RULES\.md|MemoryGuard/i.test(authored))
ck('digest keeps the user\'s own topic names (from INDEX.md)', /Topics:/.test(summary))
ck("digest keeps the user topic names (from INDEX.md)", /Topics:/.test(summary))
ck('digest body speaks in English', /memory_find|search|topics/i.test(summary))
const ROUTES = ['/memory-lite/stats', '/memory-lite/health', '/memory-lite/config', '/memory-lite/upkeep', '/memory-lite/dashboard', '/memory-lite/search', '/memory-lite/run', '/memory-lite/library']
ck('registers 8 HTTP routes', routes.length === 8)
ck('route paths correct', ROUTES.every((p) => routes.some((r) => r.path === p)))
console.log('     digest: ' + summary.split('\n')[0])

// ── HTTP behaviour ───────────────────────────────────────────────────────────
const stats = await (await fetch(base + '/memory-lite/stats')).json()
ck('GET /stats ok', stats.ok === true)
ck('stats reports configured root', stats.stats?.configured === true && stats.stats.root === testRoot)
ck('stats counts cards', typeof stats.stats?.cards === 'number' && stats.stats.cards > 0)
console.log('     → cards ' + stats.stats.cards + ' / ' + stats.stats.chars + ' chars / topics ' + stats.stats.topics + ' / digest ' + stats.stats.injectedChars + ' chars')

// ── 片④ upkeep 闹钟（2026-10-11 加）─────────────────────────────────────────
const upkeep = await (await fetch(base + '/memory-lite/upkeep')).json()
ck('GET /upkeep ok', upkeep.ok === true)
ck('upkeep reports maintenance fields',
  typeof upkeep.upkeep?.oversize === 'number' &&
  typeof upkeep.upkeep?.recentCards === 'number' &&
  typeof upkeep.upkeep?.daysSinceConsolidation === 'number' &&
  typeof upkeep.upkeep?.due === 'boolean')
console.log('     → upkeep: cards ' + upkeep.upkeep.cards + ' / oversize ' + upkeep.upkeep.oversize +
  ' / recent ' + upkeep.upkeep.recentCards + ' / since ' + upkeep.upkeep.daysSinceConsolidation + 'd / due ' + upkeep.upkeep.due)

const health = await (await fetch(base + '/memory-lite/health')).json()
ck('GET /health ok (empty when no log configured)', health.ok === true && health.health?.exists === false)

// ── 治理仪表盘（2026-10-11 扩展）：六块数据 / 面板内搜索 / 动作按钮 ──────────
const dash = await (await fetch(base + '/memory-lite/dashboard')).json()
ck('GET /dashboard ok', dash.ok === true)
ck('tax: file list with per-file sizes', Array.isArray(dash.tax?.files) && dash.tax.files.length >= 1 && dash.tax.files.every((f) => typeof f.chars === 'number'))
ck('tax: total + pct + remaining', dash.tax?.total >= 0 && typeof dash.tax?.pct === 'number' && typeof dash.tax?.remaining === 'number')
ck('tax: budget mirrors runtime config', dash.tax?.budget === dash.config?.taxBudget)
ck('scale: cards/chars/tokens/topics', dash.scale?.cards > 0 && dash.scale?.chars > 0 && dash.scale?.tokens > 0 && typeof dash.scale?.topics === 'number')
ck('scale: topic distribution sorted desc', Array.isArray(dash.scale?.topicsDist) && dash.scale.topicsDist.every((x, i, a) => i === 0 || a[i - 1].count >= x.count))
ck('scale: today-new counter present', typeof dash.scale?.todayNew === 'number')
ck('layers: oversize list + cold area count', typeof dash.layers?.oversize === 'number' && Array.isArray(dash.layers?.oversizeList) && typeof dash.layers?.cold === 'number')
ck('layers: oversize items carry lines/kb', (dash.layers?.oversizeList || []).every((c) => c.lines > 60 || c.kb * 1024 > 8192))
ck('upkeep: due is computed from configured thresholds', dash.upkeep?.thresholds?.days === 21 && dash.upkeep?.thresholds?.hardDays === 90 && typeof dash.upkeep?.due === 'boolean')
ck('guard: git block reports the last commit', dash.guard?.git?.ok === true && typeof dash.guard.git.lastCommit?.hash === 'string')
ck('guard: log + backup blocks present', typeof dash.guard?.log?.exists === 'boolean' && typeof dash.guard?.backup?.latest === 'object')
ck('tools: index rows + budget + digest size', dash.tools?.indexOK === true && dash.tools?.indexRows > 0 && dash.tools?.injectBudget === 900 && typeof dash.tools?.injectedChars === 'number')
ck('trend: snapshot recorded on open', typeof dash.tax?.trend?.points === 'number' && dash.tax.trend.points >= 1)
console.log('     → dash: tax ' + dash.tax.total + '/' + dash.tax.budget + ' chars (' + dash.tax.pct + '%) · cards ' + dash.scale.cards +
  ' · cold ' + dash.layers.cold + ' · oversize ' + dash.layers.oversize + ' · dirty ' + dash.guard.git.dirty)

const srch = await (await fetch(base + '/memory-lite/search?q=' + encodeURIComponent('plugin memory') + '&top=3')).json()
ck('GET /search returns scored text', srch.ok === true && typeof srch.text === 'string')
ck('GET /search without q is rejected', (await fetch(base + '/memory-lite/search')).status === 400)

const post = (path, body, method) => fetch(base + path, {
  method: method || 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
})
const runScan = await (await post('/memory-lite/run', { action: 'scan' })).json()
ck('POST /run scan → governance report', runScan.ok === true && runScan.report?.cards > 0
  && Array.isArray(runScan.report?.candidates) && Array.isArray(runScan.report?.oversize) && Array.isArray(runScan.report?.dupTitles))
const runCheck = await (await post('/memory-lite/run', { action: 'checkup' })).json()
ck('POST /run checkup spawns the configured script', runCheck.ok === true && /FAKE-CHECKUP-OK/.test(String(runCheck.out)))
ck('POST /run rejects an unknown action', (await (await post('/memory-lite/run', { action: 'nuke' })).json()).ok === false)
ck('POST /run rejects GET', (await fetch(base + '/memory-lite/run')).status === 405)

// ── 一键建库 / 目录校验 / 跨端提示（0.4.0）──────────────────────────────────
const libPost = (body) => post('/memory-lite/library', body)
const libDir = join(tmpDirPath(), 'memory-lite-selftest-lib-' + Date.now())
const v1 = await (await libPost({ action: 'validate', dir: libDir })).json()
ck('library validate: missing folder reported', v1.ok === true && v1.info.exists === false)
const c1 = await (await libPost({ action: 'create', dir: libDir, initGit: false })).json()
ck('library create: scaffold written', c1.ok === true && c1.created.includes('INDEX.md')
  && c1.created.includes('memory/示例主题/0000-00-00_示例卡.md'))
ck('library create: runtime root switched (no restart needed)', c1.root === libDir)
const dashAfter = await (await fetch(base + '/memory-lite/dashboard')).json()
ck('dashboard follows the new root', dashAfter.root === libDir && dashAfter.configured === true)
const s2 = await tool.execute({ query: '示例' })
ck('built-in search works on a brand-new library', s2.ok === true && typeof s2.text === 'string')
const c2 = await (await libPost({ action: 'create', dir: libDir, initGit: false })).json()
ck('scaffold never overwrites existing files', Array.isArray(c2.created) && c2.created.length === 0)
const vCross = await (await libPost({ action: 'validate', dir: 'D:\\deepseek\\deepseek-memory' })).json()
ck('another-platform path is flagged, not silently broken', vCross.info.hint === 'other-platform')
const restore = await (await libPost({ action: 'attach', dir: testRoot })).json()
ck('attach back to the original library works', restore.ok === true && restore.root === testRoot)
rmSync(libDir, { recursive: true, force: true })

// ── 斜杠命令 + 自带 skill（0.4.0：不让插件「藏起来」）────────────────────────
ck('registers exactly one slash command', commandDefs.length === 1 && commandDefs[0].name === 'memory')
ck('registers exactly one built-in skill', skillDefs.length === 1 && skillDefs[0].name === 'memory-library')
ck('skill carries usable guidance', typeof skillDefs[0]?.content === 'string' && /memory_find/.test(skillDefs[0].content))
ck('command declares an input hint', typeof commandDefs[0]?.input?.hint === 'string' && commandDefs[0].input.hint.length > 0)
const cmdRun = (line) => commandDefs[0].handler({ rawInput: line, agent: { id: 'selftest' } })
const cmdStatus = await cmdRun('status')
ck('command status → success text', cmdStatus.kind === 'success' && /记忆库/.test(cmdStatus.text))
const cmdSearch = await cmdRun('search 示例')
ck('command search → hits or a clean empty answer', cmdSearch.kind === 'success' && /命中|没有卡片/.test(cmdSearch.text))
ck('command unknown sub → error result', (await cmdRun('nonsense')).kind === 'error')
const cmdInitDir = join(tmpDirPath(), 'memory-lite-cmd-init-' + Date.now())
ck('command init → creates a library', (await cmdRun('init ' + cmdInitDir)).kind === 'success' && existsSync(join(cmdInitDir, 'INDEX.md')))
ck('command root → switches back to the configured library', (await cmdRun('root ' + testRoot)).kind === 'success')
ck('command root → another-platform path rejected with a clear message', (await cmdRun('root D:\\deepseek\\deepseek-memory')).kind === 'error')
rmSync(cmdInitDir, { recursive: true, force: true })

const posted = await (await fetch(base + '/memory-lite/config', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ injectBudget: 700, searchTop: 4 }),
})).json()
ck('POST /config applies', posted.ok === true && posted.config.injectBudget === 700 && posted.config.searchTop === 4)
ck('config written atomically (no .tmp left)', existsSync(configFile) && !existsSync(configFile + '.tmp'))
const narrowed = String(sections[0].text()).length
ck('narrower budget shortens the digest (≤700)', narrowed <= 700)
const clamped = await (await fetch(base + '/memory-lite/config', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ injectBudget: 99999, searchTop: 99 }),
})).json()
ck('out-of-range values are clamped', clamped.config.injectBudget === 2000 && clamped.config.searchTop === 10)

// ── tool behaviour ───────────────────────────────────────────────────────────
const r1 = await tool.execute({ query: 'plugin crash', top: 3 })
ck('search returns ok=true', r1.ok === true)
ck('search returns text', typeof r1.text === 'string' && r1.text.length > 0)
const r2 = await tool.execute({ stats: true })
ck('stats mode ok=true', r2.ok === true)
const r3 = await tool.execute({})
ck('empty query rejected', r3.ok === false)

// ── 回归：工具返回值必须是 lossless-JSON 安全的 ──────────────────────────────
// 0.3.0 的 memory_find 稳定报 "returned invalid output: value is not lossless JSON"，
// 根因就是返回值里带了 undefined（error: undefined）。这里钉死这个契约。
const badKeys = (obj) => Object.entries(obj || {}).filter(([, v]) => v === undefined).map(([k]) => k)
ck('search result has no undefined values', badKeys(r1).length === 0)
ck('stats result has no undefined values', badKeys(r2).length === 0)
ck('error result has no undefined values', badKeys(r3).length === 0)
ck('search is served by the built-in engine by default (no external script needed)', r1.mode === 'builtin')

// ── degradation: no memoryRoot configured ────────────────────────────────────
const ctx2 = {
  tools: { register: (def) => { registered.push(def); return () => {} } },
  systemPrompt: { section: (def) => { sections.push(def); return () => {} } },
  effect: (fn) => fn(),
  webServer: { register: () => () => {} },
}
const savedEnv = process.env.DSH_MEMORY_ROOT
delete process.env.DSH_MEMORY_ROOT
// 用一个**干净的 stateDir**：运行时配置里已经存了库路径，而它的优先级高于 profile，
// 所以想测「未配置」必须从零开始（这本身也验证了运行时配置优先）。
const plainState = mkdtempSync(join(tmpdir(), 'memory-lite-selftest-cold-'))
apply(ctx2, { stateDir: plainState })
if (savedEnv !== undefined) process.env.DSH_MEMORY_ROOT = savedEnv
const unconfigured = registered[registered.length - 1]
const r4 = await unconfigured.execute({ query: 'anything' })
ck('unconfigured: search fails gracefully', r4.ok === false && typeof r4.error === 'string')
const unconfiguredText = String(sections[sections.length - 1]?.text() ?? '')
ck('unconfigured: section nudges the user to configure (never silent)', /Settings/i.test(unconfiguredText) && /library/i.test(unconfiguredText))
ck('unconfigured: nudge stays free of author-specific wording', !/鲸鱼娘|whalemaid|wyr233|DSH存档/i.test(unconfiguredText))

// ── 客户端半区：迷你浏览器 + 迷你 React，把槽位组件渲染一遍并校验 i18n ──────
const clientCheck = spawnSync(process.execPath, [join(here, 'clientcheck.mjs')], { encoding: 'utf8' })
ck('client half passes its own smoke check (render + i18n)', clientCheck.status === 0)
if (clientCheck.status !== 0) console.log(clientCheck.stdout + clientCheck.stderr)

server.close()
if (!process.env.MEMORY_LITE_TEST_STATE) { try { rmSync(stateDir, { recursive: true, force: true }) } catch (_) { } }
try { rmSync(plainState, { recursive: true, force: true }) } catch (_) { }
console.log('\nRESULT fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
