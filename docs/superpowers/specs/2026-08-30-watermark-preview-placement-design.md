# 水印效果预览移入选择区 设计规格

> 日期：2026-08-30
> 状态：已确认（用户批准设计后写入）
> 涉及域：watermark（水印保护）· renderer UI

## 1. 目标

将「水印效果预览」模块从配置表单下方（左列）移入文件选择区（右列），置于「选择图片/PDF/视频」按钮之下、文件列表之前，形成 **选择 → 预览 → 处理** 的完整流程。预览数据源改为**从已选文件**（已确认：队列文件自动预览，行内可切换；队列为空时保留「上传原件」兜底）。

## 2. 现状（基线）

- `WatermarkPage.tsx`：`.grid` 分左右列；左列 = `WatermarkConfigForm` + `WatermarkPreview`；右列 = `WatermarkQueue`。
- `WatermarkQueue.tsx`：`.actions`（选择图片/PDF/视频）→ `error` → 文件列表 table → `.footer`（共N个/完成/失败 + 开始处理/取消视频/清空）。
- `WatermarkPreview.tsx`：本地 `original` 状态（`pickOriginal` 上传原件）+ `renderOriginalPreview` 渲染 canvas（图片/PDF/视频三分支），配置变更实时刷新；含「更换原件」「清除」。
- `watermarkStore.ts`：`config/queue/processing/videoProgress/error` + `setConfig/addFiles/removeItem/clearQueue/run/cancelVideo`；`WatermarkQueueItem = { path, name, type, status, outputPath?, error? }`。
- `src/renderer/src/utils/watermarkPreview.ts`：`inferPreviewType` + `renderOriginalPreview(canvas, filePath, type, config, api, isCancelled?)`（修复轮已含水印按比例缩放、isCancelled 竞态守卫）。

## 3. 需求

1. 预览模块移入右列：位于选择按钮之下、文件列表之前（在选择模块与文件列表之间）。
2. 预览来源 = 已选文件：队列非空时自动预览队列中第一个文件；文件行提供「预览」按钮切换目标；当前预览行高亮并标注「预览中」。
3. 队列为空时：预览区显示「上传原件（图片 / PDF / 视频）」兜底（保留现有能力，上传后预览该原件）。
4. 左列移除预览，仅剩配置表单。
5. 配置变更实时刷新预览；预览能力（图片/PDF 首页/视频抽帧 + 水印缩放）不变。

## 4. 设计

### 4.1 状态（`src/renderer/src/stores/watermarkStore.ts`）

```ts
interface WatermarkState {
  // ...现有字段与动作
  previewPath: string | null   // 显式选中的预览目标（队列项 path）；null = 自动取队列首个
  setPreviewPath: (path: string | null) => void
}
```

- `previewPath: string | null`，初始 `null`（自动模式）。
- `setPreviewPath(path)`：`set({ previewPath: path })`。
- `clearQueue`：同时 `previewPath: null`（队列清空 → 回到上传兜底态）。
- `addFiles` / `removeItem` 不改 `previewPath`（由预览组件推导兜底，见 4.3）。

### 4.2 布局（`WatermarkPage.tsx` / `WatermarkQueue.tsx`）

- `WatermarkPage.tsx`：左列删除 `<WatermarkPreview />`，仅 `<WatermarkConfigForm />`。
- `WatermarkQueue.tsx`：在 `.actions` 之后、文件列表 table 之前插入 `<WatermarkPreview />`；`error` 移至 table 之前、预览之后。顺序：`.actions` → `<WatermarkPreview/>` → `error` → `table` → `.footer`。

### 4.3 预览组件双模式（`WatermarkPreview.tsx`）

- 新增读取：`queue`、`previewPath`（store）。
- 有效目标推导（队列模式与行高亮共用）：
  ```ts
  const effectiveTarget = queue.find((q) => q.path === previewPath) ?? queue[0] ?? null
  ```
