# 水印保护功能（图片 / PDF / 视频防伪水印）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「水印保护」功能域，对图片（批量）、PDF（批量）、视频（单文件）添加可定制的防伪文字水印，输出另存为 `原名.水印.ext` 且**保持原格式**。

**Architecture:** 新增 `watermark` 功能域，遵循现有 `service → ipc → preload → store → page` 三层模式。布局算法集中到 `src/shared/watermark.ts` 纯函数（单一真相源）。图片走渲染层 canvas 管线（零依赖 + `gifenc`），PDF 走主进程 `pdf-lib`（嵌入系统 CJK 字体），视频走主进程 ffmpeg（透明水印 PNG 覆盖层 + overlay，音频 `-c:a copy`）。

**Tech Stack:** Electron 36 / React 18 / TypeScript 5 strict / Zustand / CSS Modules / `pdf-lib` / `@pdf-lib/fontkit` / `ffmpeg-static` / `gifenc`

## Global Constraints

- TypeScript strict，禁止 `any`；`npm run typecheck` 为每任务的验证门（node + web 两端）。
- IPC 通道命名 `domain:action`，只传可序列化数据，渲染层无 Node 访问（`contextIsolation`）。
- **输出格式必须与原文件逐字一致**：`.jpg`→`.jpg`、`.jpeg`→`.jpeg`、`.png`→`.png`、`.webp`→`.webp`、`.bmp`→`.bmp`、`.gif`→`.gif`（静态帧）；PDF→PDF；视频→同容器。图片选择器仅开放 `png/jpg/jpeg/webp/bmp/gif`。
- 输出命名 `原名.水印.ext`，路径冲突自动加序号 `原名.水印(1).ext`。
- 水印颜色固定中性灰 `#808080`（不做自定义）；布局：单行 / 一页两行/三行/六行/八行；文本位置九宫格仅单行生效；`applyToAllPages` 仅 PDF 生效。
- 错误统一 `AppError` + `ErrorCode`；新增 `PROCESS_FAILED` 错误码。
- 依赖仅允许新增：`pdf-lib`、`@pdf-lib/fontkit`（pdf-lib 嵌入自定义字体必需，Task 4 修复轮补加）、`ffmpeg-static`、`gifenc`；图片编码除 GIF 外零依赖。
- 界面文案中文，主进程错误信息抛中文。

---

### Task 1: 共享水印模型 + 布局算法（`shared/watermark.ts`）+ 纯函数验证脚本

**Files:**
- Create: `src/shared/watermark.ts`
- Create: `scripts/verify-watermark.ts`

**Interfaces:**
- Produces:
  - `type WatermarkPosition`（`'center' | 'top-left' | 'top-center' | 'top-right' | 'center-left' | 'center-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'`）
  - `type WatermarkLayout`（`'single' | 'multi2' | 'multi3' | 'multi6' | 'multi8'`）
  - `interface WatermarkConfig { text: string; fontFamily: string; fontSize: number; opacity: number; rotation: number; layout: WatermarkLayout; position: WatermarkPosition; applyToAllPages: boolean }`
  - `const DEFAULT_WATERMARK_CONFIG: WatermarkConfig`
  - `interface WatermarkPlacement { x: number; y: number }`
  - `function computeWatermarkPlacements(width: number, height: number, config: WatermarkConfig, textWidth?: number): WatermarkPlacement[]`
    - `single` → 按 `position` 返回 1 个锚点（九宫格，边距 = `min(w,h)*0.06`）。
    - `multiN` → N 行对角线平铺：`sy = height / N`（垂直间距产生恰好 N 条带），`sx = max(textWidth * 1.6, sy)`（水平重复间距），`dx = sy / tan(θ)`（行间斜向偏移，θ = rotation 弧度；tan 过小取 0），锚点 `y = sy/2 + r*sy`、`x = width/2 + c*sx + r*dx`（`r ∈ [0,N)`，`c ∈ [-halfCols, halfCols]`）。

- [ ] **Step 1: 创建 `src/shared/watermark.ts`**

```ts
// 跨进程共享的水印模型与布局算法 —— 单一真相源（渲染层 canvas / 主进程 pdf-lib / 视频水印 PNG 共用）。
// 纯 TS、无任何运行时导入，保证 Node 验证脚本可直接执行。

export type WatermarkPosition =
  | 'center'
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export type WatermarkLayout = 'single' | 'multi2' | 'multi3' | 'multi6' | 'multi8'

export interface WatermarkConfig {
  text: string
  fontFamily: string
  fontSize: number
  opacity: number
  rotation: number
  layout: WatermarkLayout
  position: WatermarkPosition
  applyToAllPages: boolean
}

export const DEFAULT_WATERMARK_CONFIG: WatermarkConfig = {
  text: '机密',
  fontFamily: 'Microsoft YaHei',
  fontSize: 40,
  opacity: 0.3,
  rotation: -45,
  layout: 'multi3',
  position: 'center',
  applyToAllPages: true
}

export interface WatermarkPlacement {
  x: number
  y: number
}

function positionAnchor(w: number, h: number, position: WatermarkPosition): WatermarkPlacement {
  const m = Math.min(w, h) * 0.06
  switch (position) {
    case 'top-left': return { x: m, y: m }
    case 'top-center': return { x: w / 2, y: m }
    case 'top-right': return { x: w - m, y: m }
    case 'center-left': return { x: m, y: h / 2 }
    case 'center-right': return { x: w - m, y: h / 2 }
    case 'bottom-left': return { x: m, y: h - m }
    case 'bottom-center': return { x: w / 2, y: h - m }
    case 'bottom-right': return { x: w - m, y: h - m }
    default: return { x: w / 2, y: h / 2 }
  }
}

// 坐标系约定：y 轴向下（canvas 惯例）；PDF 消费方在绘制时自行翻转 y。
export function computeWatermarkPlacements(
  width: number,
  height: number,
  config: WatermarkConfig,
  textWidth = 0
): WatermarkPlacement[] {
  if (config.layout === 'single') return [positionAnchor(width, height, config.position)]

  const n = Number(config.layout.replace('multi', ''))
  if (!Number.isFinite(n) || n < 1) return [positionAnchor(width, height, config.position)]

  const theta = (config.rotation * Math.PI) / 180
  const sy = height / n
  const sx = Math.max(textWidth * 1.6, sy)
  const tan = Math.tan(theta)
  // 带符号 tan：相邻行错位跟随文字倾斜方向（-45° 时斜线带与文字同向）。注：初稿 abs(|tan|) 方向相反，用户裁决改为带符号。
  const dx = Math.abs(tan) > 1e-6 ? sy / tan : 0
  const halfCols = Math.ceil(width / sx / 2) + 1

  const out: WatermarkPlacement[] = []
  for (let r = 0; r < n; r++) {
    const y = sy / 2 + r * sy
    for (let c = -halfCols; c <= halfCols; c++) {
      out.push({ x: width / 2 + c * sx + r * dx, y })
    }
  }
  return out
}
```

- [ ] **Step 2: 创建 `scripts/verify-watermark.ts`（Node 直接运行，断言布局算法）**

