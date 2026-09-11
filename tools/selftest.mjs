// 单元验证（不启动 DSH）：mock ctx，检查工具 / 摘要 / 设置页三条 HTTP 路由 / 配置读写。
// 用法：node tools/selftest.mjs      （纯 Node 内置模块，任意目录可跑）
// 2026-09-11 曾因漏 inject 导致 DSH 启动失败 → 本脚本含「inject 覆盖」静态断言，务必保持全绿。
import { apply, name, inject } from '../lib/index.js'
import { readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let fail = 0
const ck = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) fail++ }

const here = dirname(fileURLToPath(import.meta.url))
const cfgFile = join(process.env.DSH_MEMORY_ROOT || 'G:\\deepseek\\deepseek-memory', '.dsh-memory-lite.json')

console.log('plugin name =', name, '| inject =', JSON.stringify(inject))

// ── 静态检查：inject 必须覆盖 apply 里用到的所有 ctx 服务 ────────────────────
// 白名单 = cordis Context 的内置方法（不是注入了才能用的服务，无需声明）
const BUILTIN = new Set(['effect', 'on', 'get', 'set', 'inject', 'provide', 'plugin', 'scope', 'fiber', 'logger'])
const src = readFileSync(join(here, '..', 'lib', 'index.js'), 'utf8')
const used = [...new Set([...src.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]
const missing = used.filter((s) => !new Set(inject).has(s) && !BUILTIN.has(s))
ck('inject 覆盖所有 ctx 服务（用到：' + used.join(', ') + '）', missing.length === 0)
if (missing.length > 0) console.log('     ⚠ 漏声明：' + missing.join(', ') + ' → 会导致 DSH 启动失败！')

// ── mock ctx（webServer 用真实 HTTP 服务，端到端验证路由） ────────────────────
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
const port = server.address().port

const ctx = {
  tools: { register: (def) => { registered.push(def); return () => {} } },
  systemPrompt: { section: (def) => { sections.push(def); return () => {} } },
  effect: (fn) => fn(),
  webServer: { register: (def) => { routes.push(def); return () => {} } },
}

apply(ctx)

ck('注册了 1 个工具', registered.length === 1)
const tool = registered[0]
ck('工具名 = memory_find', tool?.name === 'memory_find')
ck('有 execute 函数', typeof tool?.execute === 'function')
ck('注册了 systemPrompt section', sections.length === 1)
ck('section name = memory-lite', sections[0]?.name === 'memory-lite')
ck('section text 是函数（动态读配置）', typeof sections[0]?.text === 'function')
const text = String(sections[0]?.text() ?? '')
ck('注入文本非空', text.length > 0)
ck('注入文本 ≤ 900 字符（默认硬预算）', text.length <= 900)
ck('注册了 3 条 HTTP 路由', routes.length === 3)
ck('路由路径正确', ['/memory-lite/stats', '/memory-lite/health', '/memory-lite/config'].every((p) => routes.some((r) => r.path === p)))

// ── HTTP 行为 ───────────────────────────────────────────────────────────────
const base = 'http://127.0.0.1:' + port
const stats = await (await fetch(base + '/memory-lite/stats')).json()
ck('GET /stats ok', stats.ok === true)
ck('stats 有卡片数', typeof stats.stats?.cards === 'number' && stats.stats.cards > 0)
ck('stats 带配置快照', typeof stats.config?.injectBudget === 'number')
console.log('     → 卡片 ' + stats.stats.cards + ' 张 / ' + stats.stats.chars + ' 字符 / 主题 ' + stats.stats.topics + ' / 注入 ' + stats.stats.injectedChars + ' 字符')

const health = await (await fetch(base + '/memory-lite/health')).json()
ck('GET /health ok', health.ok === true)
console.log('     → 体检日志存在=' + health.health?.exists + ' 上次=' + (health.health?.at || '-') + ' issues=' + (health.health?.issues ?? '-'))

const before = await (await fetch(base + '/memory-lite/config')).json()
ck('GET /config ok', before.ok === true)
const posted = await (await fetch(base + '/memory-lite/config', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ injectBudget: 700, searchTop: 4 }),
})).json()
ck('POST /config 生效', posted.ok === true && posted.config.injectBudget === 700 && posted.config.searchTop === 4)
ck('配置文件已写入（原子写后无 .tmp 残留）', existsSync(cfgFile) && !existsSync(cfgFile + '.tmp'))
const reloaded = JSON.parse(readFileSync(cfgFile, 'utf8'))
ck('落盘内容正确', reloaded.injectBudget === 700 && reloaded.searchTop === 4)
const narrowed = String(sections[0].text()).length
ck('预算收紧后注入变短（≤700）', narrowed <= 700)
console.log('     → 预算 700 时注入 ' + narrowed + ' 字符')

// 还原默认，避免污染记忆库配置
await fetch(base + '/memory-lite/config', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ injectBudget: 900, searchTop: 5 }),
})
const restored = JSON.parse(readFileSync(cfgFile, 'utf8'))
ck('还原默认成功', restored.injectBudget === 900 && restored.searchTop === 5)

// ── 工具行为 ────────────────────────────────────────────────────────────────
const r1 = await tool.execute({ query: '\u63d2\u4ef6 \u4e2d\u6bd2', top: 3 })
ck('检索 ok=true', r1.ok === true)
ck('检索有内容', typeof r1.text === 'string' && r1.text.length > 0)
console.log('     → ' + (r1.text || '').split('\n').slice(0, 3).join(' | '))
const r2 = await tool.execute({ stats: true })
ck('stats 模式 ok=true', r2.ok === true)
const r3 = await tool.execute({})
ck('空 query 被拒绝', r3.ok === false)

server.close()
console.log('\nRESULT fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
