# 水印保护功能优化设计规格

> 日期：2026-08-30
> 状态：已确认（用户批准设计后写入）
> 涉及域：watermark（水印保护）

## 1. 目标

对现有水印保护功能做三方面升级：**原件水印预览**、**配置表单分组与控件改造**、**应用范围扩展（全部/奇数/偶数页）**。不改动水印绘制算法本身（`computeWatermarkPlacements` 的平铺/旋转逻辑保持原样）。

## 2. 现状（基线）

- `src/shared/watermark.ts`：`WatermarkConfig`（`text/fontFamily/fontSize/opacity/rotation/layout/position[9向]/applyToAllPages`）+ `computeWatermarkPlacements` 纯算法（canvas/PDF/视频共用单一真相源）。
- `src/main/services/watermark.service.ts`：`applyPdf`（pdf-lib+fontkit，`applyToAllPages` 控制全部或仅首页）、`getVideoInfo`/`applyVideo`（ffmpeg 覆盖层）、`readBinary`/`writeBinary`/`watermarkOutputPath`。
- `src/main/ipc/watermark.ipc.ts`：IPC 处理器 + `validateConfig`。
- `src/preload/index.ts`：暴露 `window.api.watermark`。
- `src/renderer/src/pages/Watermark/`：`WatermarkPage`（左：配置表单+预览；右：处理队列）、`WatermarkConfigForm`（字号/不透明度/旋转角度挤一行、布局胶囊按钮、9 宫格文本位置、全部页面复选框）、`WatermarkPreview`（灰色底画布 360×200，只画水印无原件）。
- `scripts/verify-watermark.ts`：Node 直跑的布局算法验证脚本（`node scripts/verify-watermark.ts`），当前 2 处断言使用 `position` 字段。
- 无持久化：水印配置为 zustand 内存态，改模型安全。
- 无测试框架；验证手段为 verify 脚本 + `npm run typecheck` + 手动 E2E。

## 3. 需求

1. **原件水印预览**：预览区必须上传原件（图片 / PDF / 视频）；上传后显示「原件添加水印」效果，配置变更实时刷新。
2. **控件布局**：字号、不透明度、旋转角度各独占一行；布局由胶囊按钮改为下拉选择框。
3. **文本位置拆分**：改为「垂直对齐」「水平对齐」两个下拉模块（3 选项各一；已确认：水平=左/中/右，垂直=顶/中/底）。
4. **分组**：配置表单按 4 组组织 —— 水印文本（文本/字体/字号）、外观（旋转角度/不透明度/布局）、文本位置（垂直对齐/水平对齐）、应用范围（下拉：全部页面/奇数页/偶数页）。

## 4. 设计

### 4.1 数据模型（`src/shared/watermark.ts`）

```ts
export type WatermarkHAlign = 'left' | 'center' | 'right'
export type WatermarkVAlign = 'top' | 'middle' | 'bottom'
export type WatermarkPageScope = 'all' | 'odd' | 'even'

export interface WatermarkConfig {
  text: string
  fontFamily: string
  fontSize: number
  opacity: number
  rotation: number
  layout: WatermarkLayout          // 'single' | 'multi2' | 'multi3' | 'multi6' | 'multi8'（不变）
  hAlign: WatermarkHAlign
  vAlign: WatermarkVAlign
  pageScope: WatermarkPageScope
}

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  text: '机密',
  fontFamily: 'Microsoft YaHei',
  fontSize: 40,
  opacity: 0.3,
  rotation: -45,
  layout: 'multi3',
  hAlign: 'center',
  vAlign: 'middle',
  pageScope: 'all'
}
```

- 移除 `WatermarkPosition` 类型与 `position` / `applyToAllPages` 字段。
- `positionAnchor(w, h, config)`：由 `hAlign`×`vAlign` 派生锚点（3×3=9，与原 9 宫格一一对应；边距 `m = Math.min(w,h)*0.06` 保留）：
  - x：`left → m`，`right → w - m`，`center → w/2`
  - y：`top → m`，`bottom → h - m`，`middle → h/2`
- `computeWatermarkPlacements(width, height, config, textWidth = 0)`：签名与平铺/旋转逻辑不变；`single` 分支改用 `positionAnchor(width, height, config)`。
- 文件头注释「纯 TS、无运行时导入、Node 验证脚本可直接执行」保持不变。

### 4.2 类型契约（`src/shared/types.ts`）