```ts
import { computeWatermarkPlacements, DEFAULT_WATERMARK_CONFIG } from '../src/shared/watermark.ts'
import type { WatermarkConfig } from '../src/shared/watermark.ts'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg)
}

const base: WatermarkConfig = { ...DEFAULT_WATERMARK_CONFIG }

// single + center → 恰 1 个锚点，落在 (500, 300)
const single = computeWatermarkPlacements(1000, 600, { ...base, layout: 'single', position: 'center' }, 80)
assert(single.length === 1, 'single 应返回 1 个锚点，实际 ' + single.length)
assert(Math.abs(single[0].x - 500) < 1 && Math.abs(single[0].y - 300) < 1, 'single 居中锚点应落在 (500,300)')

// single + top-left → 锚点靠近左上
const tl = computeWatermarkPlacements(1000, 600, { ...base, layout: 'single', position: 'top-left' }, 80)
assert(tl[0].x < 200 && tl[0].y < 200, 'top-left 应在左上角')

// multi3 → 恰好 3 条 y 带，间距 = 600/3 = 200
const multi3 = computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi3' }, 80)
const ys3 = [...new Set(multi3.map((p) => Math.round(p.y)))].sort((a, b) => a - b)
assert(ys3.length === 3, 'multi3 应有 3 条 y 带，实际 ' + ys3.length)
assert(Math.abs(ys3[1] - ys3[0] - 200) <= 1, 'multi3 带间距应为 200')
assert(Math.abs(ys3[2] - ys3[1] - 200) <= 1, 'multi3 带间距应为 200')

// multi8 → 8 条带
const multi8 = computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi8' }, 80)
const ys8 = new Set(multi8.map((p) => Math.round(p.y)))
assert(ys8.size === 8, 'multi8 应有 8 条 y 带，实际 ' + ys8.size)

// multi2 / multi6 覆盖
assert(new Set(computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi2' }, 80).map((p) => Math.round(p.y))).size === 2, 'multi2 应为 2 条带')
assert(new Set(computeWatermarkPlacements(1000, 600, { ...base, layout: 'multi6' }, 80).map((p) => Math.round(p.y))).size === 6, 'multi6 应为 6 条带')

console.log('ALL_WATERMARK_LAYOUT_TESTS_PASSED')
```

- [ ] **Step 3: 运行验证脚本（Node 24 原生跑 TS）**

Run: `node scripts/verify-watermark.ts`
Expected: 输出 `ALL_WATERMARK_LAYOUT_TESTS_PASSED`，无 `ASSERT FAIL`。

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: 通过（无错误）。注意 `scripts/` 不在 tsconfig include 内，typecheck 只覆盖 `src/shared/watermark.ts`。

- [ ] **Step 5: 提交**

```bash
git add src/shared/watermark.ts scripts/verify-watermark.ts
git commit -m "feat(watermark): 共享水印模型与布局算法（computeWatermarkPlacements）+ 验证脚本"
```

---

### Task 2: 安装依赖 + 打包配置

**Files:**
- Modify: `package.json`
- Modify: `electron-builder.yml`

**Interfaces:**
- Consumes: Task 1 完成。
- Produces: `pdf-lib`、`ffmpeg-static`、`gifenc` 可被 `@shared`/main/renderer 导入；ffmpeg 二进制打包时解包到 asar.unpacked。

- [ ] **Step 1: `package.json` `dependencies` 增加三项**

把 `"dependencies"` 改为：

```json
  "dependencies": {
    "systeminformation": "^5.33.1",
    "pdf-lib": "^1.17.1",
    "ffmpeg-static": "^5.2.0",
    "gifenc": "^1.0.3",
    "@pdf-lib/fontkit": "^1.1.1"
  }
```

（版本以实现时 `npm install` 解析到的实际最新兼容版为准；`pdf-lib` ≥1.16、`ffmpeg-static` ≥5、`gifenc` ≥1、`@pdf-lib/fontkit` ≥1。注：`@pdf-lib/fontkit` 在 Task 4 修复轮补加——pdf-lib 嵌入自定义字体必须 `registerFontkit`，Task 4 代码块已同步。）

- [ ] **Step 2: `electron-builder.yml` 增加 `asarUnpack`**

文件改为：

```yaml
appId: com.mypc.app
productName: my-pc
directories:
  output: release
files:
  - out/**
asarUnpack:
  - node_modules/ffmpeg-static/**
win:
  target:
    - target: nsis
      arch:
        - x64
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false
```

- [ ] **Step 3: 安装依赖**

Run: `npm install`
Expected: 成功；`ffmpeg-static` 的 postinstall 会下载静态二进制（约 40–80MB，需联网，耗时正常）。

- [ ] **Step 4: 确认 ffmpeg 可用且含所需能力**

Run: `node -e "const p=require('ffmpeg-static');console.log('ffmpeg at',p)" && "$(node -e "process.stdout.write(require('ffmpeg-static'))")" -encoders 2>&1 | grep -iE "libx264|aac" | head`
Expected: 打印 ffmpeg 路径，且编码器列表含 `libx264` 与 `aac`。（若不含 libx264，改用 `-c:v mpeg4` 并记录偏差——实现时在 Task 4 的 filter 里统一确认。）

- [ ] **Step 5: 类型检查 + 提交**

Run: `npm run typecheck`
Expected: 通过。
```bash
git add package.json package-lock.json electron-builder.yml
git commit -m "chore(watermark): 引入 pdf-lib/ffmpeg-static/gifenc 依赖与 asarUnpack 打包配置"
```

---

### Task 3: IPC 契约类型（`shared/types.ts`）

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Consumes: Task 1 的 `WatermarkConfig`（`import type` from `'./watermark'`）。
- Produces:
  - `ErrorCode` 新增 `'PROCESS_FAILED'`
  - `interface WatermarkApplyResult { outputPath: string }`
  - `interface VideoProgress { percent: number }`
  - `interface WatermarkApi`（下方完整定义）
  - `interface WindowApi` 增加 `watermark: WatermarkApi`

- [ ] **Step 1: `ErrorCode` 加 `PROCESS_FAILED`**

`ErrorCode` 联合类型改为：

```ts
export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'INTERNAL'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_NOT_CONFIGURED'
  | 'AI_API_ERROR'
  | 'CANCELLED'
  | 'PROCESS_FAILED'
```

- [ ] **Step 2: 文件末尾（`WindowApi` 之前）增加 watermarked 契约**

```ts
// —— 水印保护域（watermark）——
export type { WatermarkConfig, WatermarkLayout, WatermarkPosition } from './watermark'

export interface WatermarkApplyResult {
  outputPath: string
}

export interface VideoProgress {
  percent: number
}

export type WatermarkFileType = 'image' | 'pdf' | 'video'

export interface WatermarkApi {
  pickFiles(type: WatermarkFileType): Promise<IpcResult<string[] | null>>
  readBinary(path: string): Promise<IpcResult<Uint8Array>>
  writeFile(payload: { sourcePath: string; data: Uint8Array }): Promise<IpcResult<WatermarkApplyResult>>
  applyPdf(payload: { filePath: string; config: WatermarkConfig }): Promise<IpcResult<WatermarkApplyResult>>
  getVideoInfo(path: string): Promise<IpcResult<{ width: number; height: number; durationMs: number }>>
  applyVideo(payload: {
    filePath: string
    config: WatermarkConfig
    watermarkPng: Uint8Array
  }): Promise<IpcResult<WatermarkApplyResult>>
  cancelVideo(): void
  onVideoProgress(cb: (p: VideoProgress) => void): () => void // 订阅 'watermark:videoProgress'，返回退订函数
}
```

- [ ] **Step 3: `WindowApi` 增加 `watermark` 域**

