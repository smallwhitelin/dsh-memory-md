// 解析钩子：插件 import 的「宿主包」由 dsh 本体提供、不随插件分发，
// 因此测试环境可能没有它们。这里做一次判断：
//   - 装得到真包（本地/有 dsh 的机器）→ 原样放行，测的是真 API；
//   - 装不到（CI / 干净环境）        → 回落到 test/ 下一份最小桩。
// 这样 `npm test` 在两种环境都能跑，且本地永远优先用真包。
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url)); // <pkg>/test
const pkgRoot = dirname(testDir);                        // <pkg>

/** 宿主包 → 对应桩文件 */
const HOST_PACKAGES = {
  "@deepseek-ai/dsh-tools": "stub-dsh-tools.mjs",
};

export async function resolve(specifier, context, nextResolve) {
  const stub = HOST_PACKAGES[specifier];
  if (stub !== undefined) {
    const real = join(pkgRoot, "node_modules", ...specifier.split("/"));
    if (!existsSync(real)) {
      return {
        url: pathToFileURL(join(testDir, stub)).href,
        shortCircuit: true,
        format: "module",
      };
    }
  }
  return nextResolve(specifier, context);
}
