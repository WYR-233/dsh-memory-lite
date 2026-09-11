// 投稿 awesome-dsh-plugin:fork（复用已有 fork）→ 写条目 YAML → 开 PR
// 用法：GH_TOKEN=<token> node submit-awesome.mjs
const TOKEN = process.env.GH_TOKEN
const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const OWNER = 'WYR-233'
const PLUGIN_REPO = 'WYR-233/dsh-memory-lite'
const REPO_NAME = 'dsh-memory-lite'
const FILE = `data/plugins/${OWNER}__dsh-memory-lite.yml`
const CATEGORY = 'memory'
const headers = { authorization: `token ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'dsh-whalemaid', 'content-type': 'application/json' }

async function call(method, url, body) {
  const r = await fetch(url.startsWith('http') ? url : 'https://api.github.com' + url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json = null; try { json = JSON.parse(text) } catch { }
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 300)}`)
  return json
}

// 1) fork（存在则复用）
let fork = null
try { fork = await call('GET', `/repos/${OWNER}/${REPO_NAME}`) } catch { fork = null }
if (fork === null || fork.fork !== true) {
  fork = await call('POST', `/repos/${UPSTREAM}/forks`)
  console.log('fork created:', fork.full_name)
} else {
  console.log('fork exists:', fork.full_name)
}
for (let i = 0; i < 20; i++) {
  const f = await call('GET', `/repos/${OWNER}/${REPO_NAME}`)
  if (f.size > 0 || i > 5) { console.log('fork ready, size =', f.size, 'default branch =', f.default_branch); break }
  await new Promise((r) => setTimeout(r, 3000))
}

// 2) 写条目文件
const yaml = [
  `url: https://github.com/${PLUGIN_REPO}`,
  `name: ${PLUGIN_REPO}`,
  `category: ${CATEGORY}`,
  'description:',
  '  en: Read-only enhancer for a file-based long-term memory library (markdown cards in git): a memory_find search tool, a small budgeted memory digest injected into the system prompt, and a settings page with library overview, health-check status and toggles.',
  '  zh: 面向「纯文件（markdown 卡片 + git）长期记忆库」的只读增强插件：memory_find 检索工具、一小段受预算约束的记忆库摘要注入，以及带概览/健康/开关的设置页。',
  `tarball: https://github.com/${PLUGIN_REPO}/releases/latest/download/dsh-memory-lite.tgz`,
  '',
].join('\n')
const content = Buffer.from(yaml, 'utf8').toString('base64')
let put = null
try {
  put = await call('PUT', `/repos/${OWNER}/${REPO_NAME}/contents/${FILE}`, { message: `Add ${PLUGIN_REPO}`, content, branch: 'main' })
  console.log('file created:', put.content.path, put.commit.sha.slice(0, 8))
} catch (e) {
  const existing = await call('GET', `/repos/${OWNER}/${REPO_NAME}/contents/${FILE}?ref=main`)
  put = await call('PUT', `/repos/${OWNER}/${REPO_NAME}/contents/${FILE}`, { message: `Update ${PLUGIN_REPO}`, content, branch: 'main', sha: existing.sha })
  console.log('file updated:', put.content.path, put.commit.sha.slice(0, 8))
}

// 3) 开 PR
const pr = await call('POST', `/repos/${UPSTREAM}/pulls`, {
  title: `Add ${PLUGIN_REPO} (${CATEGORY})`,
  head: `${OWNER}:main`,
  base: 'main',
  body: [
    '**Plugin**: https://github.com/' + PLUGIN_REPO,
    '',
    'Adds a single entry file `' + FILE + '` (' + CATEGORY + ').',
    '',
    '- `dsh.bundle.patch` is declared in package.json and the repo ships `cordis.patch.yml`.',
    '- Installable via `dsh plugin --profile web add github:' + PLUGIN_REPO + '`; a prebuilt tarball is attached to the latest GitHub Release (asset name carries no version).',
    '- `@deepseek-ai/cordis` is declared as a peerDependency with a stable range (`^4.0.1`); the plugin itself has zero runtime dependencies.',
    '- `dsh-plugin` topic is set on the repository.',
    '',
    'What it does: points at any markdown-card long-term memory library and gives the agent a `memory_find` tool (CJK bigram / Latin whole-word matching, weighted title ×6 / keywords ×4 / body ×1) plus a small, budgeted digest section in the system prompt ("search the library before guessing"). A settings page shows card count, body size, topics, the last health-check result, and exposes toggles for the digest, the tool, the digest budget and the search result limit.',
    '',
    'It deliberately never writes to the library, never rewrites conversation history, and ships no database or cache — the only state is one small JSON config written atomically.',
  ].join('\n'),
})
console.log('PR opened:', pr.number, pr.html_url)