```ts
export interface WindowApi {
  app: AppApi
  settings: SettingsApi
  ai: AiApi
  system: SystemApi
  file: FileApi
  adblock: AdblockApi
  resume: ResumeApi
  diagram: DiagramApi
  watermark: WatermarkApi
}
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 5: 提交**

```bash
git add src/shared/types.ts
git commit -m "feat(watermark): IPC 契约类型（WatermarkApi + PROCESS_FAILED 错误码）"
```

---

### Task 4: 主进程服务（`watermark.service.ts`）+ ffmpeg-static 类型声明

**Files:**
- Create: `src/main/services/watermark.service.ts`
- Create: `src/main/types/ffmpeg-static.d.ts`

**Interfaces:**
- Consumes: Task 1 `computeWatermarkPlacements` / `WatermarkConfig`；Task 3 `AppError`/`PROCESS_FAILED`；`pdf-lib`、`ffmpeg-static`。
- Produces:
  - `export function watermarkOutputPath(filePath: string): string` — 输出路径 `原名.水印.ext`，冲突加序号
  - `export async function readBinary(filePath: string): Promise<Buffer>`
  - `export async function writeBinary(filePath: string, data: Uint8Array): Promise<string>`（返回写入的路径）
  - `export async function applyPdf(filePath: string, config: WatermarkConfig): Promise<string>`
  - `export interface VideoInfo { width: number; height: number; durationMs: number }`
  - `export async function getVideoInfo(filePath: string): Promise<VideoInfo>`
  - `export async function applyVideo(filePath: string, config: WatermarkConfig, watermarkPng: Uint8Array, onProgress: (percent: number) => void): Promise<string>`
  - `export function cancelVideo(): void`

- [ ] **Step 1: 创建 `src/main/types/ffmpeg-static.d.ts`**

```ts
declare module 'ffmpeg-static' {
  const path: string | null
  export default path
}
```

- [ ] **Step 2: 创建 `src/main/services/watermark.service.ts`**

```ts
import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import ffmpegPath from 'ffmpeg-static'
import { AppError } from '@shared/errors'
import { computeWatermarkPlacements } from '@shared/watermark'
import type { WatermarkConfig } from '@shared/watermark'

// 可嵌入的系统中文字体候选（Windows 10）。优先 .ttf（fontkit 直接支持），.ttc 集合尝试兜底。
const CJK_FONT_CANDIDATES = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/simsun.ttc'
]

export function watermarkOutputPath(filePath: string): string {
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath) // 保留原始扩展名（含大小写），满足「逐字一致」
  const base = path.basename(filePath, ext)
  let out = path.join(dir, `${base}.水印${ext}`)
  let i = 1
  while (existsSync(out)) {
    out = path.join(dir, `${base}.水印(${i})${ext}`)
    i++
  }
  return out
}

export async function readBinary(filePath: string): Promise<Buffer> {
  try {
    return await readFile(filePath)
  } catch {
    throw new AppError('NOT_FOUND', '文件不存在或不可读：' + filePath)
  }
}

export async function writeBinary(filePath: string, data: Uint8Array): Promise<string> {
  await writeFile(filePath, data)
  return filePath
}

async function loadCjkFont(doc: PDFDocument): Promise<PDFFont> {
  for (const cand of CJK_FONT_CANDIDATES) {
    try {
      return await doc.embedFont(await readFile(cand))
    } catch {
      // 尝试下一个候选（TTC 解析失败属已知风险）
    }
  }
  throw new AppError('PROCESS_FAILED', '未找到可嵌入的中文字体（已尝试 simhei / msyh / simsun），请在系统中安装中文字体后重试')
}

export async function applyPdf(filePath: string, config: WatermarkConfig): Promise<string> {
  const doc = await PDFDocument.load(await readBinary(filePath))
  // 嵌入自定义字体前必须注册 fontkit（pdf-lib 1.17.1 中为实例方法）。修复轮补加：原计划漏掉，导致 embedFont 运行时必失败。
  doc.registerFontkit(fontkit)
  const font = await loadCjkFont(doc)
  const pages = config.applyToAllPages ? doc.getPages() : doc.getPages().slice(0, 1)
  // 估算文本宽度（中文全角近似）：字号 × 字符数 × 0.6，仅用于多行模式的水平间距
  const textWidth = config.fontSize * config.text.length * 0.6
  for (const page of pages) {
    const { width, height } = page.getSize()
    const placements = computeWatermarkPlacements(width, height, config, textWidth)
    for (const p of placements) {
      // pdf-lib 坐标原点在左下角：翻转 y，且以文本左下为锚点，做居中修正
      page.drawText(config.text, {
        x: p.x - textWidth / 2,
        y: height - p.y - config.fontSize / 2,
        size: config.fontSize,
        font,
        rotate: degrees(config.rotation),
        opacity: config.opacity,
        color: rgb(0.5, 0.5, 0.5)
      })
    }
  }
  const out = watermarkOutputPath(filePath)
  await writeBinary(out, await doc.save())
  return out
}

export interface VideoInfo {
  width: number
  height: number
  durationMs: number
}

function resolveFfmpeg(): string {
  if (!ffmpegPath) throw new AppError('PROCESS_FAILED', '未找到 ffmpeg 可执行文件')
  return ffmpegPath
}

function parseVideoInfo(stderr: string): VideoInfo | null {
  // 宽松匹配 ffmpeg 6.x 的流标记（如 `Stream #0:0[0x1](und): Video:`）与普通形式（`Stream #0:0: Video:`）。修复轮改：原正则不含 `[0x1]` 可选组，在 gyan.dev ffmpeg 6.x 输出上匹配失败。
  const stream = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video:.*?(\d{2,5})x(\d{2,5})/.exec(stderr)
  const duration = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderr)
  if (!stream) return null
  let durationMs = 0
  if (duration) {
    durationMs = (Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000
  }
  return { width: Number(stream[1]), height: Number(stream[2]), durationMs }
}

export function getVideoInfo(filePath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    // ffmpeg -i 无输出参数时退出码非 0，但媒体信息在 stderr
    execFile(resolveFfmpeg(), ['-i', filePath], (err, _stdout, stderr) => {
      const info = parseVideoInfo(stderr)
      if (info) resolve(info)
      else reject(new AppError('PROCESS_FAILED', '无法解析视频信息：' + String(err?.message ?? '').slice(0, 200)))
    })
  })
}

let activeVideo: { child: ChildProcess; wmPath: string } | null = null

export function cancelVideo(): void {
  if (activeVideo) activeVideo.child.kill('SIGKILL')
}

export function applyVideo(
  filePath: string,
  config: WatermarkConfig,
  watermarkPng: Uint8Array,
  onProgress: (percent: number) => void
): Promise<string> {
  return (async () => {
    const info = await getVideoInfo(filePath)
    const bin = resolveFfmpeg()
    const wmPath = path.join(tmpdir(), `mypc-wm-${Date.now()}.png`)
    const out = watermarkOutputPath(filePath)
    await writeBinary(wmPath, watermarkPng)

    return new Promise<string>((resolve, reject) => {
      const args = [
        '-y',
        '-i', filePath,
        '-i', wmPath,
        '-filter_complex', '[1:v]format=rgba[wm];[0:v][wm]overlay=0:0[outv]',
        '-map', '[outv]',
        '-map', '0:a?',
        '-c:a', 'copy',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '18',
        '-movflags', '+faststart',
        out
      ]
      const child = spawn(bin, args)
      activeVideo = { child, wmPath }
      let stderrTail = ''

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderrTail = (stderrTail + text).slice(-2000)
        if (info.durationMs > 0) {
          const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text)
          if (m) {
            const t = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
            onProgress(Math.min(99, Math.round((t / info.durationMs) * 100)))
          }
        }
      })

      const cleanup = (): void => {
        void rm(wmPath, { force: true }).finally(() => {
          activeVideo = null
        })
      }

      child.on('error', (err) => {
        cleanup()
        reject(new AppError('PROCESS_FAILED', 'ffmpeg 启动失败：' + err.message))
      })

      child.on('close', (code) => {
        cleanup()
        if (code === 0) {
          onProgress(100)
          resolve(out)
        } else {
          reject(new AppError('PROCESS_FAILED', '视频处理失败（退出码 ' + code + '）：' + stderrTail.slice(-300)))
        }
      })
    })
  })()
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 通过（`pdf-lib`、`ffmpeg-static` 类型均已解析）。

- [ ] **Step 4: 提交**

```bash
git add src/main/services/watermark.service.ts src/main/types/ffmpeg-static.d.ts
git commit -m "feat(watermark): 主进程水印服务（pdf-lib 加 PDF 水印 + ffmpeg 视频 overlay + 输出路径去重）"
```

