# Implementation Plan: 美化角色状态显示

## Checklist

1. 调整 `StatusDetailModal.vue`
   - 参考 `TraitDetailModal.vue` / `ItemDetailModal.vue` 的遮罩、关闭、Escape 行为。
   - 展示 status title、polarity label、description fallback。
   - 移除 id metadata / 档案标记 / 索引字段展示。
   - 保留 polarity tone class 与暗色档案卡样式。

2. 修改 `StatusChips.vue`
   - import `ref`、`StatusDetailModal`。
   - 维护 `selectedStatus`。
   - 将 chip 改为按钮式符签，点击打开弹窗。
   - 保留 `PinButton` 和 stop 行为。
   - 重写 chip 样式。

3. 修改 `StatusBar.vue`
   - 移除 `StatusBarStatus` import。
   - 展开态不再挂载 `<StatusBarStatus />`。
   - 删除仅供该组件使用的 `characterStatuses` 派生数据。

4. 恢复 `StatusBarStatus.vue`
   - 因侧边栏状态区整块移除，该组件不需要本任务新增弹窗交互。
   - 将其恢复为原来的纯展示实现，减少无效 diff。

5. 校验
   - 查看根包管理脚本。
   - 运行 play frontend 构建命令。
   - 若失败，定位并修复本次改动相关问题。

## Risk / Rollback Points

- `StatusChips.vue` 里的 `PinButton` 嵌套在按钮中可能存在 HTML 语义风险；如 `PinButton` 本身是 button，则改用外层非 button 触发区域或按钮 sibling 布局，避免 button 嵌套。
- 弹窗 Escape 监听要在 unmount 移除，避免泄漏。
- 移除侧栏状态分区时，要同步移除无用 import/computed，避免构建 warning/error。

## Validation Command

- `npm run build --workspace play-frontend-dev`
