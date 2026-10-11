// dsh-memory-lite — 内置检索（0.4.0）：零依赖的 markdown 卡片检索，不要求用户先有外部脚本。
//
// 算法与外部 memory-find.mjs 保持一致（同款体验，便于对照）：
//   · 中文按相邻 bigram 切词，英文/数字按整词（长度 ≥2）
//   · 打分：标题 ×6 / 关键词 ×4 / 正文 ×1，各自乘 idf；命中主词种类再 +2.5 覆盖率加成
//   · 同义词表命中 → 整组参与匹配，同义命中权重 ×0.45
//   · 只读，60 秒索引缓存（多个消费者复用一次扫描）
//
// 外部脚本仍然可用：searchMode = 'script' 时改走配置的 searchScript（老用户/特殊库不受影响）。
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const WORDCH = /[\p{L}\p{N}]/u
const DEFAULT_SKIP = ['archive', 'node_modules', '.git', 'assets', 'logs']

/** 切词：CJK 相邻二字成组，Latin/数字整词（≥2 字符）。 */
export function tokenize(str) {
  const out = []
  const s = String(str ?? '').normalize('NFKC').toLowerCase()
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (CJK.test(ch)) {
      const next = s[i + 1]
      if (next && CJK.test(next)) { out.push(ch + next); i++ } else out.push(ch)
    } else if (WORDCH.test(ch)) {
      let w = ch
      while (i + 1 < s.length && WORDCH.test(s[i + 1]) && !CJK.test(s[i + 1])) w += s[++i]
      if (w.length >= 2) out.push(w)
    }
  }
  return out
}

const isSkipped = (name, skip) => skip.has(name)

const walk = (dir, skip, root, out) => {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const entry of entries) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!isSkipped(entry.name, skip)) walk(p, skip, root, out)
      continue
    }
    if (!/\.(md|markdown)$/i.test(entry.name)) continue
    let st
    try { st = statSync(p) } catch { continue }
    out.push({ path: p, rel: relative(root, p).replace(/\\/g, '/'), mtimeMs: st.mtimeMs })
  }
  return out
}