---

### Task 5: 主进程 IPC（`watermark.ipc.ts`）+ 注册

**Files:**
- Create: `src/main/ipc/watermark.ipc.ts`
- Modify: `src/main/ipc/index.ts`

**Interfaces:**
- Consumes: Task 4 的 service 函数；Task 3 类型；Task 1 `WatermarkConfig`。
- Produces: 注册 `watermark:pickFiles` / `watermark:readBinary` / `watermark:writeFile` / `watermark:applyPdf` / `watermark:getVideoInfo` / `watermark:applyVideo` / `watermark:cancelVideo`（`ipcMain.on`）。

- [ ] **Step 1: 创建 `src/main/ipc/watermark.ipc.ts`**

```ts
import { dialog, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { AppError } from '@shared/errors'
import type { WatermarkConfig, WatermarkFileType } from '@shared/types'
import {
  applyPdf,
  applyVideo,
  cancelVideo,
  getVideoInfo,
  readBinary,
  watermarkOutputPath,
  writeBinary
} from '../services/watermark.service'

const IMAGE_FILTER = { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
const PDF_FILTER = { name: 'PDF', extensions: ['pdf'] }
const VIDEO_FILTER = { name: '视频', extensions: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'ts', 'm4v'] }

function validateConfig(config: WatermarkConfig): void {
  if (typeof config !== 'object' || config === null) throw new AppError('VALIDATION_ERROR', '无效的水印配置')
  if (typeof config.text !== 'string' || config.text.trim().length === 0 || config.text.length > 200) {
    throw new AppError('VALIDATION_ERROR', '水印文本需为 1–200 字符')
  }
  if (typeof config.fontFamily !== 'string' || config.fontFamily.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', '字体无效')
  }
  if (!(config.fontSize > 0 && config.fontSize <= 500)) throw new AppError('VALIDATION_ERROR', '字号需为 1–500')
  if (!(config.opacity >= 0.05 && config.opacity <= 1)) throw new AppError('VALIDATION_ERROR', '不透明度需为 0.05–1')
  if (!(config.rotation >= -90 && config.rotation <= 90)) throw new AppError('VALIDATION_ERROR', '旋转角度需为 -90–90')
  const layouts = ['single', 'multi2', 'multi3', 'multi6', 'multi8']
  if (!layouts.includes(config.layout)) throw new AppError('VALIDATION_ERROR', '未知的布局模式')
}

export function registerWatermarkIpc(): void {
  ipcMain.handle('watermark:pickFiles', async (_event, type: WatermarkFileType) => {
    const filter = type === 'image' ? IMAGE_FILTER : type === 'pdf' ? PDF_FILTER : VIDEO_FILTER
    const result = await dialog.showOpenDialog({
      title: '选择要加水印的文件',
      properties: ['openFile', 'multiSelections'],
      filters: [filter]
    })
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle('watermark:readBinary', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) throw new AppError('VALIDATION_ERROR', '无效的文件路径')
    return readBinary(filePath)
  })

  ipcMain.handle('watermark:writeFile', async (_event, payload: { sourcePath: string; data: Uint8Array }) => {
    if (!payload || typeof payload.sourcePath !== 'string' || !payload.sourcePath) {
      throw new AppError('VALIDATION_ERROR', '无效的输出参数')
    }
    const out = watermarkOutputPath(payload.sourcePath)
    await writeBinary(out, payload.data)
    return { outputPath: out }
  })

  ipcMain.handle('watermark:applyPdf', async (_event, payload: { filePath: string; config: WatermarkConfig }) => {
    validateConfig(payload.config)
    if (typeof payload.filePath !== 'string') throw new AppError('VALIDATION_ERROR', '无效的文件路径')
    const outputPath = await applyPdf(payload.filePath, payload.config)
    return { outputPath }
  })

  ipcMain.handle('watermark:getVideoInfo', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) throw new AppError('VALIDATION_ERROR', '无效的文件路径')
    return getVideoInfo(filePath)
  })

  ipcMain.handle(
    'watermark:applyVideo',
    (event, payload: { filePath: string; config: WatermarkConfig; watermarkPng: Uint8Array }) => {
      validateConfig(payload.config)
      if (typeof payload.filePath !== 'string' || !payload.filePath) {
        throw new AppError('VALIDATION_ERROR', '无效的文件路径')
      }
      const sender: WebContents = event.sender
      return applyVideo(payload.filePath, payload.config, payload.watermarkPng, (percent) => {
        sender.send('watermark:videoProgress', { percent })
      })
    }
  )

  ipcMain.on('watermark:cancelVideo', () => {
    cancelVideo()
  })
}
```

- [ ] **Step 2: `src/main/ipc/index.ts` 注册 watermark 域**

```ts
import { registerWatermarkIpc } from './watermark.ipc'
```

并在此处加入注册调用：

```ts
  registerSystemIpc()
  registerFileIpc()
  registerAdblockIpc()
  registerWatermarkIpc()
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/main/ipc/watermark.ipc.ts src/main/ipc/index.ts
git commit -m "feat(watermark): 主进程 IPC 通道（pickFiles/readBinary/writeFile/applyPdf/getVideoInfo/applyVideo/cancelVideo）"
```

---

### Task 6: preload 暴露 `window.api.watermark`

**Files:**
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: Task 3 类型（`WatermarkApplyResult`、`VideoProgress`、`WatermarkFileType`）。
- Produces: `window.api.watermark` 完整可用。

- [ ] **Step 1: `import` 增加 watermark 类型**

在 `@shared/types` 的 import 列表加入：

```ts
  VideoProgress,
  WatermarkApplyResult,
  WatermarkFileType,
```

- [ ] **Step 2: `api` 对象增加 `watermark` 域（`diagram` 域之后）**

```ts
  watermark: {
    pickFiles: (type: WatermarkFileType) => invoke<string[] | null>('watermark:pickFiles', type),
    readBinary: (path: string) => invoke<Uint8Array>('watermark:readBinary', path),
    writeFile: (payload: { sourcePath: string; data: Uint8Array }) =>
      invoke<WatermarkApplyResult>('watermark:writeFile', payload),
    applyPdf: (payload: { filePath: string; config: WatermarkConfig }) =>
      invoke<WatermarkApplyResult>('watermark:applyPdf', payload),
    getVideoInfo: (path: string) =>
      invoke<{ width: number; height: number; durationMs: number }>('watermark:getVideoInfo', path),
    applyVideo: (payload: {
      filePath: string
      config: WatermarkConfig
      watermarkPng: Uint8Array
    }) => invoke<WatermarkApplyResult>('watermark:applyVideo', payload),
    cancelVideo: () => {
      ipcRenderer.send('watermark:cancelVideo')
    },
    onVideoProgress: (cb: (p: VideoProgress) => void) => {
      const listener = (_event: IpcRendererEvent, progress: VideoProgress): void => cb(progress)
      ipcRenderer.on('watermark:videoProgress', listener)
      return () => {
        ipcRenderer.removeListener('watermark:videoProgress', listener)
      }
    }
  }
```

`import` 列表还需补 `WatermarkConfig`（来自 `@shared/types` 的 re-export）。

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git add src/preload/index.ts
git commit -m "feat(watermark): preload 暴露 window.api.watermark"
```

---

### Task 7: 渲染层图像处理工具（`watermarkRenderer.ts`）

**Files:**
- Create: `src/renderer/src/utils/watermarkRenderer.ts`

**Interfaces:**
- Consumes: Task 1 `computeWatermarkPlacements` / `WatermarkConfig`；`gifenc`。
- Produces:
  - `export type WatermarkImageExt = 'png' | 'jpg' | 'jpeg' | 'webp' | 'bmp' | 'gif'`
  - `export function drawWatermarkOn(ctx: CanvasRenderingContext2D, width: number, height: number, config: WatermarkConfig): void`
  - `export async function watermarkImageBytes(data: Uint8Array, config: WatermarkConfig, ext: WatermarkImageExt): Promise<{ data: Uint8Array }>`
  - `export async function renderWatermarkPng(width: number, height: number, config: WatermarkConfig): Promise<Uint8Array>`
  - `export function encodeBmp(imageData: ImageData): Uint8Array`
  - `export function encodeGif(imageData: ImageData): Uint8Array`

- [ ] **Step 1: 创建 `src/renderer/src/utils/watermarkRenderer.ts`**

```ts
import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { computeWatermarkPlacements } from '@shared/watermark'
import type { WatermarkConfig } from '@shared/watermark'

