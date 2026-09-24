// 确定性单测：不需要模型、不联网。npm test / prepack 都会跑。
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mod = await import("../lib/index.js");
const dir = mkdtempSync(join(tmpdir(), "dsh-memory-md-"));
const file = join(dir, "MEMORY.md");

const tools = {};
const sections = [];
mod.apply(
  { tools: { register: (t) => (tools[t.name] = t) },
    systemPrompt: { section: (s) => sections.push(s) },
    effect: () => {} },
  new mod.Config({ path: file }),
);

assert.deepEqual(Object.keys(tools).sort(), ["memory_add", "memory_remove", "memory_replace", "memory_search"]);
assert.equal(sections.length, 1, "应注册一个提示词段落");
assert.equal(sections[0].text(), "", "空记忆不注入任何内容");

const add = (text) => tools.memory_add.execute({ text });
const search = (query) => tools.memory_search.execute({ query });

assert.equal((await add("  用户习惯用中文回复  ")).text, "用户习惯用中文回复", "应去掉首尾空白");
assert.equal((await add("用户习惯用中文回复")).duplicate, true, "重复内容应被识别");
assert.equal((await add("用户最喜欢的颜色是墨绿色")).added, true);

assert.equal((await search("颜色")).total, 1, "中文两字子串应能搜到");
assert.equal((await search("墨绿")).total, 1, "中文部分词应能搜到");
assert.equal((await search("英文")).total, 0);

const rep = await tools.memory_replace.execute({ old_text: "颜色", new_text: "用户最喜欢的颜色是深蓝色" });
assert.equal(rep.replaced, true);
assert.equal((await search("深蓝色")).total, 1);
assert.equal((await search("墨绿色")).total, 0, "改完旧值不该再命中");

assert.equal((await tools.memory_replace.execute({ old_text: "用户", new_text: "x" })).matches, 2, "多命中应拒绝");
assert.equal((await tools.memory_remove.execute({ old_text: "不存在" })).removed, false);
assert.equal((await tools.memory_remove.execute({ old_text: "中文回复" })).removed, true);

const body = readFileSync(file, "utf8");
assert.ok(body.includes("- 用户最喜欢的颜色是深蓝色"), "文件应保留更新后的条目");
assert.ok(!body.includes("中文回复"), "删除后文件里不该还有");
assert.ok(sections[0].text().includes("深蓝色"), "注入内容应反映最新状态");

rmSync(dir, { recursive: true, force: true });
console.log("dsh-memory-md: 全部断言通过 ✓");
