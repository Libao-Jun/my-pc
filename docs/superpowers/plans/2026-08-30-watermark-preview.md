# 水印保护功能优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 水印模块三升级 —— 原件水印预览（图片/PDF/视频）、配置表单 4 组改造（字号/不透明度/旋转角度独占一行、布局与对齐改下拉）、应用范围扩展（全部/奇数/偶数页）。

**Architecture:** 数据模型在 `src/shared/watermark.ts` 单一真相源重构（`position`→`hAlign`+`vAlign`，`applyToAllPages`→`pageScope`），沿既有 main(preload)→renderer 分层：main 服务负责 PDF 按范围选页与视频抽帧，渲染层负责表单与原件预览合成（复用 `drawWatermarkOn`）。PDF 预览新增 `pdfjs-dist` 渲染首页。

**Tech Stack:** Electron · React · TypeScript · pdf-lib/pdfjs-dist · ffmpeg-static · zustand · electron-vite。

## Global Constraints

- 共享层 `src/shared/watermark.ts` 保持「纯 TS、无运行时导入，Node 验证脚本可直接执行」。
- **不改 `computeWatermarkPlacements` 的平铺/旋转算法**，仅 `single` 分支锚点改读 `hAlign`/`vAlign`。
- 不改视频覆盖层、图片合成管线、BMP/GIF 编码（`watermarkRenderer.ts` 不改）。
- 只改与本次需求相关的文件；中文 UI 文案；提交消息以 `Co-Authored-By: Claude <noreply@anthropic.com>` 结尾。
- 验证命令：`node scripts/verify-watermark.ts`（期望 `ALL_WATERMARK_LAYOUT_TESTS_PASSED`）与 `npm run typecheck`（node + web 两套）。

---

### Task 1: 水印配置模型重构 + 主进程按范围选页 + 表单 4 组改造

**Files:**
- Modify: `src/shared/watermark.ts`
- Modify: `src/shared/types.ts`
- Modify: `scripts/verify-watermark.ts`
- Modify: `src/main/services/watermark.service.ts`
- Modify: `src/renderer/src/pages/Watermark/WatermarkConfigForm.tsx`
- Modify: `src/renderer/src/pages/Watermark/WatermarkConfigForm.module.css`

**Interfaces:**
- Consumes: 现 `WatermarkConfig`（position / applyToAllPages）。
- Produces: 新 `WatermarkConfig`（hAlign / vAlign / pageScope）+ `WatermarkHAlign`/`WatermarkVAlign`/`WatermarkPageScope` 类型；`computeWatermarkPlacements(width, height, config, textWidth=0)` 签名不变。后续 Task 2/3 依赖此新模型。

- [ ] **Step 1: 重构 `src/shared/watermark.ts` 数据模型**

将 `WatermarkPosition` 联合类型替换为三组新类型，并重写 `positionAnchor` 与默认配置。最终文件核心部分：