export type WatermarkImageExt = 'png' | 'jpg' | 'jpeg' | 'webp' | 'bmp' | 'gif'

// 在指定 canvas 上下文上绘制水印（图片合成 / 预览 / 视频覆盖层共用）
export function drawWatermarkOn(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  config: WatermarkConfig
): void {
  ctx.font = `${config.fontSize}px ${config.fontFamily}`
  ctx.fillStyle = '#808080'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const textWidth = ctx.measureText(config.text).width
  const placements = computeWatermarkPlacements(width, height, config, textWidth)
  for (const p of placements) {
    ctx.save()
    ctx.globalAlpha = config.opacity
    ctx.translate(p.x, p.y)
    ctx.rotate((config.rotation * Math.PI) / 180)
    ctx.fillText(config.text, 0, 0)
    ctx.restore()
  }
}

// 完整图片管线：解码 → 合成 → 按原扩展名编码（png/jpg/jpeg/webp 用 toBlob；bmp/gif 用自编码）
export async function watermarkImageBytes(
  data: Uint8Array,
  config: WatermarkConfig,
  ext: WatermarkImageExt
): Promise<{ data: Uint8Array }> {
  const bitmap = await createImageBitmap(new Blob([data]))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 初始化失败')

  if (ext === 'gif') {
    // GIF 输出：先铺白底（避免透明区域在编码时丢失），再画首帧
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  drawWatermarkOn(ctx, canvas.width, canvas.height, config)
  return { data: await encodeCanvas(canvas, ext) }
}

async function encodeCanvas(canvas: HTMLCanvasElement, ext: WatermarkImageExt): Promise<Uint8Array> {
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, ext === 'png' ? undefined : 0.92))
    if (!blob) throw new Error('图片编码失败')
    return new Uint8Array(await blob.arrayBuffer())
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 初始化失败')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return ext === 'bmp' ? encodeBmp(imageData) : encodeGif(imageData)
}

// 渲染透明水印 PNG（视频覆盖层用；预览也可复用 drawWatermarkOn）
export async function renderWatermarkPng(
  width: number,
  height: number,
  config: WatermarkConfig
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 初始化失败')
  drawWatermarkOn(ctx, width, height, config)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('水印 PNG 生成失败')
  return new Uint8Array(await blob.arrayBuffer())
}

// —— BMP 编码（未压缩 24 位，自下而上）——
function writeU16(a: Uint8Array, off: number, v: number): void {
  a[off] = v & 0xff
  a[off + 1] = (v >> 8) & 0xff
}

function writeU32(a: Uint8Array, off: number, v: number): void {
  a[off] = v & 0xff
  a[off + 1] = (v >> 8) & 0xff
  a[off + 2] = (v >> 16) & 0xff
  a[off + 3] = (v >>> 24) & 0xff
}

export function encodeBmp(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelSize = rowSize * height
  const fileSize = 54 + pixelSize
  const out = new Uint8Array(fileSize)

  // BITMAPFILEHEADER（14 字节）
  out[0] = 0x42
  out[1] = 0x4d // 'BM'
  writeU32(out, 2, fileSize)
  writeU32(out, 10, 54) // 像素数据偏移

  // BITMAPINFOHEADER（40 字节）
  writeU32(out, 14, 40)
  writeU32(out, 18, width >>> 0)
  writeU32(out, 22, height >>> 0) // 正数 → 自下而上
  writeU16(out, 26, 1) // planes
  writeU16(out, 28, 24) // 每像素位数
  writeU32(out, 30, 0) // BI_RGB（未压缩）
  writeU32(out, 34, pixelSize)
  writeU32(out, 38, 2835) // ppmX ≈ 72dpi
  writeU32(out, 42, 2835) // ppmY

  // 像素：自下而上逐行，BGR 序，每行按 rowSize 对齐
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y
    const dstRow = 54 + y * rowSize
    for (let x = 0; x < width; x++) {
      const si = (srcRow * width + x) * 4
      const di = dstRow + x * 3
      out[di] = data[si + 2] // B
      out[di + 1] = data[si + 1] // G
      out[di + 2] = data[si] // R
    }
  }
  return out
}

// —— GIF 编码（静态帧；调用方已保证画到白底，无透明区域）——
export function encodeGif(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData
  const palette = quantize(data, 256)
  const index = applyPalette(data, palette)
  const gif = GIFEncoder()
  gif.writeFrame(index, width, height, { palette, delay: 0 })
  gif.finish()
  return gif.bytes()
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 通过（`gifenc` 类型解析正常；若 `gifenc` 无内置类型，在 `src/renderer/src/env.d.ts` 顶部追加 `declare module 'gifenc'` 的宽松声明并记录，但优先确认包自带类型）。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/utils/watermarkRenderer.ts
git commit -m "feat(watermark): 渲染层图像处理工具（canvas 水印 + BMP/GIF 自编码 + 透明水印 PNG）"
```

---

### Task 8: watermarkStore（zustand）

**Files:**
- Create: `src/renderer/src/stores/watermarkStore.ts`

**Interfaces:**
- Consumes: Task 3 类型、Task 6 `window.api.watermark`、Task 7 `watermarkImageBytes` / `renderWatermarkPng`、Task 1 `DEFAULT_WATERMARK_CONFIG`。
- Produces:
  - `export type WatermarkFileType = 'image' | 'pdf' | 'video'`
  - `export interface WatermarkQueueItem { path: string; name: string; type: WatermarkFileType; status: 'pending' | 'processing' | 'done' | 'failed'; outputPath?: string; error?: string }`
  - `useWatermarkStore`：`config` / `queue` / `processing` / `videoProgress` / `error` + `setConfig` / `addFiles` / `removeItem` / `clearQueue` / `run` / `cancelVideo`

- [ ] **Step 1: 创建 `src/renderer/src/stores/watermarkStore.ts`**

```ts
import { create } from 'zustand'
import { DEFAULT_WATERMARK_CONFIG } from '@shared/watermark'
import type { WatermarkConfig } from '@shared/watermark'
import type { WatermarkFileType } from '@shared/types'
import { renderWatermarkPng, watermarkImageBytes } from '@renderer/utils/watermarkRenderer'
import type { WatermarkImageExt } from '@renderer/utils/watermarkRenderer'

export interface WatermarkQueueItem {
  path: string
  name: string
  type: WatermarkFileType
  status: 'pending' | 'processing' | 'done' | 'failed'
  outputPath?: string
  error?: string
}

interface WatermarkState {
  config: WatermarkConfig
  queue: WatermarkQueueItem[]
  processing: boolean
  videoProgress: number | null
  error: string | null
  setConfig: (patch: Partial<WatermarkConfig>) => void
  addFiles: (type: WatermarkFileType) => Promise<void>
  removeItem: (path: string) => void
  clearQueue: () => void
  run: () => Promise<void>
  cancelVideo: () => void
}

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : ''
}

