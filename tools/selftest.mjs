// Unit checks (no DSH boot): mock ctx, verify tool / digest / HTTP routes / runtime config.
// Usage: node tools/selftest.mjs
//   env MEMORY_LITE_TEST_ROOT   real memory library (default: <repo>/../deepseek-memory if present)
//   env MEMORY_LITE_TEST_STATE  temp dir for runtime config (default: os.tmpdir())
// The second static assertion guards the 2026-09-11 incident: an undeclared ctx service makes the
// whole DSH plugin tree fail to load (instance would not start).
import { apply, name, inject } from '../lib/index.js'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let fail = 0
const ck = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) fail++ }

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const testRoot = process.env.MEMORY_LITE_TEST_ROOT || 'G:\\deepseek\\deepseek-memory'
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
const server = createServer((req, res) => {
  const url = (req.url || '').split('?')[0]
  const hit = routes.find((r) => r.path === url)
  if (!hit) { res.writeHead(404); res.end('not found'); return }
  Promise.resolve(hit.handler(req, res)).catch(() => { try { res.writeHead(500); res.end('err') } catch (_) { } })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port

const ctx = {
  tools: { register: (def) => { registered.push(def); return () => {} } },
  systemPrompt: { section: (def) => { sections.push(def); return () => {} } },
  effect: (fn) => fn(),
  webServer: { register: (def) => { routes.push(def); return () => {} } },
}

apply(ctx, { memoryRoot: testRoot, stateDir })

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
ck('digest authored text is project-neutral', !/鲸鱼娘|whalemaid|RULES\.md|MemoryGuard/i.test(authored))
ck('digest keeps the user\'s own topic names (from INDEX.md)', /Topics:/.test(summary))
ck("digest keeps the user topic names (from INDEX.md)", /Topics:/.test(summary))
ck('digest body speaks in English', /memory_find|search|topics/i.test(summary))
ck('registers 3 HTTP routes', routes.length === 3)
ck('route paths correct', ['/memory-lite/stats', '/memory-lite/health', '/memory-lite/config'].every((p) => routes.some((r) => r.path === p)))
console.log('     digest: ' + summary.split('\n')[0])

// ── HTTP behaviour ───────────────────────────────────────────────────────────
const stats = await (await fetch(base + '/memory-lite/stats')).json()
ck('GET /stats ok', stats.ok === true)
ck('stats reports configured root', stats.stats?.configured === true && stats.stats.root === testRoot)
ck('stats counts cards', typeof stats.stats?.cards === 'number' && stats.stats.cards > 0)
console.log('     → cards ' + stats.stats.cards + ' / ' + stats.stats.chars + ' chars / topics ' + stats.stats.topics + ' / digest ' + stats.stats.injectedChars + ' chars')

const health = await (await fetch(base + '/memory-lite/health')).json()
ck('GET /health ok (empty when no log configured)', health.ok === true && health.health?.exists === false)

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

// ── degradation: no memoryRoot configured ────────────────────────────────────
const ctx2 = {
  tools: { register: (def) => { registered.push(def); return () => {} } },
  systemPrompt: { section: (def) => { sections.push(def); return () => {} } },
  effect: (fn) => fn(),
  webServer: { register: () => () => {} },
}
const savedEnv = process.env.DSH_MEMORY_ROOT
delete process.env.DSH_MEMORY_ROOT
apply(ctx2, { stateDir })
if (savedEnv !== undefined) process.env.DSH_MEMORY_ROOT = savedEnv
const unconfigured = registered[registered.length - 1]
const r4 = await unconfigured.execute({ query: 'anything' })
ck('unconfigured: search fails gracefully', r4.ok === false && typeof r4.error === 'string')
ck('unconfigured: section text empty (no bad digest)', String(sections[sections.length - 1]?.text() ?? '') === '')

server.close()
if (!process.env.MEMORY_LITE_TEST_STATE) { try { rmSync(stateDir, { recursive: true, force: true }) } catch (_) { } }
console.log('\nRESULT fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
