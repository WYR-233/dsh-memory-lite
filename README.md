# dsh-memory-lite

Read-only enhancer for a **file-based long-term memory library** (markdown cards kept in git) in
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

> MIT · zero runtime dependencies · host + settings page · 中文说明见文末

## What it does

| Feature | Detail |
| --- | --- |
| `memory_find` tool | Searches the library's cards: CJK by adjacent bigrams, Latin by whole words, weighted title ×6 / keywords ×4 / body ×1. Returns card paths + matched terms + a snippet, then the agent opens the card with `read`. |
| Memory digest injection | Appends one small `systemPrompt` section (default ≤900 chars, configurable): where the library is, which topics exist, and "search it before guessing". |
| Settings page | A "Memory library" section under DSH Settings: a **governance dashboard** (opening tax, scale & trend, layer health, consolidation, guard & backup, search tools), slider+number thresholds, seven one-click actions (checkup / backup / governance scan / new chat + prompt / prompt templates / in-panel search / open the memory site), and toggles (digest on-off, tool on-off, digest budget, search limit). |

| Built-in search engine | The reference ranking (CJK bigrams, title ×6 / keywords ×4 / body ×1, synonym groups, idf weighting) is compiled into the plugin, so search works with **zero setup**; `searchMode: 'script'` still honours an external search script. |
| One-click library | Pick a folder with the host's native directory picker, or create a library in one click: scaffolded `INDEX.md`, a sample topic folder, a sample card and a usage note. The chosen path lives in this machine's runtime config, so Windows and Linux each keep their own and nothing is typed by hand. |
| `/memory` command + bundled skill | A slash command (`status` / `search` / `init` / `root`) plus a `memory-library` skill that teaches any agent the workflow — search first, write cards on real progress, keep the library small — so no preset is required. |

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

## 60-second start (even if you have no memory library yet)

1. Install the plugin, then open **Settings → Memory library**.
2. Click **Create a new library** — or **Choose an existing folder…** if you already keep markdown
   notes somewhere. The path is written to this machine's own runtime config (`<DSH_HOME>/memory-lite/config.json`),
   so two operating systems never fight over one value, and the picker always yields a native absolute path.
3. That's it: the scaffold (`INDEX.md`, a sample topic, a sample card, a short usage note) is created
   and the built-in search engine is ready — **no external script needed**.

Prefer to let an agent do the shaping? **Let an agent initialise it** copies an initialisation prompt
and opens a new chat, so the agent can ask what you want to remember and build the topic folders.

### Where you will meet it

| Where | What you get |
| --- | --- |
| Settings → Memory library | the dashboard: opening tax, scale & trend, layer health, consolidation, guard/backup, tools |
| Composer: `/memory` | `status` · `search <words>` · `init [folder]` · `root <folder>` |
| `memory_find` tool | the agent searches the library before guessing |
| Plugins page | a card for this bundle showing whether a library is configured |
| Below the composer | a one-line notice while no library is configured yet (dismissible) |

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

### Governance dashboard (0.3.0)

Beyond the digest and the search tool, the settings page is a read-mostly **governance dashboard**:
six data blocks (opening tax of the always-read files vs a configurable budget, library scale and a
7-day trend snapshot, layer health with oversized-card and duplicate-title lists, consolidation
status, git/guard/backup status, search-tool stats) plus six slider+number controls and a handful of
one-click actions. Extra host routes:

| Route | Purpose |
| --- | --- |
| `GET /memory-lite/dashboard` | all six blocks in one response (used by the panel) |
| `GET /memory-lite/search?q=&top=` | run the search script from the panel |
| `POST /memory-lite/run` | `{"action":"checkup"｜"backup"｜"scan"}` — runs the configured guard/backup script, or a pure in-host governance scan |

Extra config keys (all optional, no path is hard-coded in the code):

```yaml
- id: memory-lite
  config:
    taxFiles: [RULES.md, INDEX.md]          # files counted as the "opening tax"
    guardScript: ~/bin/my-guard.sh          # run by the checkup button
    backupScript: ~/bin/my-backup.sh        # run by the backup button
    backupDir: ~/backups                    # newest artifact is shown in the panel
    guardLog: ~/logs/my-guard.log           # last guard run
    coldDir: archive                        # cold area, excluded from search
    synonymFile: ''                         # optional synonym table (groups count shown)
    consolidationDir: ''                    # optional consolidation-card folder
    siteUrl: ''                             # optional library site; empty = no "open site" button
```

Every path above is optional: leave one empty and that block simply shows “—” in the panel. The
plugin ships with no author paths, no domains and no uploads — it never talks to any server of its
own, and the checkup/backup buttons only run scripts you configured yourself.

Thresholds (`taxBudget`, `upkeepDays`, `upkeepCards`, `upkeepHardDays`) live in the runtime config
file and are editable from the panel — nothing is hard-coded in the reminder path either.

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