export const useWatermarkStore = create<WatermarkState>((set, get) => ({
  config: { ...DEFAULT_WATERMARK_CONFIG },
  queue: [],
  processing: false,
  videoProgress: null,
  error: null,

  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),

  addFiles: async (type) => {
    const r = await window.api.watermark.pickFiles(type)
    if (!r.ok || !r.data) return
    const items: WatermarkQueueItem[] = r.data.map((p) => ({
      path: p,
      name: p.split(/[\\/]/).pop() ?? p,
      type,
      status: 'pending'
    }))
    set((s) => ({ queue: [...s.queue, ...items] }))
  },

  removeItem: (path) => set((s) => ({ queue: s.queue.filter((q) => q.path !== path) })),

  clearQueue: () => set({ queue: [] }),

  cancelVideo: () => {
    set({ videoProgress: null })
    window.api.watermark.cancelVideo()
  },

  run: async () => {
    const { queue, config } = get()
    const items = queue.filter((i) => i.status === 'pending')
    if (items.length === 0 || get().processing) return
    set({ processing: true, error: null, videoProgress: null })

    const unsubVideo = window.api.watermark.onVideoProgress((p) => set({ videoProgress: p.percent }))
    try {
      for (const item of items) {
        set((s) => ({
          queue: s.queue.map((q) => (q.path === item.path ? { ...q, status: 'processing' as const, error: undefined } : q))
        }))
        try {
          const outputPath = await processItem(item, config)
          set((s) => ({
            queue: s.queue.map((q) => (q.path === item.path ? { ...q, status: 'done' as const, outputPath } : q))
          }))
        } catch (e) {
          const msg = e instanceof Error ? e.message : '未知错误'
          set((s) => ({
            queue: s.queue.map((q) => (q.path === item.path ? { ...q, status: 'failed' as const, error: msg } : q))
          }))
        }
      }
    } finally {
      unsubVideo()
      set({ processing: false, videoProgress: null })
    }
  }
}))

async function processItem(item: WatermarkQueueItem, config: WatermarkConfig): Promise<string> {
  if (item.type === 'pdf') {
    const r = await window.api.watermark.applyPdf({ filePath: item.path, config })
    if (!r.ok) throw new Error(r.error.message)
    return r.data.outputPath
  }
  if (item.type === 'video') {
    const info = await window.api.watermark.getVideoInfo(item.path)
    if (!info.ok) throw new Error(info.error.message)
    const png = await renderWatermarkPng(info.data.width, info.data.height, config)
    const r = await window.api.watermark.applyVideo({ filePath: item.path, config, watermarkPng: png })
    if (!r.ok) throw new Error(r.error.message)
    return r.data.outputPath
  }
  // image：读字节 → 渲染层合成 → 写新文件（保持原格式）
  const read = await window.api.watermark.readBinary(item.path)
  if (!read.ok) throw new Error(read.error.message)
  const ext = extOf(item.path) as WatermarkImageExt
  const out = await watermarkImageBytes(read.data, config, ext)
  const write = await window.api.watermark.writeFile({ sourcePath: item.path, data: out.data })
  if (!write.ok) throw new Error(write.error.message)
  return write.data.outputPath
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 3: 提交**

```bash
git add src/renderer/src/stores/watermarkStore.ts
git commit -m "feat(watermark): watermarkStore（配置/队列/批量与视频进度）"
```

---

### Task 9: UI 页面 + 导航接入

**Files:**
- Create: `src/renderer/src/pages/Watermark/WatermarkPage.tsx`
- Create: `src/renderer/src/pages/Watermark/WatermarkConfigForm.tsx`
- Create: `src/renderer/src/pages/Watermark/WatermarkPreview.tsx`
- Create: `src/renderer/src/pages/Watermark/WatermarkQueue.tsx`
- Create: `src/renderer/src/pages/Watermark/WatermarkPage.module.css`
- Create: `src/renderer/src/pages/Watermark/WatermarkConfigForm.module.css`
- Create: `src/renderer/src/pages/Watermark/WatermarkPreview.module.css`
- Create: `src/renderer/src/pages/Watermark/WatermarkQueue.module.css`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/layout/SideNav.tsx`

**Interfaces:**
- Consumes: Task 8 `useWatermarkStore`、Task 7 `drawWatermarkOn`。

- [ ] **Step 1: 创建 `src/renderer/src/pages/Watermark/WatermarkPage.tsx`**

```tsx
import { WatermarkConfigForm } from './WatermarkConfigForm'
import { WatermarkPreview } from './WatermarkPreview'
import { WatermarkQueue } from './WatermarkQueue'
import styles from './WatermarkPage.module.css'

export function WatermarkPage(): JSX.Element {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>水印保护</h1>
      <div className={styles.grid}>
        <div className={styles.left}>
          <WatermarkConfigForm />
          <WatermarkPreview />
        </div>
        <div className={styles.right}>
          <WatermarkQueue />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建 `src/renderer/src/pages/Watermark/WatermarkConfigForm.tsx`**

```tsx
import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import styles from './WatermarkConfigForm.module.css'

const FONTS = ['Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'Arial', 'Georgia']
const LAYOUTS: { value: string; label: string }[] = [
  { value: 'single', label: '单行' },
  { value: 'multi2', label: '一页两行' },
  { value: 'multi3', label: '一页三行' },
  { value: 'multi6', label: '一页六行' },
  { value: 'multi8', label: '一页八行' }
]
const POSITIONS: { value: string; x: string; y: string }[] = [
  { value: 'top-left', x: '0%', y: '0%' },
  { value: 'top-center', x: '50%', y: '0%' },
  { value: 'top-right', x: '100%', y: '0%' },
  { value: 'center-left', x: '0%', y: '50%' },
  { value: 'center', x: '50%', y: '50%' },
  { value: 'center-right', x: '100%', y: '50%' },
  { value: 'bottom-left', x: '0%', y: '100%' },
  { value: 'bottom-center', x: '50%', y: '100%' },
  { value: 'bottom-right', x: '100%', y: '100%' }
]

export function WatermarkConfigForm(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const setConfig = useWatermarkStore((s) => s.setConfig)
  const single = config.layout === 'single'

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>水印文本</span>
        <input
          type="text"
          value={config.text}
          maxLength={200}
          onChange={(e) => setConfig({ text: e.target.value })}
        />
      </label>

      <label className={styles.field}>
        <span>字体</span>
        <select value={config.fontFamily} onChange={(e) => setConfig({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.row}>
        <label className={styles.field}>
          <span>字号</span>
          <input
            type="number"
            min={1}
            max={500}
            value={config.fontSize}
            onChange={(e) => setConfig({ fontSize: Number(e.target.value) || 1 })}
          />
        </label>
        <label className={styles.field}>
          <span>不透明度</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={config.opacity}
            onChange={(e) => setConfig({ opacity: Number(e.target.value) })}
          />
          <em>{config.opacity.toFixed(2)}</em>
        </label>
        <label className={styles.field}>
          <span>旋转角度</span>
          <input
            type="number"
            min={-90}
            max={90}
            value={config.rotation}
            onChange={(e) => setConfig({ rotation: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className={styles.field}>
        <span>布局</span>
        <div className={styles.radios}>
          {LAYOUTS.map((l) => (
            <button
              key={l.value}
              type="button"
              className={`${styles.radio}${config.layout === l.value ? ` ${styles.active}` : ''}`}
              onClick={() => setConfig({ layout: l.value as never })}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.field}${single ? '' : ` ${styles.disabled}`}`}>
        <span>文本位置{!single ? '（仅单行生效）' : ''}</span>
        <div className={styles.grid9}>
          {POSITIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-label={p.value}
              disabled={!single}
              className={`${styles.dot}${config.position === p.value ? ` ${styles.dotActive}` : ''}`}
              onClick={() => setConfig({ position: p.value as never })}
            />
          ))}
        </div>
      </div>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={config.applyToAllPages}
          onChange={(e) => setConfig({ applyToAllPages: e.target.checked })}
        />
        应用于全部页面（仅 PDF 生效）
      </label>
    </div>
  )
}
```

- [ ] **Step 3: 创建 `src/renderer/src/pages/Watermark/WatermarkPreview.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import { drawWatermarkOn } from '@renderer/utils/watermarkRenderer'
import styles from './WatermarkPreview.module.css'