- 重新导出新增类型：`WatermarkHAlign / WatermarkVAlign / WatermarkPageScope`；移除 `WatermarkPosition`。
- `WatermarkApi` 新增两个方法：
  ```ts
  pickOriginal(): Promise<IpcResult<string | null>>            // 合并过滤器单选原件路径
  extractVideoFrame(payload: { filePath: string; timeMs: number }): Promise<IpcResult<Uint8Array>>  // ffmpeg 抽帧 PNG 字节
  ```

### 4.3 主进程服务（`src/main/services/watermark.service.ts`）

- `applyPdf`：`applyToAllPages` 逻辑改为按 `config.pageScope` 选页：
  - `all`：全部页；`odd`：第 1,3,5…页（index 0,2,4…）；`even`：第 2,4,6…页（index 1,3,5…）。
  - 空页结果（如单页 PDF + even）返回原样副本即可（无页可加水印），不报错。
- 新增 `extractVideoFrame(filePath, timeMs): Promise<Buffer>`：
  - 用 `ffmpeg -ss <timeMs/1000> -i <file> -frames:v 1 -f image2 -y <临时 png>` 抽帧；
  - 读回 PNG Buffer，删除临时文件（`rm(force:true)`），失败抛 `AppError('PROCESS_FAILED', …)`。
  - 复用现有 `resolveFfmpeg()` 与 ffmpeg 错误尾部捕获模式（参考 `applyVideo` 的 stderr 处理）。
- `applyVideo` / `getVideoInfo` / `readBinary` / `writeBinary` / `watermarkOutputPath` 不变。

### 4.4 IPC（`src/main/ipc/watermark.ipc.ts`）

- `validateConfig`：移除 `applyToAllPages`/`position` 校验；新增 `hAlign ∈ {left,center,right}`、`vAlign ∈ {top,middle,bottom}`、`pageScope ∈ {all,odd,even}` 校验（非法值抛 `VALIDATION_ERROR`）。
- 新增处理器：
  - `watermark:pickOriginal`：`dialog.showOpenDialog`，合并过滤器（图片 png/jpg/jpeg/webp/bmp/gif + PDF + 视频 mp4/mkv/mov/avi/wmv/flv/webm/ts/m4v），单选；取消返回 `null`。
  - `watermark:extractVideoFrame`：校验 `filePath`（非空字符串）与 `timeMs`（有限非负数），调用 service，返回 `Buffer`（IPC 结构化克隆 → 渲染层 `Uint8Array`）。

### 4.5 Preload（`src/preload/index.ts`）

`window.api.watermark` 新增：
```ts
pickOriginal: () => invoke<string | null>('watermark:pickOriginal'),
extractVideoFrame: (payload: { filePath: string; timeMs: number }) =>
  invoke<Uint8Array>('watermark:extractVideoFrame', payload)
```

### 4.6 渲染层工具（`src/renderer/src/utils/watermarkRenderer.ts`）

- `drawWatermarkOn(ctx, width, height, config)`：不变（内部经 `computeWatermarkPlacements`，config 形态变化对调用方透明）。
- `watermarkImageBytes` / `renderWatermarkPng` / BMP/GIF 编码：不变。

### 4.7 配置表单（`src/renderer/src/pages/Watermark/WatermarkConfigForm.tsx` + `.module.css`）

按 4 组渲染（组标题 + 组内字段），字号/不透明度/旋转角度各独占一行：

| 分组 | 字段 | 控件 |
|---|---|---|
| 水印文本 | 水印文本 | 文本框（maxLength 200） |
| | 字体 | 下拉：Microsoft YaHei / SimHei / SimSun / KaiTi / Arial / Georgia |
| | 字号 | 数字框 1–500 |
| 外观 | 旋转角度 | 数字框 -90–90 |
| | 不透明度 | 滑块 0.05–1 step 0.05 + 数值显示 |
| | 布局 | 下拉：单行 / 一页两行 / 一页三行 / 一页六行 / 一页八行 |
| 文本位置 | 垂直对齐 | 下拉：顶部对齐 / 居中对齐 / 底部对齐 |
| | 水平对齐 | 下拉：左对齐 / 居中对齐 / 右对齐 |
| 应用范围 | 应用页面 | 下拉：全部页面 / 奇数页 / 偶数页 |

