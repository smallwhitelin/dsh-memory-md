// 测试启动钩子：注册一个解析钩子，让宿主包在缺失时回落到桩。
// 用法：node --import ./test/loader-hook.mjs test/run.mjs
import { register } from "node:module";

register("./resolve-host-stub.mjs", import.meta.url);
