# dsh-memory-md

**Minimal long-term memory for [DeepSeek Harness](https://www.deepseek.com/harness) (dsh) — CJK-friendly, Markdown-native, no web surface required.**

极简长期记忆插件：**中文能搜、Markdown 可直接编辑、不依赖 web**。

[![npm](https://img.shields.io/npm/v/dsh-memory-md)](https://www.npmjs.com/package/dsh-memory-md)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![repo](https://img.shields.io/badge/github-smallwhitelin%2Fdsh-memory-md-blue)](https://github.com/smallwhitelin/dsh-memory-md)

---

## 为什么有它 / Why

dsh 本体不带记忆插件；社区插件大多走 SQLite FTS5 或需要 web 界面。两个坑：

1. **中文搜不到**：FTS5 默认分词器把一整串中文当一个词 —— 「我最喜欢的颜色是墨绿色」搜「墨绿色」是 0 命中；
2. **要 web**：不少插件 `inject: ['webServer']`，在纯 IM（飞书/微信这类没有 web 表面的）profile 里会让整棵插件树启动失败。

本插件就为这两点而生：

- 检索用**大小写不敏感的子串匹配** —— 中文任意词、英文、几个字都能搜到，不碰分词器；
- 只 `inject: ['tools', 'systemPrompt']` —— 有 IM 界面就能跑，**不需要 web**；
- 真源是一份**人类可直接编辑的 Markdown**，不是数据库。

## 定位：显性记忆 / Explicit memory

用户说「记住…」→ 模型调 `memory_add`；说「改成…」→ `memory_replace`；说「忘掉…」→ `memory_remove`。
**不自动沉淀、不调额外模型、不建索引** —— 存什么由你决定，读得到、改得动。

## 安装 / Install

**方式 A —— 直接从 GitHub（不需要任何账号）**

```bash
dsh plugin --profile <你的 profile> add github:smallwhitelin/dsh-memory-md
```

**方式 B —— npm（发布后）**

```bash
dsh plugin --profile <你的 profile> add dsh-memory-md
```

**方式 C —— 手写 profile 的 `cordis.patch.yml`**

```bash
dsh plugin --profile <你的 profile> add dsh-memory-md
```

```yaml
- insert:
    - id: memory-md
      name: 'dsh-memory-md'
      config:
        path: !!js dshHomePath('memory/MEMORY.md')
        maxInjectChars: 3000
```

改完重启该 profile 的服务（或它支持热重载时自动生效）。

## 记忆文件 / The memory file

默认 `~/.dsh/memory/MEMORY.md`（由配置 `path` 决定）：

```markdown
# 记忆

<!-- 每行一条，`- 内容`；直接编辑这个文件即可，改动下一轮生效 -->

- 用户习惯用中文回复
- 用户最喜欢的颜色是墨绿色
- 部署机 workspace 是 /home/zero/workspace
```

- **直接用编辑器改**：加一行、删一行、改一句话都行，**下一轮对话立刻生效**（每轮重新读文件）；
- 插件只改目标那一行，不重写整份文件，不覆盖你手写的内容；
- 写入是原子的（写 `.tmp` 再 rename），不会出现半截文件。

## 工具 / Tools

| 工具 | 作用 | 匹配 |
|---|---|---|
| `memory_add(text)` | 新增一条（完全相同的内容自动跳过） | — |
| `memory_replace(old_text, new_text)` | 改一条（整行替换，条目位置不变） | 大小写不敏感**子串**，需唯一命中 |
| `memory_remove(old_text)` | 删一条 | 同上 |
| `memory_search(query)` | 搜索（中文任意词可搜） | 同上 |

用**子串定位**而不是 id：你手工编辑文件后，引用不会失效。匹配到多条会明确报错（写具体点重试），不会误改。

## 注入 / Injection

记忆内容作为系统提示词的一个段落注入（默认上限 `maxInjectChars: 3000`，超出截断并提示改用 `memory_search`）。
所以它是「稳定事实清单」，不适合堆成知识库。

## 配置 / Config

| 键 | 默认 | 说明 |
|---|---|---|
| `path` | 必填 | Markdown 记忆文件路径（推荐 `!!js dshHomePath('memory/MEMORY.md')`） |
| `maxInjectChars` | 3000 | 每轮注入的字符上限 |
| `searchLimit` | 20 | `memory_search` 单次最多返回条数 |
| `order` | 50 | 提示词段落顺序 |

## 兼容性 / Compatibility

- Node ≥ 24（dsh 本身的硬要求）；零运行时依赖（只用 `node:fs`/`node:path`）；
- 不联网、不起子进程、不写任何数据库；
- **不依赖 web 表面** —— 纯 IM profile（如 `@dsh-feishu/dsh-feishu`）可直接使用。

## 卸载 / Uninstall

删掉 profile 里那一行 + 重启服务。Markdown 文件留在原地，记忆不会丢。

## License

MIT
