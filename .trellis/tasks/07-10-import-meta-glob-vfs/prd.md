# import meta glob VFS 子集

## Goal

为源码型 Game Card 前端定义并实现一个可诊断的 `import.meta.glob` Vite 兼容子集，通过枚举内存 VFS key 生成静态或懒加载 imports，而不依赖 Node 文件系统 glob 插件。

## Requirements

- 依赖 `07-10-vue-vfs-css-modules` 的 canonical VFS resolution。
- 先固定支持子集：字符串 literal pattern、相对 pattern、`@/` source-root pattern、默认 lazy 与 `{ eager: true }`。
- 使用浏览器安全的 source parser/transform 与 glob matcher，不使用 `fast-glob`/Node `fs`。
- 输出顺序确定，路径键和 Vite 常见行为一致；dynamic import 继续走 esbuild splitting。
- 对动态 pattern、越界 pattern、未支持 options 给出明确构建错误。
- 是否支持 negative patterns、`import`、`query` 等扩展项在该子任务设计阶段单独决定，不隐式承诺完整 Vite 语义。

## Acceptance Criteria

- [ ] lazy glob 从 VFS 匹配文件并生成可执行动态 import map。
- [ ] eager glob 生成静态 imports 并返回确定性映射。
- [ ] 相对与 `@/` pattern 在嵌套 importer 中正确解析。
- [ ] 不支持的 pattern/options 清晰失败。
- [ ] `npm run build:web` 和浏览器内真实 glob fixture 通过。
- [ ] 真实 `play-frontend-dev` 源码包无回归。

## Out of Scope

- 完整复刻所有 Vite `import.meta.glob` options。
- 扫描 IndexedDB 之外的磁盘/npm package 文件。
- 任意第三方 glob 宏。
