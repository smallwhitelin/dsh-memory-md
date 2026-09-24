/**
 * memory-md —— 极简 Markdown 记忆（dsh 插件）
 *
 * 设计目标（就三条）：
 *   1. 中文能记住、能搜到 —— 检索用大小写不敏感的子串匹配，不依赖 FTS 分词器；
 *   2. 真源是一个人类可直接编辑的 Markdown 文件；
 *   3. 不依赖任何 web 服务（inject 只要 tools + systemPrompt），飞书这类纯 IM 界面也能跑。
 *
 * 定位是「显性记忆」：用户说「记住…」时模型调 memory_add；说「改成…」调 memory_replace；
 * 说「忘掉…」调 memory_remove。不做自动沉淀、不调额外模型、不引入数据库。
 *
 * 文件格式：一个 Markdown 文件，条目就是普通的 `- 内容` 行，插件只碰目标那一行，
 * 你手写的行同样有效（不会被覆盖，改动立刻生效 —— 每轮都重新读文件）。
 *
 * 工具：memory_add / memory_replace / memory_remove / memory_search
 * 安装：profile 的 cordis.patch.yml 里 insert 一行，name 写包名 'dsh-memory-md'。
 * 卸载：删掉那行 + 重启即可，Markdown 文件留在原地（记忆还在）。
 */

import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const name = "memory-md";
export const inject = ["tools", "systemPrompt"];

export const Config = z.object({
  path: z.string().required(),
  maxInjectChars: z.number().default(3000),
  searchLimit: z.number().default(20),
  order: z.number().default(50),
});

const HEADER = "# 记忆\n\n";
const SECTION_HINT = "<!-- 每行一条，`- 内容`；直接编辑这个文件即可，改动下一轮生效 -->\n\n";

const ADD_DESC =
  "把一条事实写进长期记忆（跨会话）。用户在对话里明确要求记住某件事时调用。" +
  "只记稳定、可复用的事实：偏好、约定、决策及原因、环境细节。不要把临时任务状态、密钥、代码里已有的东西写进来。" +
  "写完立刻生效，之后的每轮对话都会带上它。";
const REPLACE_DESC =
  "修改一条已存记忆：把包含 old_text 的那一条整条换成 new_text。" +
  "用于事实变了（例如「最喜欢的颜色从墨绿色变成深蓝色」）。old_text 要能唯一匹配到一条，匹配到多条会报错，请写得更具体些。";
const REMOVE_DESC =
  "删除一条已存记忆：删掉包含 old_text 的那一行。用于事实已作废。old_text 需要唯一匹配。";
const SEARCH_DESC =
  "在长期记忆里做子串搜索（中文可直接搜任意词）。记忆文件已经随上下文带给你了，只有需要翻找更早或更具体的内容时才用它。";

/** 归一化：去首尾空白、内部连续空白压成一个空格，用于去重与相等判断。 */
function normalize(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

/** 把文件读成行数组；文件不存在时返回初始化好的空文件内容。 */
function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n");
}

/** 原子写：先写临时文件再 rename，避免半截文件。 */
function writeLines(path, lines) {
  mkdirSync(dirname(path), { recursive: true });
  if (lines.length === 0 || normalize(lines.join("")) === "") {
    lines = [HEADER.trimEnd(), "", SECTION_HINT.trimEnd(), ""];
  }
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, lines.join("\n"));
  renameSync(tmp, path);
}

/** 取所有记忆条目：`- ` 开头的行，返回 {index, text}。 */
function entries(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*[-*]\s+(.*)$/.exec(lines[i]);
    if (m !== null && normalize(m[1]).length > 0) out.push({ index: i, text: normalize(m[1]) });
  }
  return out;
}

/** 大小写不敏感的子串匹配 —— 中文天然可用，不涉及分词。 */
function matchEntries(lines, needle) {
  const q = normalize(needle).toLowerCase();
  if (q.length === 0) return [];
  return entries(lines).filter((e) => e.text.toLowerCase().includes(q));
}