```ts
export type WatermarkLayout = 'single' | 'multi2' | 'multi3' | 'multi6' | 'multi8'
export type WatermarkHAlign = 'left' | 'center' | 'right'
export type WatermarkVAlign = 'top' | 'middle' | 'bottom'
export type WatermarkPageScope = 'all' | 'odd' | 'even'

export interface WatermarkConfig {
  text: string
  fontFamily: string
  fontSize: number
  opacity: number
  rotation: number
  layout: WatermarkLayout
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

`positionAnchor` 改为读取 config（x：left→m / right→w-m / center→w/2；y：top→m / bottom→h-m / middle→h/2）：

```ts
function positionAnchor(w: number, h: number, config: WatermarkConfig): WatermarkPlacement {
  const m = Math.min(w, h) * 0.06
  const x = config.hAlign === 'left' ? m : config.hAlign === 'right' ? w - m : w / 2
  const y = config.vAlign === 'top' ? m : config.vAlign === 'bottom' ? h - m : h / 2
  return { x, y }
}
```

`computeWatermarkPlacements` 中两处 `positionAnchor(width, height, config.position)` → `positionAnchor(width, height, config)`；其余（n 提取、带符号 tan、行错位循环）逐字不动。

- [ ] **Step 2: 更新 `src/shared/types.ts` 类型再导出**

`WatermarkPosition` → 新三类型：

```ts
import type { WatermarkConfig, WatermarkLayout, WatermarkHAlign, WatermarkVAlign, WatermarkPageScope } from './watermark'
export type { WatermarkConfig, WatermarkLayout, WatermarkHAlign, WatermarkVAlign, WatermarkPageScope } from './watermark'
```

- [ ] **Step 3: 更新 `scripts/verify-watermark.ts` 两处断言**

- 第 11 行：`{ ...base, layout: 'single', position: 'center' }` → `{ ...base, layout: 'single', hAlign: 'center', vAlign: 'middle' }`
- 第 16 行：`{ ...base, layout: 'single', position: 'top-left' }` → `{ ...base, layout: 'single', hAlign: 'left', vAlign: 'top' }`

其余断言（single 居中→(500,300)、top-left 左上、multi2/3/6/8 条带、带符号 tan 方向）不动。

- [ ] **Step 4: `src/main/services/watermark.service.ts` applyPdf 按 pageScope 选页**

将：

```ts
const pages = config.applyToAllPages ? doc.getPages() : doc.getPages().slice(0, 1)
```

替换为：

```ts
const allPages = doc.getPages()
const pages = allPages.filter((_, i) => {
  if (config.pageScope === 'odd') return i % 2 === 0   // 第 1,3,5…页
  if (config.pageScope === 'even') return i % 2 === 1  // 第 2,4,6…页
  return true                                          // all
})
```

（单页 PDF 配 odd/even 时 `pages` 可能为空 → 无页可加水印，直接保存原样副本，不报错。空数组 `for...of` 天然跳过。）

- [ ] **Step 5: 重写 `src/renderer/src/pages/Watermark/WatermarkConfigForm.tsx` 为 4 组表单**

删除原 `.row`（字号/不透明度/旋转角度挤一行）、`.radios` 布局胶囊、`.grid9` 9 宫格、`.check` 复选框。新表单完整代码：

```tsx
import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import type { WatermarkHAlign, WatermarkVAlign, WatermarkPageScope, WatermarkLayout } from '@shared/watermark'
import styles from './WatermarkConfigForm.module.css'

const FONTS = ['Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'Arial', 'Georgia']
const LAYOUTS: { value: WatermarkLayout; label: string }[] = [
  { value: 'single', label: '单行' },
  { value: 'multi2', label: '一页两行' },
  { value: 'multi3', label: '一页三行' },
  { value: 'multi6', label: '一页六行' },
  { value: 'multi8', label: '一页八行' }
]
const ALIGN_H: { value: WatermarkHAlign; label: string }[] = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中对齐' },
  { value: 'right', label: '右对齐' }
]
const ALIGN_V: { value: WatermarkVAlign; label: string }[] = [
  { value: 'top', label: '顶部对齐' },
  { value: 'middle', label: '居中对齐' },
  { value: 'bottom', label: '底部对齐' }
]
const SCOPES: { value: WatermarkPageScope; label: string }[] = [
  { value: 'all', label: '全部页面' },
  { value: 'odd', label: '奇数页' },
  { value: 'even', label: '偶数页' }
]

