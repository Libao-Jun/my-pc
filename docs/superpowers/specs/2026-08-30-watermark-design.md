# 阶段 6 设计：保护功能 —— 防伪水印（图片 / PDF / 视频）

> 对应 `docs/project-plan.md` 需求 6：保护功能。
> 6.1 给图片、PDF 等文档添加防伪水印；6.2 给视频添加防伪水印。

## 1. 目标

- 新增「水印保护」功能域，对图片、PDF、视频添加**可定制的防伪文字水印**。
- 可定制项：水印文本、字体、字号、不透明度、旋转角度、布局（单行 / 一页两行 / 一页三行 / 一页六行 / 一页八行）、文本位置（单行模式）、是否应用于全部页面（PDF）。
- 图片 / PDF 支持多选批量；视频单文件逐个处理。
- 输出为**另存新文件**（`原名.水印.ext`），不覆盖原件。
- 验收：三类文件各产出正确的含水印新文件；`npm run typecheck` 通过。

## 2. 已确认的设计决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 依赖策略 | **放开新依赖**（用户已确认）：图片零依赖 canvas；PDF 引入 `pdf-lib`（纯 JS）；视频引入 `ffmpeg-static`（静态二进制，打包时 `asarUnpack`） |
| 2 | 图片处理位置 | **渲染层 `<canvas>`**：主进程读字节 → IPC 传渲染层 → `createImageBitmap` 解码 → canvas 绘制（Chromium 原生文本/字体渲染，天然支持中文）→ `toBlob` 导出 → 主进程写文件 |
| 3 | 布局算法单一真相源 | 纯函数 `computeWatermarkPlacements(w, h, config)` 放 `src/shared/watermark.ts`（纯 TS，node+web 共用），canvas 渲染、pdf-lib 绘制、视频水印 PNG 三方共用 |
| 4 | 视频水印叠加方式 | **透明 PNG 覆盖层 + ffmpeg overlay**，而非 `drawtext` 滤镜——布局/字体/旋转/透明度/多行平铺全部复用图片管线 canvas 能力，绕开 drawtext 中文转义与字体路径坑 |
| 5 | 输出方式 | 一律**另存新文件** `原名.水印.ext`；目标路径已存在自动加序号避免覆盖 |
| 6 | 批处理范围 | 图片 / PDF 批量（同一配置应用到所有选中文件）；视频单文件 |
| 7 | PDF「应用于全部页面」 | `applyToAllPages=true` → 所有页；`false` → 仅第一页（默认 true） |
| 8 | 水印颜色 | 固定默认中性灰 `#808080`（防伪水印惯例；需求未要求自定义颜色，YAGNI 不实现） |
| 9 | 历史 / 批量持久化 | **不做**（YAGNI）：无水印历史表，无批量任务持久化；只保留会话内队列 |
| 10 | 图片输出格式 | **必须保持原格式**（用户确认）：png / jpg / jpeg / webp → canvas `toBlob` 原生编码（零依赖），**输出扩展名与原文件逐字一致**（`.jpg`→`.jpg`、`.jpeg`→`.jpeg`，同属 JPEG 编码、各自保留扩展名，不能变为其他格式）；bmp → 手写未压缩 BMP 编码器（零依赖，~60 行）；gif → 轻量纯 JS 编码器 `gifenc`（输出静态 GIF，格式保持 gif）；svg / ico / heic / tiff / psd 不入图片选择器（canvas 无法可靠解码/编码，无法保证原格式输出） |
| 11 | 批量进度 | **渲染层本地跟踪**（图片在渲染层处理、PDF 即时完成，均无需主进程批量进度事件）；仅视频有 `watermark:videoProgress` 主进程进度 |

## 3. 架构

### 3.1 文件结构

