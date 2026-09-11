// 单元验证（不启动 DSH）：mock 一个 ctx，检查工具是否注册、execute 是否真能检索。
// 用法：node tools/selftest.mjs      （纯 Node 内置模块，任意目录可跑）
// 2026-09-11 首次运行：12 项断言全绿；期间抓到「中文查询经 spawn argv 丢失」的坑，故改走 stdin。
import { apply, name, inject } from '../lib/index.js'

let fail = 0
const ck = (label, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) fail++ }

console.log('plugin name =', name, '| inject =', JSON.stringify(inject))

const registered = []
const sections = []
const ctx = {
  tools: { register: (def) => { registered.push(def); return () => {} } },
  systemPrompt: { section: (def) => { sections.push(def); return () => {} } },
}

apply(ctx)

ck('注册了 1 个工具', registered.length === 1)
const tool = registered[0]
ck('工具名 = memory_find', tool?.name === 'memory_find')
ck('有 parameters 对象', tool?.parameters?.type === 'object')
ck('有 execute 函数', typeof tool?.execute === 'function')
ck('注册了 systemPrompt section', sections.length === 1)
ck('section name = memory-lite', sections[0]?.name === 'memory-lite')
ck('section order 是数字', typeof sections[0]?.order === 'number')
const text = String(sections[0]?.text ?? '')
ck('注入文本非空', text.length > 0)
ck('注入文本 ≤ 900 字符（硬预算）', text.length <= 900)

console.log('\n--- execute(query) ---')
const r1 = await tool.execute({ query: '\u63d2\u4ef6 \u4e2d\u6bd2', top: 3 })
ck('检索 ok=true', r1.ok === true)
ck('检索有内容', typeof r1.text === 'string' && r1.text.length > 0)
console.log((r1.text || '').split('\n').slice(0, 4).join('\n'))

console.log('\n--- execute(stats:true) ---')
const r2 = await tool.execute({ stats: true })
ck('stats ok=true', r2.ok === true)
console.log((r2.text || '').split('\n').slice(0, 2).join('\n'))

console.log('\n--- execute(空 query) ---')
const r3 = await tool.execute({})
ck('空 query 被拒绝', r3.ok === false)

console.log('\nRESULT fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
