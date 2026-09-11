// dsh-memory-lite — 只读记忆库增强插件(片②D 首片)
// 两件事，都不写记忆库文件：
//   1) 注册 memory_find 工具 → 调用记忆库里的检索脚本找卡片（省 token，替代 glob/盲翻目录）
//   2) 注册一段 systemPrompt 摘要 → 开场注入记几个主题、卡片放在哪、规矩指向哪
// 设计红线（见 记忆库 片②方案文档）：
//   · 只读：不写卡片、不 commit、不 push（机械动作交给 memory-guard 计划任务）
//   · 纯追加：只注册 systemPrompt section，绝不改写会话历史
//   · 硬预算：注入文本控制在 ~600 字符内，只注索引不注卡片全文
//   · 可回滚：卸插件即恢复原样，不留数据
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'memory-lite'
export const inject = ['tools', 'systemPrompt']

const ROOT = process.env.DSH_MEMORY_ROOT || 'G:\\deepseek\\deepseek-memory'
const FIND_SCRIPT = join(ROOT, 'tools', 'memory-find.mjs')
const INDEX_FILE = join(ROOT, 'INDEX.md')
const RULES_FILE = join(ROOT, 'RULES.md')

function runFind(args, timeoutMs) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(process.execPath, [FIND_SCRIPT, ...args], { windowsHide: true })
    } catch (error) {
      resolve({ ok: false, text: '', error: String(error && error.message ? error.message : error) })
      return
    }
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { err += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, text: '', error: String(error && error.message ? error.message : error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, text: out.trim(), error: err.trim() })
    })
  })
}

function readRulesHead() {
  try {
    const lines = readFileSync(RULES_FILE, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const m = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*/)
      if (m) return m[2].replace(/\s+/g, ' ').slice(0, 60)
    }
  } catch { /* 记忆库不在就静默降级 */ }
  return ''
}

function memoryIndex() {
  let topics = []
  try {
    const text = readFileSync(INDEX_FILE, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(memory[\\/][^|]+?)\s*\|\s*$/)
      if (m) topics.push(`${m[1].trim()}(${m[2].trim().slice(0, 26)})`)
    }
  } catch { return null }
  if (topics.length === 0) return null
  const shown = topics.slice(0, 18).join('、')
  const more = topics.length > 18 ? ` 等 ${topics.length} 个主题` : ''
  const rule = readRulesHead()
  return [
    `记忆库（外置笔记本，md + Git）：${ROOT}`,
    `主题：${shown}${more}。（完整目录见 INDEX.md）`,
    '要用记忆里的旧结论时，先调 memory_find 检索卡片，别 glob、别盲翻目录；开场接力按 memory-hygiene skill 走。',
    `写入规矩见 RULES.md${rule ? `（开篇第 1 条：${rule}）` : ''}；写卡后无需手动 push，计划任务 MemoryGuard 每 30 分钟自动提交推送。`,
  ].join('\n')
}

function renderFind(value) {
  if (!value || value.ok !== true) {
    return [{ type: 'text', text: `memory_find 调用失败：${(value && value.error) || '未知错误'}\n记忆库根：${ROOT}` }]
  }
  return [{ type: 'text', text: value.text || '（检索无输出）' }]
}

export function apply(ctx) {
  if (process.env.DSH_MEMORY_LITE_DEBUG === '1') {
    console.log('[memory-lite] apply: 注册 memory_find 工具' + (memoryIndex() === null ? '（INDEX 未找到，跳过摘要注入）' : ' + 注入摘要'))
  }
  ctx.tools.register({
    name: 'memory_find',
    description: '在鲸鱼娘记忆库（md 卡片 + Git，跨会话长期记忆）里检索。中文按相邻双字词匹配、英文整词，'
      + '按「标题 ×6 / 关键词 ×4 / 正文 ×1」加权排序，返回最相关的卡片路径 + 命中词 + 原文片段，'
      + '随后用 read 打开命中的卡片即可。当需要回忆以前的结论、坑、路径、配置、项目进展时用它，'
      + '比 glob 或逐层翻目录更省 token、更不容易漏。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索词，一次 2~4 个词最好（如「插件 中毒」「片② 方案」「MiniMax TTS」）。连写长词会被切成双字词而漏命中。',
        },
        top: {
          type: 'number',
          description: '返回条数，默认 5，最大 20。',
        },
        stats: {
          type: 'boolean',
          description: '设为 true 时只返回记忆库概览（卡片总数、字符量、最长卡片），忽略 query。',
        },
      },
      required: [],
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => renderFind(value),
    },
    timeoutMs: 30_000,
    async execute(args) {
      const argv = []
      if (args.stats === true) {
        argv.push('--stats')
      } else {
        const query = String(args.query ?? '').trim()
        if (query === '') {
          return { ok: false, error: '缺少 query（或把 stats 设为 true 看库概览）' }
        }
        argv.push(query)
        const top = Math.max(1, Math.min(Number(args.top ?? 5) || 5, 20))
        argv.push('--top', String(top))
      }
      const result = await runFind(argv, 20_000)
      return {
        ok: result.ok,
        text: result.text,
        error: result.ok ? undefined : (result.error || '检索脚本返回非零退出码'),
        query: String(args.query ?? ''),
      }
    },
  })

  const index = memoryIndex()
  if (index !== null) {
    ctx.systemPrompt.section({
      name: 'memory-lite',
      order: 120,
      text: index,
    })
  }
}