- **单一解析目标**（`target`）：队列非空 → `effectiveTarget`；否则 → 本地 `original`（上传原件，可为 null）：
  ```ts
  const target: { path: string; type: WatermarkFileType } | null =
    effectiveTarget ?? original
  ```
- **队列模式**（`effectiveTarget` 非空）：以 `effectiveTarget` 调 `renderOriginalPreview`（canvas + `isCancelled` 守卫沿用）；顶部显示文件名；标注沿用（PDF「预览为首页」/ 视频「预览为前几秒帧」）；无「上传/更换/清除」按钮。
- **上传模式**（`effectiveTarget` 为空、`original` 非空）：渲染已上传原件；顶部显示「更换原件」「清除」。
- **空态**（`target` 为 null）：显示「上传原件（图片/PDF/视频）」按钮。
- `useEffect` 依赖 `[target?.path, target?.type, config, api]`；其余（`cancelled` 守卫、`setNote/setError` 同步清理）不变。
- 渲染优先级：队列非空 → 队列预览（忽略已上传原件）；队列清空 → 恢复已上传原件（若有）或空态提示。

### 4.4 队列行预览切换（`WatermarkQueue.tsx` + `.module.css`）

- 每行末单元格（原仅 ✕）：追加「预览」按钮；当该行 == 有效预览目标时，按钮替换为「预览中」标签（disabled 样式），行加高亮 class（如 `styles.active`）。
- 点击「预览」→ `setPreviewPath(item.path)`。
- 有效目标与高亮判定与 4.3 相同推导：
  ```ts
  const activePath = queue.find((q) => q.path === previewPath)?.path ?? queue[0]?.path ?? null
  ```

### 4.5 样式（`WatermarkQueue.module.css`）

- `.previewArea`：预览容器（在 actions 与 table 之间，宽度与列一致，留边距）。
- `.active`：当前预览行高亮（浅色背景）。
- `.previewBtn`：行内「预览」按钮样式；`[data-active]` 或 `.active` 时「预览中」灰态。
- `WatermarkPreview.module.css` 基本沿用（`.preview/.title/.canvas/.empty/.meta/.name/.note/.error`），如需适配列宽微调容器宽度。

### 4.6 不变量

- 不改 `src/shared/watermark.ts`（算法/模型）、`src/main/**`、`src/preload/**`、`watermarkRenderer.ts`、`watermarkPreview.ts` 工具。
- 预览渲染能力（图片/PDF首页/视频抽帧 + 水印缩放 + isCancelled）不变，仅改调用方与 UI 位置。
- 后端/IPC 零改动；处理流程（`run`/`processItem`）零改动。

## 5. 验证口径

1. `node scripts/verify-watermark.ts` → `ALL_WATERMARK_LAYOUT_TESTS_PASSED`（算法未动，回归）。
2. `npm run typecheck`（node + web）零错误。
3. 手动 E2E：
   - 添加图片/PDF/视频 → 预览区自动显示队列首个文件 + 实时水印；
   - 点击某行「预览」→ 切换预览目标，该行高亮「预览中」；
   - 移除被预览行 → 自动回退预览队列其余首个；清空队列 → 显示「上传原件」兜底，上传后预览；
   - 配置变更（文本/字号/透明度/布局/对齐/应用范围）实时刷新预览；
   - 多页 PDF 预览首页标注「预览为首页」；视频标注「预览为前几秒帧」；
   - 处理流程（开始处理/取消视频/清空）不受预览影响。

## 6. 范围与不变量

- 本次仅动 5 个渲染层文件：`watermarkStore.ts`、`WatermarkPage.tsx`、`WatermarkQueue.tsx`、`WatermarkPreview.tsx`、`WatermarkQueue.module.css`（如预览容器宽度需要，可顺带微调 `WatermarkPreview.module.css`）。
- 不改后端、共享层、水印算法、处理管线。
- 预览数据源按已确认方案：队列优先、上传兜底。
