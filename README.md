# dsh-memory-lite

只读的**记忆库增强**插件：给 DSH 加一个 `memory_find` 检索工具，并在开场注入一小段记忆库摘要。
配合「md 卡片 + Git 版本化 + 可视化网站」的白盒记忆库使用（例如鲸鱼娘的 `deepseek-memory`）。

## 它做什么

| 能力 | 说明 |
| --- | --- |
| `memory_find` 工具 | 在记忆库 md 卡片里检索：中文按相邻双字词、英文按整词匹配，按「标题 ×6 / 关键词 ×4 / 正文 ×1」加权，返回卡片路径 + 命中词 + 原文片段 |
| 开场摘要注入 | 往 system prompt 追加一小段（≤600 字符）：记忆库路径、主题清单、规矩提示——**只注索引，不注卡片全文** |

## 它不做什么（设计红线）

- **不写**记忆库：不写卡片、不 commit、不 push（机械动作交给外部的定时守卫脚本）
- **不改会话历史**：只注册一个 systemPrompt section，纯追加
- **不留数据**：没有数据库、没有缓存、卸载即净（零运行时依赖，只用 Node 内置模块）

## 安装

```bash
dsh plugin --profile web add github:WYR-233/dsh-memory-lite
```

重启该 profile 后生效。

## 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `DSH_MEMORY_ROOT` | `G:\deepseek\deepseek-memory` | 记忆库根目录 |

> 依赖仓库里的 `tools/memory-find.mjs` 检索脚本（见记忆库项目的片② B/E 方案）。
> 脚本缺失时插件会优雅降级：工具调用返回错误说明，摘要注入跳过。

## 用法示例

- 「以前那次插件中毒是怎么解决的？」→ 模型会自动 `memory_find("插件 中毒")`，再 `read` 命中的卡片
- 「记忆库现在多大？」→ `memory_find(stats: true)`

## 许可

MIT