export function WatermarkConfigForm(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const setConfig = useWatermarkStore((s) => s.setConfig)
  const single = config.layout === 'single'

  return (
    <div className={styles.form}>
      <section className={styles.group}>
        <h4 className={styles.groupTitle}>水印文本</h4>
        <label className={styles.field}>
          <span>水印文本</span>
          <input type="text" value={config.text} maxLength={200} onChange={(e) => setConfig({ text: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span>字体</span>
          <select value={config.fontFamily} onChange={(e) => setConfig({ fontFamily: e.target.value })}>
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>字号</span>
          <input type="number" min={1} max={500} value={config.fontSize}
            onChange={(e) => setConfig({ fontSize: Number(e.target.value) || 1 })} />
        </label>
      </section>

      <section className={styles.group}>
        <h4 className={styles.groupTitle}>外观</h4>
        <label className={styles.field}>
          <span>旋转角度</span>
          <input type="number" min={-90} max={90} value={config.rotation}
            onChange={(e) => setConfig({ rotation: Number(e.target.value) })} />
        </label>
        <label className={styles.field}>
          <span>不透明度</span>
          <input type="range" min={0.05} max={1} step={0.05} value={config.opacity}
            onChange={(e) => setConfig({ opacity: Number(e.target.value) })} />
          <em>{config.opacity.toFixed(2)}</em>
        </label>
        <label className={styles.field}>
          <span>布局</span>
          <select value={config.layout} onChange={(e) => setConfig({ layout: e.target.value as WatermarkLayout })}>
            {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
      </section>

      <section className={`${styles.group}${single ? '' : ` ${styles.disabled}`}`}>
        <h4 className={styles.groupTitle}>文本位置{!single ? '（仅单行生效）' : ''}</h4>
        <label className={styles.field}>
          <span>垂直对齐</span>
          <select value={config.vAlign} disabled={!single}
            onChange={(e) => setConfig({ vAlign: e.target.value as WatermarkVAlign })}>
            {ALIGN_V.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>水平对齐</span>
          <select value={config.hAlign} disabled={!single}
            onChange={(e) => setConfig({ hAlign: e.target.value as WatermarkHAlign })}>
            {ALIGN_H.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
      </section>

      <section className={styles.group}>
        <h4 className={styles.groupTitle}>应用范围（仅 PDF 生效）</h4>
        <label className={styles.field}>
          <span>应用页面</span>
          <select value={config.pageScope}
            onChange={(e) => setConfig({ pageScope: e.target.value as WatermarkPageScope })}>
            {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </section>
    </div>
  )
}
```

- [ ] **Step 6: 更新 `WatermarkConfigForm.module.css`**

删除 `.row`、`.radios`、`.radio`、`.grid9`、`.dot`、`.check` 规则，新增分组样式；`.form`/`.field` 保留并微调（`.form` 继续 flex column gap；`em` 保留给不透明度数值）。追加：

```css
.group {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.groupTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}
.disabled {
  opacity: 0.6;
}
```

- [ ] **Step 7: 验证**

Run:
```bash
cd "E:/monorepo/my-pc"
node scripts/verify-watermark.ts
npm run typecheck
```
Expected: `ALL_WATERMARK_LAYOUT_TESTS_PASSED`；`typecheck` 零错误（node + web 两套均过）。

- [ ] **Step 8: 提交**

```bash
git add src/shared/watermark.ts src/shared/types.ts scripts/verify-watermark.ts src/main/services/watermark.service.ts src/renderer/src/pages/Watermark/WatermarkConfigForm.tsx src/renderer/src/pages/Watermark/WatermarkConfigForm.module.css
git commit -m "feat(watermark): 配置模型重构（position→hAlign/vAlign、applyToAllPages→pageScope）+ PDF 按范围选页 + 表单 4 组改造
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 后端能力扩展 —— 原件选择 / 视频抽帧 / 校验增强

**Files:**
- Modify: `src/shared/types.ts`（`WatermarkApi` 增两方法）
- Modify: `src/main/services/watermark.service.ts`（`extractVideoFrame`）
- Modify: `src/main/ipc/watermark.ipc.ts`（validateConfig + 两处理器）
- Modify: `src/preload/index.ts`（两方法）

**Interfaces:**
- Consumes: Task 1 新 `WatermarkConfig`；现有 `readBinary`/`resolveFfmpeg`/`getVideoInfo`。
- Produces: `WatermarkApi.pickOriginal(): Promise<IpcResult<string | null>>`、`WatermarkApi.extractVideoFrame(payload: { filePath: string; timeMs: number }): Promise<IpcResult<Uint8Array>>`。Task 3 预览依赖这两个接口。

- [ ] **Step 1: `src/shared/types.ts` 扩展 `WatermarkApi`**

在 `pickFiles` 后加 `pickOriginal`，在 `getVideoInfo` 后加 `extractVideoFrame`：

```ts
export interface WatermarkApi {
  pickFiles(type: WatermarkFileType): Promise<IpcResult<string[] | null>>
  pickOriginal(): Promise<IpcResult<string | null>>
  readBinary(path: string): Promise<IpcResult<Uint8Array>>
  writeFile(payload: { sourcePath: string; data: Uint8Array }): Promise<IpcResult<WatermarkApplyResult>>
  applyPdf(payload: { filePath: string; config: WatermarkConfig }): Promise<IpcResult<WatermarkApplyResult>>
  getVideoInfo(path: string): Promise<IpcResult<{ width: number; height: number; durationMs: number }>>
  extractVideoFrame(payload: { filePath: string; timeMs: number }): Promise<IpcResult<Uint8Array>>
  applyVideo(payload: {
    filePath: string
    config: WatermarkConfig
    watermarkPng: Uint8Array
  }): Promise<IpcResult<WatermarkApplyResult>>
  cancelVideo(): void
  onVideoProgress(cb: (p: VideoProgress) => void): () => void
}
```

- [ ] **Step 2: `src/main/services/watermark.service.ts` 新增 `extractVideoFrame`**

在文件顶部 import 区追加（`execFile` 已导入）：

```ts
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
```

在 `getVideoInfo` 后追加：

```ts
// 抽一帧预览图（PNG 字节）。timeMs 为时间点，-ss 置于 -i 前（快进）。
export async function extractVideoFrame(filePath: string, timeMs: number): Promise<Buffer> {
  const bin = resolveFfmpeg()
  const framePath = path.join(tmpdir(), `mypc-wm-frame-${Date.now()}.png`)
  const secs = (timeMs / 1000).toFixed(3)
  try {
    await execFileAsync(bin, ['-ss', secs, '-i', filePath, '-frames:v', '1', '-f', 'image2', '-y', framePath])
    return await readBinary(framePath)
  } catch (e) {
    throw new AppError('PROCESS_FAILED', '视频抽帧失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    void rm(framePath, { force: true })
  }
}
```

（`rm` 已在导入列表；`tmpdir`/`path` 已在导入列表。）

- [ ] **Step 3: `src/main/ipc/watermark.ipc.ts` 校验增强 + 两处理器**

`validateConfig` 末尾（layout 校验后）追加：

```ts
const alignsH = ['left', 'center', 'right']
const alignsV = ['top', 'middle', 'bottom']
const scopes = ['all', 'odd', 'even']
if (!alignsH.includes(config.hAlign)) throw new AppError('VALIDATION_ERROR', '未知的水平对齐方式')
if (!alignsV.includes(config.vAlign)) throw new AppError('VALIDATION_ERROR', '未知的垂直对齐方式')
if (!scopes.includes(config.pageScope)) throw new AppError('VALIDATION_ERROR', '未知的应用范围')
```

在常量区新增合并过滤器，并追加两个 handler（放在 `watermark:readBinary` 之后）：

```ts
const ORIGINAL_FILTER = {
  name: '原件',
  extensions: [...IMAGE_FILTER.extensions, ...PDF_FILTER.extensions, ...VIDEO_FILTER.extensions]
}
// —— 预览用：合并类型单选原件 ——
ipcMain.handle('watermark:pickOriginal', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择要预览水印效果的原件',
    properties: ['openFile'],
    filters: [ORIGINAL_FILTER]
  })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('watermark:extractVideoFrame', async (_event, payload: { filePath: string; timeMs: number }) => {
  if (!payload || typeof payload.filePath !== 'string' || !payload.filePath) {
    throw new AppError('VALIDATION_ERROR', '无效的文件路径')
  }
  if (typeof payload.timeMs !== 'number' || !Number.isFinite(payload.timeMs) || payload.timeMs < 0) {
    throw new AppError('VALIDATION_ERROR', '无效的抽帧时间')
  }
  return extractVideoFrame(payload.filePath, payload.timeMs)
})
```

import 列表追加 `extractVideoFrame`。

- [ ] **Step 4: `src/preload/index.ts` 暴露两方法**

`watermark` 对象内，`pickFiles` 行后加 `pickOriginal`；`getVideoInfo` 行后加 `extractVideoFrame`：

```ts
pickOriginal: () => invoke<string | null>('watermark:pickOriginal'),
extractVideoFrame: (payload: { filePath: string; timeMs: number }) =>
  invoke<Uint8Array>('watermark:extractVideoFrame', payload),
```

- [ ] **Step 5: 验证**

Run: `npm run typecheck:node`
Expected: 零错误（main + preload + shared 通过）。

- [ ] **Step 6: 提交**

```bash
git add src/shared/types.ts src/main/services/watermark.service.ts src/main/ipc/watermark.ipc.ts src/preload/index.ts
git commit -m "feat(watermark): 后端扩展 —— pickOriginal 原件选择 / extractVideoFrame 视频抽帧 / validateConfig 校验 hAlign·vAlign·pageScope
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 原件水印预览（pdfjs-dist + 预览组件 + 渲染层工具）

**Files:**
- Modify: `package.json`（`pdfjs-dist` 依赖）
- Create: `src/renderer/src/utils/watermarkPreview.ts`
- Modify: `src/renderer/src/pages/Watermark/WatermarkPreview.tsx`
- Modify: `src/renderer/src/pages/Watermark/WatermarkPreview.module.css`

**Interfaces:**
- Consumes: Task 2 的 `pickOriginal`/`extractVideoFrame`；现有 `readBinary`/`getVideoInfo`/`drawWatermarkOn`；新 `WatermarkConfig`。
- Produces: 预览组件可上传原件并实时绘制「原件+水印」。

- [ ] **Step 1: 添加 `pdfjs-dist` 依赖并安装**

`package.json` dependencies 追加：

```json
"pdfjs-dist": "^4.0.0"
```

Run: `npm install`
Expected: 安装成功，`package-lock.json` 更新。

- [ ] **Step 2: 新建 `src/renderer/src/utils/watermarkPreview.ts`**

完整文件：

```ts
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { drawWatermarkOn } from './watermarkRenderer'
import type { WatermarkConfig } from '@shared/watermark'
import type { WatermarkFileType } from '@shared/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']
const PDF_EXT = ['pdf']
const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'ts', 'm4v']

export function inferPreviewType(filePath: string): WatermarkFileType | null {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : ''
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (PDF_EXT.includes(ext)) return 'pdf'
  if (VIDEO_EXT.includes(ext)) return 'video'
  return null
}

// 预览框适配（maxW 340 / maxH 260，等比缩小，不放大）
const MAX_W = 340
const MAX_H = 260

function fitSize(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, MAX_W / w, MAX_H / h)
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

export interface PreviewApi {
  readBinary(path: string): Promise<{ ok: boolean; data?: Uint8Array; error?: { message: string } }>
  getVideoInfo(
    path: string
  ): Promise<{ ok: boolean; data?: { width: number; height: number; durationMs: number }; error?: { message: string } }>
  extractVideoFrame(payload: { filePath: string; timeMs: number }): Promise<{ ok: boolean; data?: Uint8Array; error?: { message: string } }>
}

function drawBase(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, config: WatermarkConfig): void {
  const { w, h } = fitSize(bitmap.width, bitmap.height)
  ctx.canvas.width = w
  ctx.canvas.height = h
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  drawWatermarkOn(ctx, w, h, config)
}

// 渲染「原件+水印」到 canvas；返回预览范围说明（无说明返回 ''）；失败抛错。
export async function renderOriginalPreview(
  canvas: HTMLCanvasElement,
  filePath: string,
  type: WatermarkFileType,
  config: WatermarkConfig,
  api: PreviewApi
): Promise<string> {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 初始化失败')

  if (type === 'image' || type === 'video') {
    let bytes: Uint8Array
    if (type === 'image') {
      const r = await api.readBinary(filePath)
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? '读取图片失败')
      bytes = r.data
    } else {
      const info = await api.getVideoInfo(filePath)
      const durationMs = info.ok ? info.data?.durationMs ?? 0 : 0
      const timeMs = Math.min(5000, Math.max(1000, durationMs * 0.05)) // 避开黑场首帧：≥1s 且 ≤5s
      const f = await api.extractVideoFrame({ filePath, timeMs })
      if (!f.ok || !f.data) throw new Error(f.error?.message ?? '视频抽帧失败')
      bytes = f.data
    }
    const bitmap = await createImageBitmap(new Blob([bytes]))
    drawBase(ctx, bitmap, config)
    bitmap.close()
    return type === 'video' ? '预览为前几秒帧' : ''
  }

  // PDF：渲染第 1 页后叠加水印
  const r = await api.readBinary(filePath)
  if (!r.ok || !r.data) throw new Error(r.error?.message ?? '读取 PDF 失败')
  const pdf = await pdfjsLib.getDocument({ data: r.data }).promise
  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const fit = fitSize(baseViewport.width, baseViewport.height)
    const viewport = page.getViewport({ scale: fit.w / baseViewport.width })
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: ctx, viewport }).promise
    drawWatermarkOn(ctx, canvas.width, canvas.height, config)
    return '预览为首页'
  } finally {
    await pdf.destroy()
  }
}
```

- [ ] **Step 3: 重写 `src/renderer/src/pages/Watermark/WatermarkPreview.tsx`**

完整文件：

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import { inferPreviewType, renderOriginalPreview } from '@renderer/utils/watermarkPreview'
import type { PreviewApi } from '@renderer/utils/watermarkPreview'
import type { WatermarkFileType } from '@shared/types'
import styles from './WatermarkPreview.module.css'

interface Original {
  path: string
  name: string
  type: WatermarkFileType
}

export function WatermarkPreview(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [original, setOriginal] = useState<Original | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const api: PreviewApi = useMemo(
    () => ({
      readBinary: async (path) => window.api.watermark.readBinary(path),
      getVideoInfo: async (path) => window.api.watermark.getVideoInfo(path),
      extractVideoFrame: async (p) => window.api.watermark.extractVideoFrame(p)
    }),
    []
  )

  const upload = async (): Promise<void> => {
    const r = await window.api.watermark.pickOriginal()
    if (!r.ok) {
      setError(r.error.message)
      return
    }
    const path = r.data
    if (!path) return
    const type = inferPreviewType(path)
    if (!type) {
      setError('不支持的文件类型')
      return
    }
    setOriginal({ path, name: path.split(/[\\/]/).pop() ?? path, type })
    setError(null)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !original) return
    let cancelled = false
    setError(null)
    renderOriginalPreview(canvas, original.path, original.type, config, api)
      .then((n) => {
        if (!cancelled) setNote(n)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '预览失败')
      })
    return () => {
      cancelled = true
    }
  }, [original, config, api])

  return (
    <div className={styles.preview}>
      <h3 className={styles.title}>水印效果预览</h3>
      {!original ? (
        <div className={styles.empty}>
          <p>请上传原件以预览水印效果</p>
          <button type="button" onClick={() => void upload()}>
            上传原件（图片 / PDF / 视频）
          </button>
        </div>
      ) : (
        <>
          <div className={styles.meta}>
            <span className={styles.name} title={original.path}>
              {original.name}
            </span>
            <button type="button" onClick={() => void upload()}>
              更换原件
            </button>
            <button
              type="button"
              onClick={() => {
                setOriginal(null)
                setNote('')
              }}
            >
              清除
            </button>
          </div>
          <canvas ref={canvasRef} className={styles.canvas} />
          {note && <p className={styles.note}>{note}</p>}
          {error && <p className={styles.error}>{error}</p>}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 更新 `WatermarkPreview.module.css`**

保留 `.preview`/`.title`，替换 `.canvas` 并追加 `.empty`/`.meta`/`.name`/`.note`/`.error`：

```css
.canvas {
  max-width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  display: block;
  background: #fff;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 0;
  color: #6b7280;
  font-size: 13px;
  border: 1px dashed #d1d5db;
  border-radius: 6px;
}
.empty p {
  margin: 0;
}
.empty button,
.meta button {
  padding: 5px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.name {
  font-size: 12px;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.note {
  margin: 6px 0 0;
  font-size: 12px;
  color: #6b7280;
}
.error {
  margin: 6px 0 0;
  font-size: 12px;
  color: #dc2626;
}
```

- [ ] **Step 5: 验证**

Run:
```bash
cd "E:/monorepo/my-pc"
node scripts/verify-watermark.ts
npm run typecheck
```
Expected: verify 通过；typecheck（node + web）零错误；`pdfjs-dist` 类型与 `?url` 资产引用（`vite/client` 已由 `src/renderer/src/env.d.ts` 提供）无误。

- [ ] **Step 6: 手动 E2E（本步需人审）**

在 `npm run dev` 中验证：
1. 水印页预览区：未上传显示「请上传原件…」+ 按钮；上传图片 → 实时显示「图片+水印」，改配置即时刷新。
2. 上传 PDF → 显示首页+水印，标注「预览为首页」；损坏 PDF 显示错误文案不崩溃。
3. 上传视频 → 抽帧预览并标注「预览为前几秒帧」；超长/无时长视频回退 1s 可预览。
4. 表单 4 组正确；字号/不透明度/旋转角度各独占一行；布局与两个对齐为下拉；多行布局下文本位置禁用。
5. 应用范围：多页 PDF 依次选 全部/奇数/偶数 → 输出 PDF 对应页码有水印；图片/视频整片生效。
6. 预览可「更换原件」「清除」。

- [ ] **Step 7: 提交**

```bash
git add package.json package-lock.json src/renderer/src/utils/watermarkPreview.ts src/renderer/src/pages/Watermark/WatermarkPreview.tsx src/renderer/src/pages/Watermark/WatermarkPreview.module.css
git commit -m "feat(watermark): 原件水印预览（图片 canvas / PDF pdfjs-dist 首页 / 视频 ffmpeg 抽帧）+ pdfjs-dist 依赖
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage** —— 逐条对照 spec：
- §4.1 模型 → Task 1 Step 1 ✓
- §4.2 类型契约 → Task 1 Step 2（再导出）+ Task 2 Step 1（WatermarkApi）✓
- §4.3 applyPdf 范围 → Task 1 Step 4；extractVideoFrame → Task 2 Step 2 ✓
- §4.4 validateConfig + 两处理器 → Task 2 Step 3 ✓
- §4.5 preload → Task 2 Step 4 ✓
- §4.6 renderer 工具不改 → 计划未触碰 ✓
- §4.7 表单 4 组 → Task 1 Step 5/6 ✓
- §4.8 预览 → Task 3 ✓（含图片/PDF/视频三分支、范围标注、更换/清除、错误态）
- §4.9 store 无改动 → 未触碰 ✓
- §4.10 pdfjs-dist → Task 3 Step 1 ✓
- §4.11 verify 脚本 → Task 1 Step 3 ✓
- §5 验证口径 → Task 1 Step 7 / Task 2 Step 5 / Task 3 Step 5-6 ✓

**2. Placeholder scan** —— 无 TBD/TODO/「添加错误处理」式占位；每步含具体代码或命令。

**3. Type consistency** —— `WatermarkHAlign/VAlign/PageScope` 三任务间一致；`computeWatermarkPlacements` 签名未变；`WatermarkApi.pickOriginal/extractVideoFrame` 在 Task 2 定义、Task 3 消费，参数与返回类型逐字一致（`IpcResult<string|null>` / `IpcResult<Uint8Array>`）。

**4. Task 边界（每次提交后 tree 绿色）**：
- Task 1：模型+全部现有消费方（main applyPdf、form）同步改 → verify + 双 typecheck 过。
- Task 2：纯增量（新 handler + preload）→ typecheck:node 过。
- Task 3：纯增量（预览）→ 双 typecheck 过。
