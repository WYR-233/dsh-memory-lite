// Client-half smoke check — 在 node 里用「迷你浏览器 + 迷你 React」把 lib/client.js 跑起来：
//   · 走一遍 __ModuleLoader__ / factory(require) 的真实路径
//   · apply(ctx) 后把每个槽位注册的组件**递归渲染一遍**（函数组件真的被调用，能被未定义变量/拼写错误绊倒）
//   · 校验 i18n：源码里用到的 t.<key> 必须在 TEXT.zh / TEXT.en 里都存在
// 用法：node tools/clientcheck.mjs   （tools/selftest.mjs 会自动调用它）
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let fail = 0
const ck = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) fail++ }

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

// ---------- 迷你 React：够跑函数组件（不跑 effect，不重渲染）----------
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: 'Fragment',
  useState: (init) => [typeof init === 'function' ? init() : init, () => { }],
  useMemo: (fn) => fn(),
  useRef: (init) => ({ current: init }),
  useEffect: () => { },
  useSyncExternalStore: (_sub, get) => get(),
}

let captured = null
const registrations = []
const context = {
  React,
  console,
  setTimeout,
  clearTimeout,
  JSON, Object, Array, String, Number, Boolean, Math, Date, RegExp, Error, Set, Map, Promise,
  navigator: { language: 'zh-CN', platform: 'Linux', clipboard: { writeText() { } } },
  fetch: () => Promise.resolve({ json: () => Promise.resolve({ ok: false }) }),
  window: { __ModuleLoader__: { load: (def) => { captured = def } }, location: { reload() { } }, open() { } },
}
context.globalThis = context
vm.createContext(context)
vm.runInContext(src, context, { filename: 'lib/client.js' })

ck('client half registers itself through __ModuleLoader__', captured !== null && captured.id === 'dsh-memory-lite')
const clientExports = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
})
ck('exports inject + apply', Array.isArray(clientExports.inject) && typeof clientExports.apply === 'function')
// 接线断言：apply 里必须存下插件上下文、并注入侧栏样式 —— 这两件事都曾静默丢失过
ck('apply wires pluginCtx', /pluginCtx\s*=\s*ctx/.test(src))
ck('apply injects footer styles', /injectFooterStyles\(\);/.test(src))
ck('footer entry carries its style hook attribute', /data-memlite-footer/.test(src))

const slots = {
  inject: (_key, cb) => cb(),
  register: (decl, component) => { registrations.push({ decl, component }); return () => { } },
}
clientExports.apply({ slots, get: () => null, effect: (fn) => fn() })

const slotNames = registrations.map((r) => r.decl.name)
ck('registers settings.section', slotNames.includes('settings.section'))
ck('registers conversation.composer.dock (discovery notice)', slotNames.includes('conversation.composer.dock'))
ck('registers plugins.bundle.config (plugin page card)', slotNames.includes('plugins.bundle.config'))
const bundleCard = registrations.find((r) => r.decl.name === 'plugins.bundle.config')
ck('plugin card is keyed by the package name', bundleCard && bundleCard.decl.key === 'dsh-memory-lite')

// ---------- 递归渲染（函数组件真的被调用，depth 兜底防死循环）----------
const renderNode = (node, depth = 0) => {
  if (depth > 40 || node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((n) => renderNode(n, depth + 1)).join('')
  if (typeof node.type === 'function') return renderNode(node.type(node.props), depth + 1)
  return (node.children || []).map((c) => renderNode(c, depth + 1)).join('')
}

for (const reg of registrations) {
  const label = reg.decl.name + ' (' + reg.decl.id + ')'
  try {
    const html = renderNode(typeof reg.component === 'function' ? reg.component({ api: '/memory-lite', view: 'page' }) : null)
    ck('renders ' + label, typeof html === 'string')
  } catch (error) {
    ck('renders ' + label + ' — ' + (error && error.message ? error.message : error), false)
  }
}

// ---------- i18n 完整性 ----------
const textStart = src.indexOf('const TEXT = {')
const textBlock = src.slice(textStart, src.indexOf('function fmtNum'))
// 一行里可能有好几个键（如 `cards: "卡片", cardUnit: "张",`），所以按全局匹配取所有 key:
const keys = new Set([...textBlock.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]))
ck('i18n has a healthy amount of keys', keys.size > 60)
const used = new Set([...src.matchAll(/\bt\.([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]))
const missing = [...used].filter((k) => !keys.has(k))
ck('every t.<key> used in the client exists in TEXT (' + used.size + ' used)', missing.length === 0)
if (missing.length > 0) console.log('     ⚠ missing keys: ' + missing.join(', '))

console.log('\nRESULT fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
