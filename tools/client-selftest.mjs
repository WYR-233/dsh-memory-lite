// 静态验证 client.js：模拟 __ModuleLoader__，检查导出与你 inject 短名
import { readFileSync } from "node:fs"
const p = "G:/deepseek/workspace/dsh-memory-lite/lib/client.js"
const src = readFileSync(p, "utf8")
let captured = null
const sandboxWindow = { __ModuleLoader__: { load: (def) => { captured = def } } }
const fakeRequire = (id) => {
  if (id === "react") {
    const R = { createElement: () => null, useState: () => [null, () => {}], useMemo: (f) => f(), useEffect: () => {} }
    return R
  }
  throw new Error("unexpected require: " + id)
}
const fn = new Function("window", "require", "navigator", src)
fn(sandboxWindow, fakeRequire, { language: "zh-CN" })
const asserts = []
const ck = (n, c) => { asserts.push([n, c]); console.log((c ? "PASS " : "FAIL ") + n) }
ck("client.js 注册到 __ModuleLoader__", captured !== null)
ck("id = dsh-memory-lite", captured?.id === "dsh-memory-lite")
const mod = captured.factory(fakeRequire)
ck("exports.apply 存在", typeof mod.apply === "function")
ck("exports.inject 是数组", Array.isArray(mod.inject))
ck("inject 用短名人（无 @deepseek-ai/ 全名）", !JSON.stringify(mod.inject).includes("@deepseek-ai/dsh-client-"))
ck("inject 含 slots", mod.inject.includes("slots"))
// 跑一次 apply，看是否向 settings.section 注册
let slotReg = null
const ctx = { slots: { inject: (name, fn2) => { fn2() }, register: (def, comp) => { slotReg = { def, comp }; return () => {} } } }
mod.apply(ctx)
ck("注册了 settings.section", slotReg?.def?.name === "settings.section")
ck("label 是函数（中英双语）", typeof slotReg?.def?.label === "function")
console.log("     → label(zh) =", slotReg?.def?.label?.())
const bad = asserts.filter(([, c]) => !c).length
console.log("RESULT fail=" + bad)
process.exit(bad === 0 ? 0 : 1)