export function WatermarkPreview(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#f5f5f5'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    drawWatermarkOn(ctx, canvas.width, canvas.height, config)
  }, [config])

  return (
    <div className={styles.preview}>
      <h3 className={styles.title}>水印效果预览</h3>
      <canvas ref={canvasRef} width={360} height={200} className={styles.canvas} />
    </div>
  )
}
```

- [ ] **Step 4: 创建 `src/renderer/src/pages/Watermark/WatermarkQueue.tsx`**

```tsx
import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import styles from './WatermarkQueue.module.css'

const TYPE_LABEL: Record<string, string> = { image: '图片', pdf: 'PDF', video: '视频' }
const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  done: '完成',
  failed: '失败'
}

export function WatermarkQueue(): JSX.Element {
  const queue = useWatermarkStore((s) => s.queue)
  const processing = useWatermarkStore((s) => s.processing)
  const videoProgress = useWatermarkStore((s) => s.videoProgress)
  const error = useWatermarkStore((s) => s.error)
  const addFiles = useWatermarkStore((s) => s.addFiles)
  const removeItem = useWatermarkStore((s) => s.removeItem)
  const clearQueue = useWatermarkStore((s) => s.clearQueue)
  const run = useWatermarkStore((s) => s.run)
  const cancelVideo = useWatermarkStore((s) => s.cancelVideo)

  const done = queue.filter((q) => q.status === 'done').length
  const failed = queue.filter((q) => q.status === 'failed').length

  return (
    <div className={styles.queue}>
      <div className={styles.actions}>
        <button type="button" onClick={() => void addFiles('image')}>
          选择图片
        </button>
        <button type="button" onClick={() => void addFiles('pdf')}>
          选择 PDF
        </button>
        <button type="button" onClick={() => void addFiles('video')}>
          选择视频
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>文件名</th>
            <th>类型</th>
            <th>状态</th>
            <th>输出</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {queue.map((item) => (
            <tr key={item.path}>
              <td className={styles.name}>{item.name}</td>
              <td>{TYPE_LABEL[item.type]}</td>
              <td>{STATUS_LABEL[item.status]}</td>
              <td className={styles.out}>
                {item.outputPath ?? item.error ?? ''}
              </td>
              <td>
                <button
                  type="button"
                  className={styles.remove}
                  disabled={processing}
                  onClick={() => removeItem(item.path)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {queue.length === 0 && (
            <tr>
              <td colSpan={5} className={styles.empty}>
                尚未选择文件（图片 / PDF 可批量，视频单文件）
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className={styles.footer}>
        <span>
          共 {queue.length} 个 · 完成 {done} · 失败 {failed}
        </span>
        <button type="button" disabled={processing || queue.length === 0} onClick={() => void run()}>
          {processing ? '处理中…' : '开始处理'}
        </button>
        <button type="button" disabled={!processing} onClick={cancelVideo}>
          取消视频
        </button>
        <button type="button" disabled={processing || queue.length === 0} onClick={clearQueue}>
          清空
        </button>
      </div>

      {videoProgress !== null && (
        <div className={styles.progress}>
          <div className={styles.bar} style={{ width: `${videoProgress}%` }} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: 创建四个 CSS Module 文件**

`WatermarkPage.module.css`：

```css
.page {
  padding: 20px;
}
.title {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 16px;
}
.grid {
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 20px;
  align-items: start;
}
.left {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.right {
  min-width: 0;
}
```

`WatermarkConfigForm.module.css`：

```css
.form {
  background: var(--surface, #fff);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #374151;
}
.field input[type='text'],
.field select,
.field input[type='number'] {
  padding: 6px 8px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1.4fr 1fr;
  gap: 10px;
}
.row input[type='range'] {
  width: 100%;
}
.row em {
  font-style: normal;
  color: #6b7280;
}
.radios {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.radio {
  padding: 4px 10px;
  border: 1px solid #d1d5db;
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
}
.radio.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}
.grid9 {
  position: relative;
  height: 64px;
}
.dot {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #d1d5db;
  background: #fff;
  transform: translate(-50%, -50%);
  cursor: pointer;
}
.dot:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.dotActive {
  background: #2563eb;
  border-color: #2563eb;
}
.disabled {
  opacity: 0.6;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #374151;
}
```

`WatermarkPreview.module.css`：

```css
.preview {
  background: var(--surface, #fff);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
}
.title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 10px;
}
.canvas {
  width: 100%;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  display: block;
}
```

`WatermarkQueue.module.css`：

```css
.queue {
  background: var(--surface, #fff);
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.actions {
  display: flex;
  gap: 8px;
}
.actions button,
.footer button {
  padding: 6px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.actions button:hover,
.footer button:hover {
  background: #f3f4f6;
}
.error {
  color: #dc2626;
  font-size: 13px;
  margin: 0;
}
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th,
.table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid #f0f0f0;
}
.table th {
  color: #6b7280;
  font-weight: 500;
}
.name {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.out {
  color: #6b7280;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remove {
  border: none;
  background: none;
  cursor: pointer;
  color: #9ca3af;
}
.empty {
  text-align: center;
  color: #9ca3af;
  padding: 24px 0;
}
.footer {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #6b7280;
}
.footer button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.progress {
  height: 6px;
  background: #f3f4f6;
  border-radius: 999px;
  overflow: hidden;
}
.bar {
  height: 100%;
  background: #2563eb;
  transition: width 0.2s;
}
```

- [ ] **Step 6: `SideNav.tsx` 增加「水印」**

`PageId` 改为：

```ts
export type PageId = 'system' | 'files' | 'adblock' | 'resume' | 'diagram' | 'watermark' | 'settings'
```

`NAV_ITEMS` 在「图表」后插入：

```ts
  { id: 'diagram', label: '图表' },
  { id: 'watermark', label: '水印' },
  { id: 'settings', label: '设置' }
```

- [ ] **Step 7: `App.tsx` 增加分支**

import 区加：

```tsx
import { WatermarkPage } from './pages/Watermark/WatermarkPage'
```

条件分支在 diagram 与 settings 之间插入：

```tsx
        ) : page === 'diagram' ? (
          <DiagramGeneratorPage />
        ) : page === 'watermark' ? (
          <WatermarkPage />
        ) : (
          <SettingsPage />
        )}
```

- [ ] **Step 8: 类型检查**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 9: 提交**

```bash
git add src/renderer/src/pages/Watermark src/renderer/src/App.tsx src/renderer/src/components/layout/SideNav.tsx
git commit -m "feat(watermark): 水印保护页面（配置表单/预览/文件队列）+ 导航接入"
```

---

### Task 10: 端到端验证 + 文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-08-30-watermark-design.md`（IPC 表移除 `watermark:batchProgress` 行——渲染层队列为本地跟踪，无主进程批量事件）
- Modify: `docs/API_SPEC.md`（新增 watermark 域接口表，与 Task 5 一致）
- Create: `docs/modules/watermark.md`
- Modify: `README.md`（功能概览表加「水印」行）
- Modify: `docs/ARCHITECTURE.md`（模块清单/架构图补 watermark）

**Interfaces:**
- Consumes: 前述全部任务。

- [ ] **Step 1: 手工端到端验证**

Run: `npm run dev`

逐项验证：
1. **图片批量**：选择 2–3 张 png/jpg/gif/bmp 各一张 → 配置单行 + 九宫格位置 + 旋转 → 开始处理 → 输出 `原名.水印.<同扩展名>`，原图不动，水印位置/角度正确。
2. **图片多行**：布局切「一页三行 / 一页六行 / 一页八行」→ 处理后打开输出，斜线带数量正确（3/6/8 条），不透明度生效。
3. **格式保持**：`.jpg` 输入 → `.jpg` 输出；`.jpeg` → `.jpeg`；`.bmp` → `.bmp`（可被 Windows 照片查看器打开）；`.gif` → `.gif`（静态，白底 + 水印）。
4. **PDF**：多页 PDF → 勾选「应用于全部页面」→ 每页都有水印；取消勾选 → 仅首页有水印；中文水印正常显示（嵌入字体）。
5. **视频**：选一个 mp4 → 处理 → 进度条推进 → 输出同扩展名新文件，水印叠加正确、音频保留；处理中可点「取消视频」。
6. **输出冲突**：同一文件跑两次 → 第二次输出 `原名.水印(1).ext`。

- [ ] **Step 2: 更新规格文档（IPC 表删 batchProgress）**

`docs/superpowers/specs/2026-08-30-watermark-design.md` §4 表格删除：

```markdown
| `watermark:batchProgress` | main→renderer | `{ current, total, status }` | — | 批量进度事件 |
```

并在 §2 决策表追加一行说明批量进度改为渲染层本地跟踪：

```markdown
| 11 | 批量进度 | **渲染层本地跟踪**（图片在渲染层处理、PDF 即时完成，均无需主进程批量进度事件）；仅视频有 `watermark:videoProgress` 主进程进度 |
```

- [ ] **Step 3: `docs/API_SPEC.md` 增加 watermark 域接口表**

在文档对应位置（参考既有 `file`/`adblock` 域章节格式）新增 §watermark，内容与 Task 5 IPC 一致：

```markdown
## watermark（水印保护）

| 通道 | 方向 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| `watermark:pickFiles` | renderer→main | `type: 'image'\|'pdf'\|'video'` | `string[] \| null` | 文件选择（按类型过滤扩展名，图片仅 png/jpg/jpeg/webp/bmp/gif） |
| `watermark:readBinary` | renderer→main | `path` | `Uint8Array` | 读图片字节 |
| `watermark:writeFile` | renderer→main | `{ sourcePath, data }` | `{ outputPath }` | 输出 `原名.水印.ext`（冲突加序号） |
| `watermark:applyPdf` | renderer→main | `{ filePath, config }` | `{ outputPath }` | pdf-lib 加 PDF 水印（嵌入系统 CJK 字体） |
| `watermark:getVideoInfo` | renderer→main | `path` | `{ width, height, durationMs }` | ffmpeg 探测视频信息 |
| `watermark:applyVideo` | renderer→main | `{ filePath, config, watermarkPng }` | `{ outputPath }` | ffmpeg overlay；事件 `watermark:videoProgress` `{ percent }` |
| `watermark:cancelVideo` | renderer→main | — | — | 取消当前视频任务（kill 子进程） |
```

- [ ] **Step 4: 创建 `docs/modules/watermark.md`**

```markdown
# 模块设计：水印保护（watermark）

对应需求 6：给图片、PDF、视频添加可定制的防伪文字水印。

## 1. 需求

- 可定制：水印文本、字体、字号、不透明度、旋转角度、布局（单行 / 一页两行/三行/六行/八行）、文本位置（单行）、是否应用于全部页面（PDF）。
- 图片 / PDF 批量；视频单文件。
- 输出另存为 `原名.水印.ext`，**保持原格式**（`.jpg`→`.jpg`、`.jpeg`→`.jpeg` 逐字一致）。

## 2. 设计

- 布局算法单一真相源：`src/shared/watermark.ts` 的 `computeWatermarkPlacements`（canvas / pdf-lib / 视频水印 PNG 共用）。
- 图片：渲染层 canvas 管线（`src/renderer/src/utils/watermarkRenderer.ts`），png/jpg/jpeg/webp 用 `toBlob`，bmp 手写编码器，gif 用 `gifenc` 输出静态帧。
- PDF：主进程 `pdf-lib`，嵌入系统 CJK 字体（simhei→msyh→simsun 候选），`applyToAllPages` 控制全部页 / 仅首页。
- 视频：主进程 ffmpeg，透明水印 PNG 覆盖层 + overlay，音频 `-c:a copy`，进度按 `time=` 解析。

## 3. IPC 接口

见 `API_SPEC.md` §watermark：`pickFiles` / `readBinary` / `writeFile` / `applyPdf` / `getVideoInfo` / `applyVideo` / `cancelVideo`。

## 4. 数据

无持久化（不建表）；会话内队列存于 `watermarkStore`。

## 5. UI

页面 `pages/Watermark/`：`WatermarkPage` + `WatermarkConfigForm` / `WatermarkPreview` / `WatermarkQueue`。

## 6. 关键实现要点

- 输出路径 `watermarkOutputPath` 主进程统一去重（`原名.水印(1).ext`）。
- 水印颜色固定 `#808080`；透明度 0.05–1；旋转 -90~90。
- 视频覆盖层 PNG 由渲染层按视频分辨率生成（`renderWatermarkPng`），与图片管线共用 `drawWatermarkOn`。
- ffmpeg 依赖 `ffmpeg-static`，打包时 `asarUnpack: node_modules/ffmpeg-static/**`。

## 7. 验收标准

- [x] 图片批量加水印，输出保持原格式，单行 / 多行布局正确。
- [x] PDF 多页水印，`applyToAllPages` 生效，中文正常。
- [x] 视频水印叠加正确、音频保留、进度可取消。
- [x] `npm run typecheck` 通过。
```

（`[x]` 勾选仅当 Step 1 手工验证通过；未通过则保留 `[ ]` 并注明问题。）

- [ ] **Step 5: `README.md` 功能概览表加「水印」行**

表格「图表生成」行后插入：

```markdown
| 水印保护 | 给图片 / PDF / 视频添加可定制防伪水印（批量，保持原格式输出） | `Watermark` |
```

- [ ] **Step 6: `docs/ARCHITECTURE.md` 补 watermark**

- 架构图 services 行 `system / file / adblock / resume / diagram` → `system / file / adblock / resume / diagram / watermark`。
- 模块清单补：`watermark` —— 图片 canvas（渲染层）/ PDF pdf-lib / 视频 ffmpeg。

- [ ] **Step 7: 类型检查 + 提交**

Run: `npm run typecheck`
Expected: 通过。
```bash
git add docs/superpowers/specs/2026-08-30-watermark-design.md docs/API_SPEC.md docs/modules/watermark.md README.md docs/ARCHITECTURE.md
git commit -m "docs(watermark): API_SPEC/模块文档/README/架构图同步 + 规格批量进度口径修订"
```

---

## Self-Review 记录

**1. 规格覆盖**：需求 6 全部可定制项（文本/字体/字号/不透明度/旋转/单行与一页N行/位置/全部页面）→ Task 9 表单 + Task 1 布局；6.1 图片 → Task 7 + 保持原格式（jpg/jpeg 逐字一致）；6.1 PDF → Task 4；6.2 视频 → Task 4 + Task 7（水印 PNG）+ Task 8 单文件逻辑；批量 → Task 8/9；另存新文件 → Task 4 `watermarkOutputPath`。全数覆盖。

**2. 占位符扫描**：无 TBD/TODO；每个代码步骤含完整实现。

**3. 类型一致性**：`computeWatermarkPlacements`、`WatermarkConfig`、`WatermarkApi`、`watermarkOutputPath`、`renderWatermarkPng`、`watermarkImageBytes` 在各任务中的签名一致；`WindowApi.watermark` 于 Task 3 定义、Task 6 实现、Task 8 消费。

**4. 已知偏差（Task 10 文档任务已同步）**：规格 IPC 表中的 `watermark:batchProgress` 在实现中不需要（图片渲染层处理、PDF 即时完成，队列进度由渲染层本地跟踪），仅视频保留 `watermark:videoProgress`。
