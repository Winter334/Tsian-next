# contracts

`@tsian/contracts` 是跨包共享的 TypeScript 类型契约包。

当前公开边界包括：

- runtime snapshot、conversation message、generic state record、platform action、deep query。
- play frontend bridge。
- AI debug 和 checkpoint summary。
- play frontend manifest。
- generic memory schema 类型。

契约包保持 type-only，不放运行时验证、存储、Vue 状态或模型调用实现。