```
src/shared/watermark.ts                           新增：WatermarkConfig / WatermarkPosition / 布局纯函数
src/shared/types.ts                               修改：+Watermark 域契约（WatermarkApi / WindowApi.watermark）
src/main/services/watermark.service.ts            新增：PDF（pdf-lib）/ 视频（ffmpeg）编排、CJK 字体候选、进度解析
src/main/ipc/watermark.ipc.ts                     新增：watermark: 系列通道注册
src/main/ipc/index.ts                             修改：注册 watermark 域
src/preload/index.ts                              修改：暴露 window.api.watermark
src/renderer/src/stores/watermarkStore.ts         新增：zustand store（config / queue / progress / error）
src/renderer/src/pages/Watermark/WatermarkPage.tsx          新增：容器 + 配置区 + 文件区
src/renderer/src/pages/Watermark/WatermarkConfigForm.tsx    新增：配置表单 + 九宫格位置 + 布局选择
src/renderer/src/pages/Watermark/WatermarkPreview.tsx       新增：水印效果预览（空白 canvas，共用布局算法）
src/renderer/src/pages/Watermark/WatermarkQueue.tsx         新增：文件队列表格 + 进度 + 取消
src/renderer/src/pages/Watermark/*.module.css               新增
src/renderer/src/App.tsx                        修改：加「水印」导航分支
src/renderer/src/components/layout/SideNav.tsx  修改：PageId + NAV_ITEMS 加「水印」
package.json                                    修改：dependencies +pdf-lib、+ffmpeg-static
electron-builder.yml                            修改：asarUnpack node_modules/ffmpeg-static/**
docs/API_SPEC.md / docs/modules/watermark.md     修改/新增：接口与模块文档
```

### 3.2 数据模型（`src/shared/watermark.ts`）

```ts
export type WatermarkPosition =
  | 'center' | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export type WatermarkLayout = 'single' | 'multi2' | 'multi3' | 'multi6' | 'multi8'

export interface WatermarkConfig {
  text: string
  fontFamily: string      // 渲染层 canvas 直接识别系统字体名，如 'Microsoft YaHei' / 'SimHei' / 'Arial'
  fontSize: number        // px
  opacity: number         // 0.05–1
  rotation: number        // 度，默认 -45，范围 -90~90
  layout: WatermarkLayout // 单行 / 一页两行/三行/六行/八行
  position: WatermarkPosition // 仅 layout === 'single' 时生效
  applyToAllPages: boolean    // 仅 PDF 生效
}

// 布局纯函数：返回水印锚点（canvas / pdf-lib / 视频水印 PNG 三方共用）
// - single：按 position 返回 1 个锚点
// - multiN：按对角线平铺计算 N 个网格锚点（tile 高 ≈ 页面高 / N，旋转后首尾相接成 N 条斜线带）
export function computeWatermarkPlacements(
  width: number,
  height: number,
  config: WatermarkConfig
): Array<{ x: number; y: number }>
```

### 3.3 图片管线（渲染层 canvas，零新依赖）

1. `watermark:pickFiles('image')` → 文件列表进队列。
2. 逐文件：`watermark:readBinary(path)` → 主进程读字节返回 `ArrayBuffer`。
3. 渲染层 `createImageBitmap(new Blob([buf]))` 解码（异步，不阻塞 UI）。
4. 建 canvas `w×h`，`ctx.drawImage` 画原图。
5. 按 `computeWatermarkPlacements(w, h, config)` 逐锚点：`save() → translate(x,y) → rotate(θ) → globalAlpha=opacity → fillStyle='#808080' → font='${fontSize}px ${fontFamily}' → textAlign='center' / textBaseline='middle' → fillText → restore()`。
6. 导出**保持原格式**（扩展名 → 编码方式映射；**输出扩展名一律与原文件逐字一致**）：
   - `png` / `jpg` / `jpeg` / `webp` → `canvas.toBlob('image/png' | 'image/jpeg'(0.92) | 'image/webp'(0.92))`，canvas 原生编码，零依赖；`jpg` 与 `jpeg` 同属 JPEG 编码，各自输出 `.jpg` / `.jpeg` 扩展名。
   - `bmp` → 手写**未压缩 BMP 编码器**（BMP 头 + 每行像素，从 canvas 原始像素 `getImageData` 取数，零依赖，~60 行）。
   - `gif` → `gifenc`（轻量纯 JS）编码：取首帧 + 水印绘制结果，输出**静态 GIF**（格式保持 gif；动画帧不逐帧保留）。
7. `watermark:writeFile({ path: 输出路径, data })` → 主进程写 `原名.水印.ext`。
8. 批量队列推进，逐文件状态（待处理/处理中/完成/失败）+ 总进度。
9. 图片选择器（`pickFiles('image')`）仅开放 `png / jpeg / jpg / webp / bmp / gif`——svg / ico / heic / tiff / psd 无法可靠保证原格式输出，明确排除。

### 3.4 PDF 管线（主进程 pdf-lib）