const parseCard = (file) => {
  let text = ''
  try { text = readFileSync(file.path, 'utf8') } catch { return null }
  const lines = text.split(/\r?\n/)
  const title = (lines.find((l) => l.startsWith('# ')) || '').replace(/^#\s*/, '').trim() || basename(file.path, '.md')
  const date = (text.match(/^-\s*日期[：:]\s*(.+)$/m) || [])[1]?.trim()
    || (basename(file.path).match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || ''
  const kw = ((text.match(/关键词[：:]\s*(.+)$/m) || [])[1] || '').trim()
  const body = text.replace(/^#.*$/gm, '')
  return { path: file.path, rel: file.rel, title, date, kw, body, mtimeMs: file.mtimeMs }
}

// 同义词表：一行一组、空格/顿号分隔（组内互为近义）。文件不存在就退化为不联想。
const loadSynonyms = (synonymFile) => {
  const map = new Map()
  let txt = ''
  try { txt = readFileSync(synonymFile, 'utf8') } catch { return map }
  for (const line of txt.split(/\r?\n/)) {
    const s = line.trim()
    if (s === '' || /^[#>|\-*]/.test(s)) continue
    const words = s.split(/[\s，,、|]+/).filter((w) => w.length >= 2)
    if (words.length < 2) continue
    const toks = new Set()
    for (const w of words) for (const t of tokenize(w)) toks.add(t)
    for (const t of toks) {
      if (!map.has(t)) map.set(t, new Set())
      for (const t2 of toks) map.get(t).add(t2)
    }
  }
  return map
}

let indexCache = { key: '', at: 0, index: null }

/** 建索引（带 60 秒缓存）：卡片清单 + 各自的分词结果 + df 表。 */
export function buildIndex({ root, skipDirs, synonymFile = '' }) {
  const skip = new Set([...(skipDirs || []), ...DEFAULT_SKIP])
  const key = `${root}|${synonymFile}|${[...skip].sort().join(',')}`
  if (indexCache.index && indexCache.key === key && Date.now() - indexCache.at < 60_000) return indexCache.index
  const cards = walk(root, skip, root, []).map(parseCard).filter(Boolean)
  const indexed = cards.map((card) => {
    const titleToks = tokenize(`${card.title} ${basename(card.path)} ${card.date}`)
    const kwToks = tokenize(card.kw)
    const bodyToks = tokenize(card.body)
    return { card, titleToks, kwToks, bodyToks }
  })
  const df = new Map()
  for (const idx of indexed) {
    for (const t of new Set([...idx.titleToks, ...idx.kwToks, ...idx.bodyToks])) df.set(t, (df.get(t) || 0) + 1)
  }
  const index = { cards, indexed, df, synonyms: synonymFile ? loadSynonyms(synonymFile) : new Map() }
  indexCache = { key, at: Date.now(), index }
  return index
}

const snippet = (body, hits, full) => {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== '')
  const best = lines.find((l) => hits.some((h) => l.includes(h))) || lines.find((l) => l.length > 12) || ''
  const max = full ? 400 : 160
  return best.length > max ? `${best.slice(0, max)}…` : best
}

/** 检索：返回 { ok, text, count, total, results }。text 与外部脚本的输出格式一致。 */
export function searchLibrary({ root, query, top = 5, full = false, skipDirs, synonymFile = '', pathFilter = '' }) {
  const q0 = String(query ?? '').trim()
  if (q0 === '') return { ok: false, count: 0, total: 0, text: '', error: 'missing query' }
  const index = buildIndex({ root, skipDirs, synonymFile })
  const indexed = index.indexed
  const N = indexed.length
  const qset = [...new Set(tokenize(q0))]
  if (qset.length === 0) return { ok: true, count: 0, total: N, text: '查询词太短（至少两个汉字，或一个两字母以上的单词）', results: [] }

  const syn = index.synonyms
  const synExtra = new Set()
  for (const t of qset) for (const w of (syn.get(t) || [])) if (!qset.includes(w)) synExtra.add(w)
  const qAll = [...qset, ...synExtra]
  const wOf = (t) => (synExtra.has(t) ? 0.45 : 1)
  const idf = (t) => Math.log(1 + (N - (index.df.get(t) || 0) + 0.5) / ((index.df.get(t) || 0) + 0.5))

  const filter = pathFilter.toLowerCase()
  const results = indexed
    .filter(({ card }) => filter === '' || card.rel.toLowerCase().includes(filter))
    .map((idx) => {
      const inTitle = qAll.filter((t) => idx.titleToks.includes(t))
      const inKw = qAll.filter((t) => idx.kwToks.includes(t))
      const inBody = qAll.filter((t) => idx.bodyToks.includes(t))
      let s = 0
      for (const t of inTitle) s += 6 * idf(t) * wOf(t)
      for (const t of inKw) s += 4 * idf(t) * wOf(t)
      for (const t of inBody) s += 1 * idf(t) * wOf(t)
      const covered = new Set(qset.filter((t) => !synExtra.has(t)
        && (idx.titleToks.includes(t) || idx.kwToks.includes(t) || idx.bodyToks.includes(t)))).size
      s += covered * 2.5
      return { card: idx.card, kwToks: idx.kwToks, score: s, hits: [...new Set([...inTitle, ...inKw, ...inBody])] }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, top))

  if (results.length === 0) {
    return { ok: true, count: 0, total: N, text: `没有卡片命中「${q0}」——换个说法或减少关键词再试`, results: [] }
  }
  const lines = [`查询「${q0}」命中 ${results.length} 张（库内共 ${N} 张）`, '']
  for (const r of results) {
    lines.push(`▸ ${r.card.rel}`)
    lines.push(`  标题：${r.card.title}`)
    lines.push(`  日期：${r.card.date}${r.card.kw ? `  | 关键词命中：${r.hits.filter((h) => r.kwToks.includes(h)).join(' ')}` : ''}`)
    lines.push(`  片段：${snippet(r.card.body, r.hits, full)}`)
    lines.push('')
  }
  return {
    ok: true, count: results.length, total: N, text: lines.join('\n'),
    results: results.map((r) => ({ rel: r.card.rel, title: r.card.title, date: r.card.date, score: Math.round(r.score * 100) / 100 })),
  }
}

/** 库概览（等价于外部脚本的 --stats），给面板/命令用。 */
export function libraryStats({ root, skipDirs }) {
  const index = buildIndex({ root, skipDirs })
  const cards = index.cards
  const totalChars = cards.reduce((n, c) => n + c.body.length, 0)
  const byZone = new Map()
  const byTopic = new Map()
  for (const c of cards) {
    const parts = c.rel.split('/')
    const zone = parts.length >= 3 ? parts[0] : '(root)'
    const topic = parts.length >= 3 ? parts[1] : (parts.length === 2 ? parts[0] : '(root)')
    byZone.set(zone, (byZone.get(zone) || 0) + 1)
    byTopic.set(topic, (byTopic.get(topic) || 0) + 1)
  }
  const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])
  const longest = [...cards].sort((a, b) => b.body.length - a.body.length).slice(0, 5)
  const zones = sorted(byZone).map(([k, v]) => `${k}=${v}`).join('  ')
  const topics = sorted(byTopic)
  const text = [
    `卡片总数：${cards.length}`,
    `正文总字符：${totalChars}（约 ${Math.round(totalChars / 3.2)} token 量级，全读一遍的粗估）`,
    `分区：${zones}`,
    '最长卡片：',
    ...longest.map((c) => `  ${c.rel}  ${c.body.length} 字符`),
  ].join('\n')
  return { ok: true, cards: cards.length, chars: totalChars, zones: sorted(byZone), topics, longest, text }
}