- **文本位置组**：`layout !== 'single'` 时整体禁用并显示「（仅单行生效）」提示（沿用现有单行约束：多行布局由算法平铺，position 不生效）。
- **应用范围组**：标注「（仅 PDF 生效）」；图片/视频处理时该字段被忽略（天然整片）。
- 移除 9 宫格、布局胶囊按钮、全部页面复选框。
- 选项常量映射：`ALIGN_H: left→左对齐 / center→居中对齐 / right→右对齐`；`ALIGN_V: top→顶部对齐 / middle→居中对齐 / bottom→底部对齐`；`SCOPE: all→全部页面 / odd→奇数页 / even→偶数页`。

### 4.8 预览区（`src/renderer/src/pages/Watermark/WatermarkPreview.tsx` + `.module.css`）

- 本地状态：`original: { path: string; name: string; type: WatermarkFileType } | null`。
- **上传**：按钮「上传原件（图片 / PDF / 视频）」→ `window.api.watermark.pickOriginal()`；按扩展名推断类型（复用 `extOf` 思路）。文件后缀不在已知集合则提示无效格式。
- **渲染**（`useEffect` 依赖 `[original, config]`，防抖可选）：
  - 图片：`readBinary(path)` → `createImageBitmap(blob)` → canvas（等比适配预览框，maxW 约 340 / maxH 约 260）→ `drawWatermarkOn`。
  - PDF：`readBinary(path)` → `pdfjsLib.getDocument({ data })` → 渲染第 1 页（`viewport` 按预览框等比缩放）→ `drawWatermarkOn`。标注「预览为首页」。
  - 视频：`extractVideoFrame({ filePath, timeMs })` → `createImageBitmap` PNG → canvas → `drawWatermarkOn`。`timeMs` 取 `Math.min(5000, Math.max(1000, durationMs * 0.05))`（`getVideoInfo` 取时长；未知时长回退 1000ms），避开黑场首帧。标注「预览为前几秒帧」。
- **UI**：未上传 → 提示「请上传原件以预览水印效果」+ 上传按钮；已上传 → 文件名 +「更换原件」「清除」+ canvas（水印叠加）+ 预览范围标注。
- 预览 canvas 每次渲染先 `clearRect` 再画底（不透明类型先铺白/直接 drawImage 全覆盖即可，无需灰底）。
- 异步错误（读取失败/PDF 损坏/抽帧失败）：显示错误文案，不崩溃。

### 4.9 状态管理（`src/renderer/src/stores/watermarkStore.ts`）

- `WatermarkConfig` 类型引用自动跟随模型变化；无持久化，无迁移。
- `processItem`：PDF 路径已把整份 `config` 传给 `applyPdf`（`pageScope` 在 main 生效）；image/video 路径不变。

### 4.10 依赖（`package.json`）

- 新增 `pdfjs-dist`（渲染层真渲染 PDF）。worker 配置：`GlobalWorkerOptions.workerSrc` 使用 `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`（electron-vite 资产引用）。
- 不新增其它依赖。

### 4.11 验证（`scripts/verify-watermark.ts`）

- 两处 `position` 断言改为 hAlign/vAlign：
  - `{ ...base, layout: 'single', position: 'center' }` → `{ ...base, layout: 'single', hAlign: 'center', vAlign: 'middle' }`（断言不变：single 居中 → (500,300)）
  - `{ ...base, layout: 'single', position: 'top-left' }` → `{ ...base, layout: 'single', hAlign: 'left', vAlign: 'top' }`（断言不变：左上角）
- 其余断言（multi2/3/6/8、带符号 tan 方向）不变。

## 5. 验证口径

1. `node scripts/verify-watermark.ts` → `ALL_WATERMARK_LAYOUT_TESTS_PASSED`。
2. `npm run typecheck`（node + web 两套）通过。
3. 手动 E2E：
   - 三种类型原件均可上传预览，配置变更实时刷新水印；
   - 表单 4 组、字号/不透明度/旋转角度独占一行、布局与位置为下拉；
   - 文本位置在多行布局下禁用；
   - 应用范围：多页 PDF 分别选全部/奇数/偶数，输出 PDF 页码符合预期；图片/视频整片生效；
   - 预览上传后可更换/清除原件。

## 6. 范围与不变量

- 不改 `computeWatermarkPlacements` 的平铺/旋转算法（仅 single 分支锚点读取新字段）。
- 不改视频覆盖层、图片合成管线、BMP/GIF 编码。
- 不改配置持久化（本无持久化）。
- 预览只渲首页/单帧，不做页码选择器（已确认）。
- 应用范围 odd/even 仅作用于 PDF 多页；图片/视频忽略。
