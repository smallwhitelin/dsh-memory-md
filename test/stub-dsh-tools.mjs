// 测试用的最小桩：只实现插件真正用到的那部分 API。
// CI 里没有宿主包（dsh-tools 由 dsh 本体提供，不随插件分发）时由 loader 自动启用。
export const defineTool = (definition) => definition;
