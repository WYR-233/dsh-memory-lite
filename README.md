# dsh-memory-lite

Read-only enhancer for a **file-based long-term memory library** (markdown cards kept in git) in
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

> MIT · zero runtime dependencies · host + settings page · 中文说明见文末

## What it does

| Feature | Detail |
| --- | --- |
| `memory_find` tool | Searches the library's cards: CJK by adjacent bigrams, Latin by whole words, weighted title ×6 / keywords ×4 / body ×1. Returns card paths + matched terms + a snippet, then the agent opens the card with `read`. |
| Memory digest injection | Appends one small `systemPrompt` section (default ≤900 chars, configurable): where the library is, which topics exist, and "search it before guessing". |
| Settings page | A "Memory library" section under DSH Settings: card count / body size / topics / last update / longest card, health-checker status, and toggles (digest on-off, tool on-off, digest budget, search limit). |

## What it deliberately does NOT do

- **Never writes** to the library: no card edits, no commits, no pushes. For automation
  (auto-commit, periodic health checks) pair it with your own scheduled script.
- **Never rewrites conversation history** — it only appends one prompt section.
- **No database and no cache**; the only state is one small JSON config file.

## Requirements

- A memory library directory with an index file (default `INDEX.md`) and a search script
  (default `tools/memory-find.mjs`). Any script speaking this contract works:
  `node <script> --stdin --top <n>` (query arrives on stdin) or `--stats` (library overview).
- DSH with `@deepseek-ai/cordis` resolvable in the profile (a normal DSH install).

## Install

```bash
dsh plugin --profile web add github:WYR-233/dsh-memory-lite
```

Then restart that profile.

## Configure

Point it at your library — plugin config in the profile's `cordis.patch.yml`:

```yaml
- id: memory-lite
  config:
    memoryRoot: /absolute/path/to/your-memory-library   # or set env DSH_MEMORY_ROOT
    stateDir: memory-lite                                # optional, relative to $DSH_HOME
    searchScript: tools/memory-find.mjs                  # optional
    indexFile: INDEX.md                                  # optional
```

or simply export:

```bash
DSH_MEMORY_ROOT=/absolute/path/to/your-memory-library
```

Runtime toggles (digest on/off, tool on/off, budget, search limit) are changed in the settings page
and stored in `<stateDir>/config.json` — written atomically, and a parse failure falls back to
defaults instead of silently wiping values.

### Optional: health panel

The Health card reads a log file when `MEMORY_LITE_HEALTH_LOG` points at one, expecting lines like:

```
[2026-01-01 10:00:00] issues=0 notes=2
  issue: <text>
  note: <text>
```

Any scheduled checker writing that shape shows up in the panel automatically.

## How it fits together

This plugin is the thin "read fast" layer. The reference setup it was extracted from keeps memory as
**plain markdown cards in a git repo**, plus an index of topics, a search script, optionally a
periodic commit/health guard, and a rendered website for browsing the same cards. Because the store
is plain files, everything stays human-readable, diffable and editable — that is the whole point.

## 中文说明

只读的**记忆库增强**插件：给 DSH 加一个 `memory_find` 检索工具、开场注入一小段记忆库摘要（默认 ≤900 字符，
可调），并在设置里加一栏「记忆库」侧边栏（概览 / 健康 / 开关）。

- **只读**：不写卡片、不 commit、不 push（自动化请搭配你自己的定时脚本）
- **不改会话历史**：只追加一段 systemPrompt
- **零依赖、无数据库**：唯一状态是一个小配置文件

装好后把 `memoryRoot` 指到你的记忆库目录（或设环境变量 `DSH_MEMORY_ROOT`）即可；开关在设置页改，
即时生效，配置存在 `<stateDir>/config.json`（原子写，坏了回默认，不静默清空）。

## License

MIT