1. `watermark:applyPdf({ filePath, config })`。
2. `PDFDocument.load(await fs.readFile(filePath))`。
3. **嵌入 CJK 字体**：按候选列表探测 Windows 系统字体（`simhei.ttf` → `msyh.ttc` → `simsun.ttc`），`doc.embedFont(bytes)`（pdf-lib 自动子集化，只嵌用到的字形，输出体积可控）；探测失败报 `PROCESS_FAILED` 并给出中文提示（建议安装中文字体）。
   - **口径说明**：PDF 字体嵌入**不严格跟随 UI 选择的 `fontFamily`**（如「微软雅黑」），而是取候选列表中第一个可嵌入的中文字体文件——这样避免 TTC 索引/字体重名等脆弱性。UI 的 `fontFamily` 对图片与视频水印 PNG 完全生效（canvas 直接识别系统字体名）。
4. 遍历页面（`applyToAllPages=false` 时仅第一页）：按 `computeWatermarkPlacements(pageW, pageH, config)` 逐锚点 `page.drawText(text, { x, y, size: fontSize, font, rotate: degrees(rotation), opacity, color: rgb(0.5,0.5,0.5) })`。
5. `fs.writeFileSync(输出路径, await doc.save())`。
6. ⚠️ **实现风险点**（列入验证项）：`msyh.ttc` 为 TTC 集合，pdf-lib/fontkit 对 TTC 的解析需实现时实测；候选列表 + 报错兜底。

### 3.5 视频管线（主进程 ffmpeg）

1. 渲染层 `watermark:getVideoInfo(path)` → 主进程 spawn `ffmpeg -i <input>` 解析视频流（`Stream #0:0 ... Video: ..., 1920x1080`）得分辨率与时长；解析失败报 `PROCESS_FAILED`。
2. 渲染层按视频分辨率在**空白透明 canvas** 上渲染水印 PNG（复用图片管线同一套绘制代码，`toBlob('image/png')`），得 `watermarkPng: ArrayBuffer`。
3. `watermark:applyVideo({ filePath, config, watermarkPng })` → 主进程写临时 `wm.png` 并 spawn ffmpeg：
   ```
   ffmpeg -y -i <input> -i <wm.png>
     -filter_complex "[1:v]format=rgba[wm];[0:v][wm]overlay=0:0[outv]"
     -map "[outv]" -map 0:a? -c:a copy -c:v libx264 -preset medium -crf 18 -movflags +faststart
     <原名.水印.ext>
   ```
   - 视频流重编码（overlay 必需），音频 `-c:a copy` 不重编码保留原音质。
4. 解析 stderr `time=HH:MM:SS.xx` → 按时长换算百分比 → 事件 `watermark:videoProgress`。
5. 结束清理临时 `wm.png`；取消任务 kill 子进程并清理。
6. 依赖验证项：`ffmpeg-static` 的 Windows 构建需含 libx264 + overlay（实现时 `ffmpeg -filters` / 编码器清单实测）。

### 3.6 UI（`pages/Watermark/`）

| 组件 | 用途 |
|------|------|
| `WatermarkPage` | 容器：左配置区 + 右文件区 |
| `WatermarkConfigForm` | 文本 / 字体下拉 / 字号 / 不透明度滑块 / 旋转 / 布局单选（单行 + 一页N行）/ 九宫格位置（仅单行启用）/ PDF「全部页面」复选（仅 PDF 相关显示） |
| `WatermarkPreview` | 空白 canvas 渲染同一 `computeWatermarkPlacements`，所见即所得预览 |
| `WatermarkQueue` | 文件队列表格（文件名/类型/状态/输出路径）+ 总进度条 + 开始/取消 |

- 选择文件按类型过滤（`watermark:pickFiles('image' | 'pdf' | 'video')`）；图片/PDF 追加进批量队列，视频加入作为单任务。
- 水印字体下拉映射到系统字体（微软雅黑 / 宋体 / 黑体 / 楷体 / Arial 等）。

**watermarkStore（zustand）**：state `config: WatermarkConfig`（默认 文本「机密」/ 微软雅黑 / 40px / 0.3 / -45° / multi3 / center / true）/ `queue: WatermarkQueueItem[]`（path/name/type/status/outputPath?/error?）/ `processing: boolean` / `videoProgress: number | null` / `error: string | null`；actions `setConfig` / `addFiles` / `removeItem` / `clearQueue` / `run` / `cancelVideo`。批量串行处理，无 batchProgress（图片渲染层处理、PDF 即时完成，仅视频有 `watermark:videoProgress` 主进程进度）。数据流与 `fileStore` 的扫描进度模式一致（进度事件订阅 + Promise 结果）。

**导航接入**（沿用既有模式）：`SideNav` PageId 增 `'watermark'`、NAV_ITEMS 加 `{ id: 'watermark', label: '水印' }`；`App.tsx` 加对应分支。