export function apply(ctx, config) {
  if (typeof config.path !== "string" || config.path.length === 0) throw new Error("memory-md: `path` must not be empty");
  if (!Number.isInteger(config.maxInjectChars) || config.maxInjectChars < 1) throw new Error("memory-md: invalid maxInjectChars");
  if (!Number.isInteger(config.searchLimit) || config.searchLimit < 1) throw new Error("memory-md: invalid searchLimit");

  const renderList = (items) =>
    items.length === 0 ? "（没有匹配的记忆）" : items.map((e) => `- ${e.text}`).join("\n");

  ctx.systemPrompt.section({
    name: "memory-md:recall",
    order: config.order,
    text: () => {
      const lines = readLines(config.path);
      const list = entries(lines);
      if (list.length === 0) return "";
      let body = list.map((e) => `- ${e.text}`).join("\n");
      let note = "";
      if (body.length > config.maxInjectChars) {
        body = body.slice(0, config.maxInjectChars);
        note = `\n（记忆较多已截断，完整内容用 memory_search 查，或直接读 ${config.path}）`;
      }
      return `你在长期记忆里存过这些事实（用 memory_search 可查全部）：\n${body}${note}`;
    },
  });

  ctx.tools.register(
    defineTool({
      name: "memory_add",
      description: ADD_DESC,
      parameters: {
        text: { type: "string", required: true, description: "要记住的那一条事实，写成一句自包含的话（脱离对话也能看懂）。" },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { added: { type: "boolean", required: true }, text: { type: "string", required: true }, duplicate: { type: "boolean", required: true } },
        },
        render: (_a, v) => [{ type: "text", text: v.duplicate ? `这条已经在记忆里了：${v.text}` : v.added ? `已记住：${v.text}` : `没写进去：${v.text}` }],
      },
      async execute(args) {
        const text = normalize(args.text);
        if (text.length === 0) throw new Error("memory_add: `text` must not be blank");
        const lines = readLines(config.path);
        const dup = entries(lines).find((e) => e.text.toLowerCase() === text.toLowerCase());
        if (dup !== undefined) return { added: false, duplicate: true, text: dup.text };
        while (lines.length > 0 && normalize(lines[lines.length - 1]) === "") lines.pop();
        if (entries(lines).length === 0 && lines.length === 0) lines.push(HEADER.trimEnd(), "", SECTION_HINT.trimEnd(), "");
        lines.push(`- ${text}`);
        lines.push("");
        writeLines(config.path, lines);
        return { added: true, duplicate: false, text };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "memory_replace",
      description: REPLACE_DESC,
      parameters: {
        old_text: { type: "string", required: true, description: "用来定位那条记忆的片段（大小写不敏感，需唯一匹配）。" },
        new_text: { type: "string", required: true, description: "替换后的完整新内容。" },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { replaced: { type: "boolean", required: true }, text: { type: "string", required: true }, matches: { type: "integer", required: true } },
        },
        render: (_a, v) =>
          v.replaced
            ? [{ type: "text", text: `已更新为：${v.text}` }]
            : [{ type: "text", text: v.matches > 1 ? `匹配到 ${v.matches} 条，写具体点再试。` : "没找到匹配的记忆。" }],
      },
      async execute(args) {
        const next = normalize(args.new_text);
        if (next.length === 0) throw new Error("memory_replace: `new_text` must not be blank");
        const lines = readLines(config.path);
        const hits = matchEntries(lines, args.old_text);
        if (hits.length !== 1) return { replaced: false, text: next, matches: hits.length };
        lines[hits[0].index] = `- ${next}`;
        writeLines(config.path, lines);
        return { replaced: true, text: next, matches: 1 };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "memory_remove",
      description: REMOVE_DESC,
      parameters: {
        old_text: { type: "string", required: true, description: "用来定位那条记忆的片段（大小写不敏感，需唯一匹配）。" },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { removed: { type: "boolean", required: true }, matches: { type: "integer", required: true }, text: { type: "string", required: true } },
        },
        render: (_a, v) =>
          v.removed ? [{ type: "text", text: `已忘掉：${v.text}` }] : [{ type: "text", text: v.matches > 1 ? `匹配到 ${v.matches} 条，写具体点再试。` : "没找到匹配的记忆。" }],
      },
      async execute(args) {
        const lines = readLines(config.path);
        const hits = matchEntries(lines, args.old_text);
        if (hits.length !== 1) return { removed: false, matches: hits.length, text: "" };
        const [gone] = lines.splice(hits[0].index, 1);
        writeLines(config.path, lines);
        return { removed: true, matches: 1, text: normalize(gone.replace(/^\s*[-*]\s+/, "")) };
      },
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "memory_search",
      description: SEARCH_DESC,
      parameters: {
        query: { type: "string", required: true, description: "要查找的词或短语（子串匹配，中英文都行）。" },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            matches: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: { text: { type: "string", required: true } } } },
            total: { type: "integer", required: true },
          },
        },
        render: (args, v) => [{ type: "text", text: `搜「${args.query}」命中 ${v.total} 条：\n${renderList(v.matches)}` }],
      },
      async execute(args) {
        const hits = matchEntries(readLines(config.path), args.query).slice(0, config.searchLimit);
        return { matches: hits.map((e) => ({ text: e.text })), total: hits.length };
      },
    }),
  );
}