## 4. IPC 接口

| 通道 | 方向 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| `watermark:pickFiles` | renderer→main | `type: 'image' \| 'pdf' \| 'video'` | `string[] \| null` | `dialog.showOpenDialog` 多选 + 扩展名过滤 |
| `watermark:readBinary` | renderer→main | `path: string` | `ArrayBuffer` | 图片处理读字节 |
| `watermark:writeFile` | renderer→main | `{ path, data: ArrayBuffer }` | `{ path }` | 图片处理写新文件 |
| `watermark:applyPdf` | renderer→main | `{ filePath, config }` | `{ outputPath }` | pdf-lib 加 PDF 水印 |
| `watermark:getVideoInfo` | renderer→main | `path: string` | `{ width, height, durationMs }` | 视频分辨率 / 时长探测 |
| `watermark:applyVideo` | renderer→main | `{ filePath, config, watermarkPng: ArrayBuffer }` | `{ outputPath }` | 长任务；watermarkPng 为渲染层已绘好的透明水印 PNG；事件 `watermark:videoProgress` `{ percent }` |

preload 增 `watermark` 域；渲染层沿用 `invoke<T>` + `IpcResult`。**无持久化通道**（不建表）。

## 5. 错误处理

- 复用现有 `AppError` + `ErrorCode`；**新增** `PROCESS_FAILED` 错误码（ffmpeg / pdf-lib / CJK 字体探测失败）。
- 校验（IPC 层）：`text` 非空且不超长、`opacity` ∈ [0.05,1]、`rotation` ∈ [-90,90]、`fontSize` > 0 且 ≤ 500、`layout`/`position` 取值合法；非法抛 `VALIDATION_ERROR`。
- 渲染层 store 直接显示中文 `error.message`（主进程抛中文）。
- 输出路径已存在 → 追加序号（`原名.水印(1).ext`）避免覆盖。
- 视频任务取消：kill ffmpeg 子进程并清理临时文件。

## 6. 打包（`electron-builder`）

- `package.json`：`dependencies` 加 `pdf-lib`、`ffmpeg-static`、`gifenc`（GIF 编码，轻量纯 JS）。
- `electron-builder.yml`：加
  ```yaml
  asarUnpack:
    - node_modules/ffmpeg-static/**
  ```
  （ffmpeg-static 的二进制需从 asar 解包到磁盘才能 spawn 执行。）
- 安装包体积将增大（ffmpeg 静态二进制约 40–80MB），用户已确认接受。
- 验证：`npm run typecheck` → `npm run build && npm start` 手工验证 → `npm run dist` 产出安装包。

## 7. 文档更新

- `docs/API_SPEC.md`：新增 §watermark 域接口（上述通道表）。
- `docs/modules/watermark.md`：新增模块设计（镜像本文精简版）。
- `README.md` 功能概览表：加「水印」行。
- `docs/ARCHITECTURE.md`：状态行补「水印保护」域（图片 canvas / PDF pdf-lib / 视频 ffmpeg）。

## 8. 验收标准

- [ ] 选择图片批量加水印：输出 `原名.水印.ext`，原图不动，单行 / 一页两行/三行/六行/八行均正确。
- [ ] 图片输出**保持原格式**：png / jpg / jpeg / webp / bmp / gif 各加一份，输出扩展名与原文件**逐字一致**（`.jpg` 输入 → `.jpg` 输出、`.jpeg` 输入 → `.jpeg` 输出，不能变为其他格式）。
- [ ] 单行模式九宫格位置与旋转角度生效。
- [ ] 多页 PDF 加水印：`applyToAllPages` 开 → 全部页；关 → 仅第一页；中文水印正确显示（CJK 字体嵌入生效）。
- [ ] 视频加水印：输出同容器新文件，水印叠加正确、音频保留、进度条推进、可取消。
- [ ] 输出路径冲突自动加序号。
- [ ] `npm run typecheck` 通过（node + web）。

## 9. 阶段外（明确不做）

- 水印颜色自定义、图片水印 / LOGO（只做文字水印）。
- 水印历史 / 批量任务持久化（无表）。
- 视频批量队列 / 断点续传。
- GIF **逐帧动画**保留（仅首帧 + 水印，输出静态 GIF）。
- svg / ico / heic / tiff / psd 等非常见栅格格式入水印（canvas 无法可靠保证原格式输出，选择器排除）。
- 压缩 / 裁剪 / 加密等其它 PDF 操作。
