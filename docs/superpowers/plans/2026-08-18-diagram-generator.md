# 阶段 6 · 图表生成模块 + 收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 资料 → 结构抽取 → 受限 Mermaid 生成与渲染（思维导图 / 流程图 / 审批流），图表页面可用；收尾用 electron-builder 打包为 Windows 安装包并更新文档与技能。

**Architecture:** 与阶段 5 同构的 3 层：主进程 `diagram.service`（AI 优先 + 本地兜底，永不 reject）+ `diagram.ipc`；共享层 `src/shared/mermaid.ts` 是受限 Mermaid 语法解析器唯一真相源（主进程校验 + 渲染层布局共用）；渲染层 `MermaidPreview` 自研解析+布局+SVG（零库），`MermaidCodeView` 展示源码。收尾加 electron-builder。

**Tech Stack:** Electron 36（contextIsolation、node:sqlite）、React 18、zustand、TypeScript strict、electron-builder（devDependency）。

## Global Constraints

- **受限语法单一真相源**：`src/shared/mermaid.ts` 只支持 `mindmap`（缩进树）与 `flowchart TD/LR`（`A[文本]` / `A{文本}` / `A((文本))` 声明 + `A-->B` / `A--标签-->B` 边）。`validateMermaid`（主进程）与 `MermaidPreview`（渲染层）共用同一 `parseMermaid`。
- **`diagram:generate` 永不 reject**：AI 四码（`AI_NOT_CONFIGURED`/`AI_TIMEOUT`/`AI_API_ERROR`/`AI_UNAVAILABLE`）+ `validateMermaid` 失败全部 catch → `localGenerate` 兜底，返回 `{ type, mermaid, source: 'ai' | 'local' }`。
- **`source` 字段**：`DiagramResult` 含 `source: 'ai' | 'local'`（UI 展示「AI 生成 / 本地模板」角标，镜像阶段 5 `OptimizeResult`）。
- **类型判定**：`type` 缺省 → `classifyType(source)`；给定 → 校验取值（下拉=手动覆盖，「自动」= 不传 `type`）。
- **TypeScript strict，无 `any`，无新运行时依赖**。`npm run typecheck`（typecheck:node + typecheck:web）为验证门。无测试框架。
- **Electron 安全**：contextIsolation:true / nodeIntegration:false；渲染层零 Node 权限；IPC 走 contextBridge + invoke。
- **受限语法校验在返回前完成**：渲染层拿到的 `mermaid` 必然合规；解析失败只是防御性兜底提示 + 源码仍可复制。
- **electron-builder 为 devDependency**（打包工具，非运行时依赖；已获用户批准）。产出 Windows 安装包。
- **不做 diagrams 历史表**（YAGNI，用户已确认）。
- 直接提交到 `main`；commit message 以 `Co-Authored-By: Claude <noreply@anthropic.com>` 结尾。
- 文档统一中文，沿用既有 tokens（`--space-1..4` / `--color-*` / `--radius` / `--radius-sm`，无 `--radius-md`）。

---

### Task 1: 共享契约 — Diagram 类型 + 受限 Mermaid 解析器 + preload 桥接

**Files:**
- Modify: `src/shared/types.ts`（在 `ResumeApi` 之后、`WindowApi` 之前插入 diagram 域类型；`WindowApi` 加 `diagram`）
- Create: `src/shared/mermaid.ts`
- Modify: `src/preload/index.ts`（加 `diagram` 域 + 导入 `DiagramResult`）

**Interfaces:**
- Consumes: 现有 `IpcResult<T>`、`WindowApi`（preload 用 `const api: WindowApi` 实现）。
- Produces（后续任务依赖）:
  ```ts
  type DiagramType = 'mindmap' | 'flowchart' | 'approval'
  interface DiagramRequest { source: string; type?: DiagramType }
  interface DiagramResult { type: DiagramType; mermaid: string; source: 'ai' | 'local' }
  interface DiagramApi { generate(req: DiagramRequest): Promise<IpcResult<DiagramResult>> }
  // WindowApi 增加: diagram: DiagramApi

  // src/shared/mermaid.ts
  type DiagramNodeKind = 'rect' | 'diamond' | 'circle'
  interface DiagramNode { id: string; text: string; kind: DiagramNodeKind }
  interface DiagramEdge { from: string; to: string; label?: string }
  interface MindmapTree { id: string; text: string; circle: boolean; children: MindmapTree[] }
  type ParsedMermaid =
    | { ok: true; kind: 'mindmap'; root: MindmapTree }
    | { ok: true; kind: 'flowchart'; dir: 'TD' | 'LR'; nodes: DiagramNode[]; edges: DiagramEdge[] }
    | { ok: false; reason: string }
  function parseMermaid(code: string): ParsedMermaid
  ```

- [ ] **Step 1: 加 diagram 域类型**

在 `src/shared/types.ts` 中，`ResumeApi` 接口之后（约第 299 行）、`WindowApi` 之前插入：

```ts
// —— 图表生成域（diagram）——
export type DiagramType = 'mindmap' | 'flowchart' | 'approval'

export interface DiagramRequest {
  source: string // 原始资料
  type?: DiagramType // 缺省 → 服务端自动判定；手动覆盖用
}

export interface DiagramResult {
  type: DiagramType
  mermaid: string // 受限语法 Mermaid 源码
  source: 'ai' | 'local' // 用于 UI 展示「AI 生成 / 本地模板」角标
}

export interface DiagramApi {
  generate(req: DiagramRequest): Promise<IpcResult<DiagramResult>>
}
```

在 `WindowApi` 接口中，`resume: ResumeApi` 之后加一行 `diagram: DiagramApi`：

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
}
```

- [ ] **Step 2: 创建 `src/shared/mermaid.ts`（受限语法解析器，纯 TS 无 DOM）**

```ts
// 受限 Mermaid 语法解析器 —— 唯一真相源（主进程校验 + 渲染层布局共用）
// 支持：
//   mindmap：缩进树，根 root((主题))，子节点缩进更深
//   flowchart TD|LR：节点声明 A[文本] / A{文本} / A((文本)) + 边 A-->B / A--标签-->B
export type DiagramNodeKind = 'rect' | 'diamond' | 'circle'

export interface DiagramNode {
  id: string
  text: string
  kind: DiagramNodeKind
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
}

export interface MindmapTree {
  id: string
  text: string
  circle: boolean
  children: MindmapTree[]
}

export type ParsedMermaid =
  | { ok: true; kind: 'mindmap'; root: MindmapTree }
  | { ok: true; kind: 'flowchart'; dir: 'TD' | 'LR'; nodes: DiagramNode[]; edges: DiagramEdge[] }
  | { ok: false; reason: string }

const NODE_RECT_RE = /^([A-Za-z0-9_]+)\s*\[([^\]]*)\]\s*$/
const NODE_DIAMOND_RE = /^([A-Za-z0-9_]+)\s*\{([^}]*)\}\s*$/
const NODE_CIRCLE_RE = /^([A-Za-z0-9_]+)\s*\(\(([^)]*)\)\)\s*$/
const EDGE_LABEL_RE = /^([A-Za-z0-9_]+)\s*--\s*(.+?)\s*-->\s*([A-Za-z0-9_]+)\s*$/
const EDGE_PLAIN_RE = /^([A-Za-z0-9_]+)\s*-->\s*([A-Za-z0-9_]+)\s*$/
const FLOWCHART_HEAD_RE = /^flowchart\s+(TD|LR)$/i

function firstNonEmpty(lines: string[]): number {
  return lines.findIndex((l) => l.trim() !== '')
}

function parseMindmap(lines: string[]): ParsedMermaid {
  let idc = 0
  let root: MindmapTree | null = null
  const stack: Array<{ indent: number; node: MindmapTree }> = []
  for (const raw of lines) {
    if (raw.trim() === '') continue
    const indent = raw.match(/^ */)?.[0].length ?? 0
    const trimmed = raw.trim()
    let text = trimmed
    let circle = false
    if (root === null) {
      const m = trimmed.match(/^\(\((.+)\)\)$/)
      if (m) {
        text = m[1]
        circle = true
      }
    }
    const node: MindmapTree = { id: `n${idc++}`, text, circle, children: [] }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (stack.length) {
      stack[stack.length - 1].node.children.push(node)
    } else if (root === null) {
      root = node
    } else {
      return { ok: false, reason: '存在多个同级根节点' }
    }
    stack.push({ indent, node })
  }
  if (!root) return { ok: false, reason: 'mindmap 缺少根节点' }
  return { ok: true, kind: 'mindmap', root }
}

function parseFlowchart(lines: string[], dir: 'TD' | 'LR'): ParsedMermaid {
  const nodes = new Map<string, DiagramNode>()
  const edges: DiagramEdge[] = []
  for (const raw of lines) {
    if (raw.trim() === '') continue
    const line = raw.trim()
    let m: RegExpMatchArray | null
    if ((m = line.match(NODE_RECT_RE))) {
      nodes.set(m[1], { id: m[1], text: m[2] || m[1], kind: 'rect' })
    } else if ((m = line.match(NODE_DIAMOND_RE))) {
      nodes.set(m[1], { id: m[1], text: m[2] || m[1], kind: 'diamond' })
    } else if ((m = line.match(NODE_CIRCLE_RE))) {
      nodes.set(m[1], { id: m[1], text: m[2] || m[1], kind: 'circle' })
    } else if ((m = line.match(EDGE_LABEL_RE))) {
      edges.push({ from: m[1], to: m[3], label: m[2].trim() })
    } else if ((m = line.match(EDGE_PLAIN_RE))) {
      edges.push({ from: m[1], to: m[2] })
    } else {
      return { ok: false, reason: `无法识别的行：${line}` }
    }
  }
  if (nodes.size === 0 && edges.length === 0) return { ok: false, reason: '没有节点或边' }
  for (const e of edges) {
    if (!nodes.has(e.from)) return { ok: false, reason: `边引用了未声明的节点 ${e.from}` }
    if (!nodes.has(e.to)) return { ok: false, reason: `边引用了未声明的节点 ${e.to}` }
  }
  return { ok: true, kind: 'flowchart', dir, nodes: [...nodes.values()], edges }
}

export function parseMermaid(code: string): ParsedMermaid {
  const lines = code.split(/\r?\n/)
  const idx = firstNonEmpty(lines)
  if (idx < 0) return { ok: false, reason: '空内容' }
  const header = lines[idx].trim()
  if (header === 'mindmap') return parseMindmap(lines.slice(idx + 1))
  const flow = header.match(FLOWCHART_HEAD_RE)
  if (flow) return parseFlowchart(lines.slice(idx + 1), flow[1].toUpperCase() as 'TD' | 'LR')
  return { ok: false, reason: '不支持的图表类型头' }
}
```

- [ ] **Step 3: preload 加 `diagram` 域**

在 `src/preload/index.ts` 顶部 import 列表加 `DiagramResult`（在 `from '@shared/types'` 的 import 花括号内，按字母序放到 `CpuInfo` 前）：

```ts
  DiagramResult,
```

在 `api` 对象中、`resume` 域之后加：

```ts
  diagram: {
    generate: (req) => invoke<DiagramResult>('diagram:generate', req)
  }
```

> 说明：`WindowApi` 新增必填 `diagram` 属性，preload 必须同步实现，否则 typecheck 失败——本步骤就是为此（阶段 5 Task 1 曾踩过此坑）。

- [ ] **Step 4: 验证**

Run: `npm run typecheck`
Expected: typecheck:node + typecheck:web 均通过，无错误。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/mermaid.ts src/preload/index.ts
git commit -m "feat(diagram): 图表域共享契约 + 受限 Mermaid 解析器 + preload 桥接

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 生成引擎 — diagram.service（类型判定 + AI 优先 + 本地兜底）

**Files:**
- Create: `src/main/services/diagram.service.ts`

**Interfaces:**
- Consumes: `parseMermaid`（Task 1）、`complete(prompt, schema?)`（`src/main/ai/adapter.ts`，无 schema 返回纯文本）、`AppError`、`DiagramRequest`/`DiagramResult` 类型。
- Produces（后续任务依赖）:
  ```ts
  function classifyType(source: string): DiagramType
  function localGenerate(type: DiagramType, source: string): string
  function validateMermaid(type: DiagramType, mermaid: string): boolean
  async function generate(source: string, type?: DiagramType): Promise<DiagramResult> // 永不 reject
  ```

- [ ] **Step 1: 创建 `src/main/services/diagram.service.ts`**

```ts
import type { DiagramRequest, DiagramResult } from '@shared/types'
import type { DiagramType } from '@shared/types'
import { parseMermaid } from '@shared/mermaid'
import { complete } from '../ai/adapter'

const TYPE_LABELS: Record<DiagramType, string> = {
  mindmap: '思维导图',
  flowchart: '流程图',
  approval: '审批流程图'
}

// 受限语法示例，拼进 AI prompt 约束输出
const GRAMMAR_EXAMPLE = `mindmap:
  mindmap
    root((主题))
      分支A
        子A1

flowchart:
  flowchart TD
    A[开始] --> B{是否通过?}
    B -- 是 --> C[通过处理]
    B -- 否 --> D[驳回处理]`

// 资料 → 类型判定：层级/分类 → mindmap；顺序+判断 → flowchart；多角色签核流转 → approval
export function classifyType(source: string): DiagramType {
  const lower = source.toLowerCase()
  if (/提交.*审批|审批.*提交|会签|或签|驳回|复核|经理.*审批|hr/.test(lower)) return 'approval'
  if (/步骤|流程|如果|是否|判断|通过|失败|然后|先.*再|分支|条件/.test(lower)) return 'flowchart'
  return 'mindmap'
}

// 判定解析后的 Mermaid 是否与请求类型一致（approval 渲染为 flowchart，故接受 flowchart）
export function validateMermaid(type: DiagramType, mermaid: string): boolean {
  const parsed = parseMermaid(mermaid)
  if (!parsed.ok) return false
  return type === 'approval' ? parsed.kind === 'flowchart' : parsed.kind === type
}

// Mermaid 节点文本清洗：剥离会破坏受限语法的符号
function sanitize(text: string): string {
  return text.replace(/[[\]{}()<>]/g, ' ')
}

function buildPrompt(type: DiagramType, source: string): string {
  return (
    `把下面的资料整理成${TYPE_LABELS[type]}，只输出合法的 Mermaid 源码，不要任何额外文字或代码块标记。\n` +
    `只允许使用以下受限语法：\n${GRAMMAR_EXAMPLE}\n` +
    `规则：节点必须先声明（A[文本] / A{文本} / A((文本))），边用 A --> B 或 A -- 标签 --> B，每条边引用的节点都必须已声明；不要使用其他 Mermaid 特性。\n` +
    `资料：\n${source}`
  )
}

// 本地兜底：确定性规则抽结构 + 模板拼 Mermaid，不编造
export function localGenerate(type: DiagramType, source: string): string {
  if (type === 'mindmap') {
    const lines = source.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim())
    if (!lines.length) return 'mindmap\n  root((内容))'
    const rootText = lines[0].replace(/^[\d.、\-*>\s]+/, '').trim()
    const out: string[] = ['mindmap', `  root((${sanitize(rootText)}))`]
    for (const line of lines.slice(1)) out.push(`    ${sanitize(line.replace(/^[\d.、\-*>\s]+/, '').trim())}`)
    return out.join('\n')
  }
  const sep = type === 'approval' ? /[\n；;。]+/ : /[\n；;]+/
  const steps = source.split(sep).map((s) => s.trim()).filter(Boolean)
  if (!steps.length) return type === 'approval' ? 'flowchart LR\n  S[提交]' : 'flowchart TD\n  A[内容]'
  const head = type === 'approval' ? 'flowchart LR' : 'flowchart TD'
  const out: string[] = [head]
  for (let i = 0; i < steps.length; i++) {
    const text = sanitize(steps[i])
    if (type === 'flowchart' && /如果|是否|判断|通过|失败|条件|分支/.test(steps[i])) {
      out.push(`  N${i}{${text}}`)
    } else {
      out.push(`  N${i}[${text}]`)
    }
  }
  for (let i = 0; i < steps.length - 1; i++) out.push(`  N${i} --> N${i + 1}`)
  return out.join('\n')
}

// 主进程内部接口：AI 优先，任何失败（含语法校验失败）→ 本地兜底，永不 reject
export async function generate(source: string, type?: DiagramType): Promise<DiagramResult> {
  const t: DiagramType = type ?? classifyType(source)
  try {
    const raw = await complete(buildPrompt(t, source))
    const mermaid = raw.trim()
    if (validateMermaid(t, mermaid)) return { type: t, mermaid, source: 'ai' }
    return { type: t, mermaid: localGenerate(t, source), source: 'local' }
  } catch {
    return { type: t, mermaid: localGenerate(t, source), source: 'local' }
  }
}
```

> 说明：`DiagramRequest` import 在此文件实际未使用，若 typecheck 报 unused（noUnusedLocals 未开启则不报），删除该 import 即可。

- [ ] **Step 2: 验证 typecheck**

Run: `npm run typecheck`
Expected: typecheck:node 通过（本文件仅主进程编译）。

- [ ] **Step 3: Commit**

```bash
git add src/main/services/diagram.service.ts
git commit -m "feat(diagram): 生成引擎 — 类型判定 + AI 优先 + 受限语法校验 + 本地兜底

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: IPC 接入 — diagram:generate 通道

**Files:**
- Create: `src/main/ipc/diagram.ipc.ts`
- Modify: `src/main/ipc/index.ts`

**Interfaces:**
- Consumes: `generate`（Task 2）、`AppError`、`DiagramRequest` 类型。
- Produces（后续任务依赖）: 通道 `diagram:generate`（renderer 经 `window.api.diagram.generate` 调用）。

- [ ] **Step 1: 创建 `src/main/ipc/diagram.ipc.ts`**

```ts
import { ipcMain } from 'electron'
import { AppError } from '@shared/errors'
import type { DiagramRequest } from '@shared/types'
import { generate } from '../services/diagram.service'

const TYPES: DiagramRequest['type'][] = ['mindmap', 'flowchart', 'approval']

export function registerDiagramIpc(): void {
  ipcMain.handle('diagram:generate', async (_e, req: DiagramRequest) => {
    if (typeof req !== 'object' || req === null) throw new AppError('VALIDATION_ERROR', '无效的生成参数')
    if (typeof req.source !== 'string' || req.source.trim().length === 0) {
      throw new AppError('VALIDATION_ERROR', '资料不能为空')
    }
    if (req.source.length > 8000) throw new AppError('VALIDATION_ERROR', '资料过长（上限 8000 字符）')
    if (req.type !== undefined && !TYPES.includes(req.type)) {
      throw new AppError('VALIDATION_ERROR', 'type 需为 mindmap/flowchart/approval')
    }
    return generate(req.source.trim(), req.type)
  })
}
```

- [ ] **Step 2: 注册 diagram 域**

在 `src/main/ipc/index.ts`：顶部 import 区加 `import { registerDiagramIpc } from './diagram.ipc'`（按字母序放在 `registerAiIpc` 后）；`registerIpcHandlers()` 内、`registerResumeIpc()` 之后加一行 `registerDiagramIpc()`。

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/diagram.ipc.ts src/main/ipc/index.ts
git commit -m "feat(diagram): diagram:generate IPC 通道 + 注册

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: diagramStore — 生成状态 + 透传

**Files:**
- Create: `src/renderer/src/stores/diagramStore.ts`

**Interfaces:**
- Consumes: `DiagramResult`/`DiagramType` 类型（Task 1）、`window.api.diagram.generate`（preload，Task 1）。
- Produces（后续任务依赖）:
  ```ts
  interface DiagramState {
    result: DiagramResult | null
    loading: boolean
    error: string | null
    generate: (source: string, type?: DiagramType) => Promise<IpcResult<DiagramResult>>
    clearError: () => void
  }
  const useDiagramStore: UseBoundStore<StoreApi<DiagramState>>
  ```

- [ ] **Step 1: 创建 `src/renderer/src/stores/diagramStore.ts`**

```ts
import { create } from 'zustand'
import type { DiagramResult, DiagramType, IpcResult } from '@shared/types'

interface DiagramState {
  result: DiagramResult | null
  loading: boolean
  error: string | null
  generate: (source: string, type?: DiagramType) => Promise<IpcResult<DiagramResult>>
  clearError: () => void
}

export const useDiagramStore = create<DiagramState>((set) => ({
  result: null,
  loading: false,
  error: null,

  generate: async (source, type) => {
    set({ loading: true, error: null })
    const r = await window.api.diagram.generate({ source, type })
    set({ loading: false })
    if (r.ok) set({ result: r.data })
    else set({ error: r.error.message })
    return r
  },

  clearError: () => set({ error: null })
}))
```

> 说明：store 管理 loading/error（与 `resumeStore.load` 的 loading/error 模式一致）；`generate` 透传 `window.api.diagram.generate({ source, type })`，`type` 为 `undefined` 时即「自动判定」。

- [ ] **Step 2: 验证**

Run: `npm run typecheck`
Expected: typecheck:web 通过。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/diagramStore.ts
git commit -m "feat(diagram): diagramStore（result/loading/error + generate 透传）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: MermaidPreview — 受限语法布局 + 纯 SVG 渲染（自研，零库）

**Files:**
- Create: `src/renderer/src/pages/DiagramGenerator/MermaidPreview.tsx`
- Create: `src/renderer/src/pages/DiagramGenerator/MermaidPreview.module.css`

**Interfaces:**
- Consumes: `parseMermaid` / `ParsedMermaid` / `MindmapTree` / `DiagramNode` / `DiagramEdge`（Task 1，`@shared/mermaid`）。
- Produces（后续任务依赖）: `function MermaidPreview({ code }: { code: string }): JSX.Element`。

- [ ] **Step 1: 创建 `MermaidPreview.tsx`**

```tsx
import type { DiagramEdge, DiagramNode, MindmapTree } from '@shared/mermaid'
import { parseMermaid } from '@shared/mermaid'
import styles from './MermaidPreview.module.css'

const COLUMN_W = 240 // 层 / 深度间距
const ROW_H = 52 // 行间距
const FONT = 13

const ARROW =
  '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
  '<path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker></defs>'

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function measure(text: string): { w: number; h: number } {
  const lines = text.split('\n')
  const w = Math.max(80, Math.max(...lines.map((l) => l.length * (FONT * 0.62))) + 24)
  const h = Math.max(40, lines.length * 18 + 12)
  return { w, h }
}

function nodeText(text: string, cx: number, cy: number): string {
  const lines = text.split('\n')
  const firstY = cy - ((lines.length - 1) * 14) / 2
  return lines
    .map((line, i) => `<tspan x="${cx}" y="${firstY + i * 14}">${escapeXml(line)}</tspan>`)
    .join('')
}

type Pos = { x: number; y: number; w: number; h: number }

function renderNode(node: DiagramNode, p: Pos): string {
  const cx = p.x + p.w / 2
  const cy = p.y + p.h / 2
  let shape: string
  if (node.kind === 'diamond') {
    const pts = `${cx},${p.y} ${p.x + p.w},${cy} ${cx},${p.y + p.h} ${p.x},${cy}`
    shape = `<polygon points="${pts}" fill="#fefce8" stroke="#ca8a04"/>`
  } else if (node.kind === 'circle') {
    shape = `<ellipse cx="${cx}" cy="${cy}" rx="${p.w / 2}" ry="${p.h / 2}" fill="#f0f9ff" stroke="#0284c7"/>`
  } else {
    shape = `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6" fill="#ffffff" stroke="#94a3b8"/>`
  }
  return `${shape}<text font-size="${FONT}" fill="#334155">${nodeText(node.text, cx, cy)}</text>`
}

function edgeSvg(e: DiagramEdge, pos: Map<string, Pos>, dir: 'TD' | 'LR'): string {
  const a = pos.get(e.from)
  const b = pos.get(e.to)
  if (!a || !b) return ''
  let x1: number
  let y1: number
  let x2: number
  let y2: number
  let lx: number
  let ly: number
  if (dir === 'TD') {
    x1 = a.x + a.w
    y1 = a.y + a.h / 2
    x2 = b.x
    y2 = b.y + b.h / 2
    lx = (x1 + x2) / 2
    ly = y1 - 6
  } else {
    x1 = a.x + a.w / 2
    y1 = a.y + a.h
    x2 = b.x + b.w / 2
    y2 = b.y
    lx = x1 + 6
    ly = (y1 + y2) / 2
  }
  const label = e.label
    ? `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="12" fill="#64748b">${escapeXml(e.label)}</text>`
    : ''
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" marker-end="url(#arrow)"/>${label}`
}

function layoutFlowchart(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  dir: 'TD' | 'LR'
): { parts: string[]; width: number; height: number } {
  // 最长路径分层：循环回边容忍（最多迭代 nodes.length 次）
  const layer = new Map<string, number>()
  for (const n of nodes) layer.set(n.id, 0)
  for (let i = 0; i < nodes.length; i++) {
    for (const e of edges) {
      const from = layer.get(e.from) ?? 0
      const to = layer.get(e.to) ?? 0
      if (from + 1 > to) layer.set(e.to, from + 1)
    }
  }
  const byLayer = new Map<number, string[]>()
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0
    const arr = byLayer.get(l) ?? []
    arr.push(n.id)
    byLayer.set(l, arr)
  }
  const size = new Map<string, { w: number; h: number }>()
  for (const n of nodes) size.set(n.id, measure(n.text))
  const pos = new Map<string, Pos>()
  let maxX = 0
  let maxY = 0
  byLayer.forEach((ids, l) => {
    ids.forEach((id, i) => {
      const s = size.get(id) ?? { w: 80, h: 40 }
      const x = dir === 'TD' ? l * COLUMN_W : i * (COLUMN_W + 40)
      const y = dir === 'TD' ? i * ROW_H : l * ROW_H
      pos.set(id, { x, y, w: s.w, h: s.h })
      maxX = Math.max(maxX, x + s.w)
      maxY = Math.max(maxY, y + s.h)
    })
  })
  const parts: string[] = []
  for (const n of nodes) {
    const p = pos.get(n.id)
    if (p) parts.push(renderNode(n, p))
  }
  for (const e of edges) parts.push(edgeSvg(e, pos, dir))
  return { parts, width: maxX + 20, height: maxY + 20 }
}

type MindPos = { x: number; y: number; w: number; h: number; circle: boolean; text: string }

function layoutMindmap(root: MindmapTree): { parts: string[]; width: number; height: number } {
  let order = 0
  const positions: MindPos[] = []
  const parentLinks: Array<{ from: number; to: number }> = []
  const walk = (node: MindmapTree, depth: number, parentIndex: number | null): void => {
    const index = order++
    const s = measure(node.text)
    const w = node.circle ? 64 : s.w
    const h = node.circle ? 64 : s.h
    positions.push({ x: depth * COLUMN_W, y: index * ROW_H, w, h, circle: node.circle, text: node.text })
    if (parentIndex !== null) parentLinks.push({ from: parentIndex, to: index })
    for (const c of node.children) walk(c, depth + 1, index)
  }
  walk(root, 0, null)
  const parts: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    const cx = p.x + p.w / 2
    const cy = p.y + p.h / 2
    const shape = p.circle
      ? `<ellipse cx="${cx}" cy="${cy}" rx="${p.w / 2}" ry="${p.h / 2}" fill="#f0f9ff" stroke="#0284c7"/>`
      : `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6" fill="#ffffff" stroke="#94a3b8"/>`
    parts.push(`${shape}<text font-size="${FONT}" fill="#334155">${nodeText(p.text, cx, cy)}</text>`)
  }
  for (const link of parentLinks) {
    const a = positions[link.from]
    const b = positions[link.to]
    if (!a || !b) continue
    const x1 = a.x + a.w
    const y1 = a.y + a.h / 2
    const x2 = b.x
    const y2 = b.y + b.h / 2
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8"/>`)
  }
  const width = positions.reduce((m, p) => Math.max(m, p.x + p.w), 0) + 20
  const height = positions.reduce((m, p) => Math.max(m, p.y + p.h), 0) + 20
  return { parts, width, height }
}

export function MermaidPreview({ code }: { code: string }): JSX.Element {
  const parsed = parseMermaid(code)
  if (!parsed.ok) {
    return <div className={styles.fallback}>暂不支持此图表语法：{parsed.reason}</div>
  }
  const { parts, width, height } =
    parsed.kind === 'mindmap' ? layoutMindmap(parsed.root) : layoutFlowchart(parsed.nodes, parsed.edges, parsed.dir)
  return (
    <div className={styles.preview}>
      <svg
        width={width}
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        dangerouslySetInnerHTML={{ __html: ARROW + parts.join('') }}
      />
    </div>
  )
}
```

- [ ] **Step 2: 创建 `MermaidPreview.module.css`**

```css
.preview {
  overflow: auto;
  max-width: 100%;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  padding: var(--space-3);
}
.fallback {
  padding: var(--space-3);
  font-size: 13px;
  color: var(--color-text-muted);
}
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: typecheck:web 通过（shared/mermaid 同时被 web 编译，已含）。

> 若需人工冒烟：`npm run dev` 后在浏览器里不依赖本任务即可（组件尚未挂载），本任务验证以 typecheck 为准；完整渲染由 Task 6 挂载后人工验收。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/DiagramGenerator/MermaidPreview.tsx src/renderer/src/pages/DiagramGenerator/MermaidPreview.module.css
git commit -m "feat(diagram): MermaidPreview 自研受限渲染器（解析 + 分层布局 + 纯 SVG）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: MermaidCodeView + DiagramGeneratorPage 容器

**Files:**
- Create: `src/renderer/src/pages/DiagramGenerator/MermaidCodeView.tsx`
- Create: `src/renderer/src/pages/DiagramGenerator/MermaidCodeView.module.css`
- Create: `src/renderer/src/pages/DiagramGenerator/DiagramGeneratorPage.tsx`
- Create: `src/renderer/src/pages/DiagramGenerator/DiagramGeneratorPage.module.css`

**Interfaces:**
- Consumes: `useDiagramStore`（Task 4）、`MermaidPreview`（Task 5）、`useToast`（`@renderer/components/Toast`，签名 `toast(message, 'success'|'error'|'info')`）、`DiagramType` 类型。
- Produces（后续任务依赖）: `function DiagramGeneratorPage(): JSX.Element`。

- [ ] **Step 1: 创建 `MermaidCodeView.tsx`**

```tsx
import { useToast } from '@renderer/components/Toast'
import styles from './MermaidCodeView.module.css'

export function MermaidCodeView({ code }: { code: string }): JSX.Element {
  const toast = useToast()
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      toast('已复制 Mermaid 源码', 'success')
    } catch {
      toast('复制失败，请手动选择复制', 'error')
    }
  }
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>Mermaid 源码</span>
        <button type="button" className={styles.copy} onClick={() => void onCopy()}>
          复制
        </button>
      </div>
      <pre className={styles.code}>{code}</pre>
    </div>
  )
}
```

- [ ] **Step 2: 创建 `MermaidCodeView.module.css`**

```css
.wrap {
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}
.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
}
.copy {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 12px;
}
.code {
  margin: 0;
  padding: var(--space-3);
  overflow: auto;
  max-height: 320px;
  font-size: 12px;
  line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  background: var(--color-bg);
  color: var(--color-text);
  white-space: pre;
}
```

- [ ] **Step 3: 创建 `DiagramGeneratorPage.tsx`**

```tsx
import { useState } from 'react'
import { useToast } from '@renderer/components/Toast'
import type { DiagramType } from '@shared/types'
import { useDiagramStore } from '@renderer/stores/diagramStore'
import { MermaidCodeView } from './MermaidCodeView'
import { MermaidPreview } from './MermaidPreview'
import styles from './DiagramGeneratorPage.module.css'

const TYPE_OPTIONS: Array<{ value: DiagramType | ''; label: string }> = [
  { value: '', label: '自动判定' },
  { value: 'mindmap', label: '思维导图' },
  { value: 'flowchart', label: '流程图' },
  { value: 'approval', label: '审批流' }
]

const TYPE_NAMES: Record<DiagramType, string> = {
  mindmap: '思维导图',
  flowchart: '流程图',
  approval: '审批流程图'
}

export function DiagramGeneratorPage(): JSX.Element {
  const toast = useToast()
  const result = useDiagramStore((s) => s.result)
  const loading = useDiagramStore((s) => s.loading)
  const error = useDiagramStore((s) => s.error)
  const generate = useDiagramStore((s) => s.generate)
  const [source, setSource] = useState('')
  const [type, setType] = useState<DiagramType | ''>('')

  const onGenerate = async (): Promise<void> => {
    if (!source.trim()) {
      toast('请输入资料', 'error')
      return
    }
    const r = await generate(source.trim(), type === '' ? undefined : type)
    if (r.ok) toast(r.data.source === 'ai' ? 'AI 生成' : '本地模板生成', 'info')
    else toast(r.error.message, 'error')
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>图表生成</h1>
        <div className={styles.toolbar}>
          <select
            className={styles.select}
            value={type}
            onChange={(e) => setType(e.target.value as DiagramType | '')}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void onGenerate()}
            disabled={loading}
          >
            {loading ? '生成中…' : '生成'}
          </button>
        </div>
      </header>
      <textarea
        className={styles.source}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        rows={8}
        placeholder="粘贴资料，自动抽取结构生成图表（可用右侧下拉手动指定类型）"
      />
      {error && <div className={styles.error}>{error}</div>}
      {result && (
        <div className={styles.result}>
          <div className={styles.meta}>
            <span className={result.source === 'ai' ? styles.ai : styles.local}>
              {result.source === 'ai' ? 'AI 生成' : '本地模板'}
            </span>
            <span className={styles.typeName}>{TYPE_NAMES[result.type]}</span>
          </div>
          <MermaidPreview code={result.mermaid} />
          <MermaidCodeView code={result.mermaid} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 创建 `DiagramGeneratorPage.module.css`**

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.toolbar {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.select {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: 13px;
}
.toolbar .primary {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}
.toolbar .primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.source {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  font-family: inherit;
}
.result {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: 13px;
  color: var(--color-text-muted);
}
.ai {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-success);
  border: 1px solid var(--color-success);
}
.local {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--color-warning);
  border: 1px solid var(--color-warning);
}
.error {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--color-danger);
  background: rgba(220, 38, 38, 0.08);
}
```

> 说明：`meta` 的角标用 CSS 变量 `--color-success` / `--color-warning` / `--color-danger`（阶段 5 曾记 deferred minor：badge 硬编码 hex；本任务直接用令牌）。

- [ ] **Step 5: 验证**

Run: `npm run typecheck`
Expected: typecheck:web 通过。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/DiagramGenerator/
git commit -m "feat(diagram): 图表生成页面（资料输入 + 类型选择 + 预览 + 源码复制）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 导航接入 — SideNav + App 六路分支

**Files:**
- Modify: `src/renderer/src/components/layout/SideNav.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `DiagramGeneratorPage`（Task 6）。

- [ ] **Step 1: SideNav 加「图表」**

`src/renderer/src/components/layout/SideNav.tsx`：`PageId` 联合类型加 `'diagram'`（在 `'resume'` 后、`'settings'` 前）；`NAV_ITEMS` 在 `{ id: 'resume', label: '简历' }` 后加：

```ts
  { id: 'diagram', label: '图表' },
```

- [ ] **Step 2: App.tsx 六路分支**

`src/renderer/src/App.tsx`：import 区加 `import { DiagramGeneratorPage } from './pages/DiagramGenerator/DiagramGeneratorPage'`（按字母序放在 `AdBlockerPage` 后）；渲染分支在 `page === 'resume'` 分支后加：

```tsx
        ) : page === 'diagram' ? (
          <DiagramGeneratorPage />
        ) : (
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: typecheck:web 通过。

> 人工冒烟（可选，具备 dev 环境时）：`npm run dev` → 侧边栏出现「图表」→ 输入一段层级资料点「生成」→ 出现预览与源码。无 dev 环境则跳过，最终打包验证兜底。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/SideNav.tsx src/renderer/src/App.tsx
git commit -m "feat(diagram): 导航接入「图表」页（六路分支）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: 打包发布 — electron-builder

**Files:**
- Modify: `package.json`（devDependencies + dist script）
- Create: `electron-builder.yml`

**Interfaces:**
- Consumes: 既有 `main: "./out/main/index.js"`、`electron-vite build` 产物 `out/**`。
- Produces（后续任务依赖）: `npm run dist` 产出 `release/*.exe`。

- [ ] **Step 1: 安装 electron-builder（devDependency）**

Run: `npm install -D electron-builder`
Expected: package.json devDependencies 出现 `"electron-builder": "^...`（具体版本以 npm 解析为准）。

- [ ] **Step 2: package.json 加 dist 脚本**

在 `scripts` 中 `"typecheck"` 之后加：

```json
    "dist": "electron-vite build && electron-builder",
```

- [ ] **Step 3: 创建 `electron-builder.yml`**

```yaml
appId: com.mypc.app
productName: my-pc
directories:
  output: release
files:
  - out/**
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

- [ ] **Step 4: 验证打包**

Run: `npm run dist`
Expected: `electron-vite build` 成功产出 `out/`；electron-builder 产出 `release/my-pc Setup x.x.x.exe`（首次会下载 NSIS 工具链，需网络）。若 NSIS 下载失败，重试一次；仍失败则记录并报 BLOCKED。

- [ ] **Step 5: 验证 typecheck 未回归**

Run: `npm run typecheck`
Expected: 通过（electron-builder 是构建期 devDependency，不影响编译）。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron-builder.yml
git commit -m "build: electron-builder 打包（Windows NSIS 安装包 + dist 脚本）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 收尾 — 文档同步 + 技能更新

**Files:**
- Modify: `docs/API_SPEC.md`（§7 DiagramResult 补 source）
- Modify: `docs/modules/diagram-generator.md`（状态行 + §7 勾选 + 渲染方案口径）
- Modify: `docs/ARCHITECTURE.md`（§5.1 状态行补阶段 6）
- Modify: `docs/README.md`（阶段 6 标题 ✅ + 状态行）
- Modify: `docs/DATABASE.md`（§2.6 diagrams 标注未实现）
- Modify: `docs/COMPONENT_LIBRARY.md`（§3.5 更新）
- Modify: `.claude/skills/diagram-generator/SKILL.md`（集成约定改受限渲染器）
- Modify: `.claude/skills/diagram-generator/references/mermaid-snippets.md`（收敛受限子集）

**Interfaces:**
- Consumes: 本计划全部交付物；既有文档锚点。

- [ ] **Step 1: `docs/API_SPEC.md` §7**

`DiagramResult` 接口补 `source` 字段：

```ts
interface DiagramResult { type: 'mindmap' | 'flowchart' | 'approval'; mermaid: string; source: 'ai' | 'local' }
```

在 §7 说明段（`> 图表渲染在渲染层完成（mermaid.render()）...`）改为受限渲染器口径：

```markdown
> 图表渲染在**渲染层**完成（自研受限渲染器：仅支持 `mindmap` 缩进树与 `flowchart TD/LR` 受限子集，见 `shared/mermaid.ts`）。主进程只负责「资料 → 结构抽取 → Mermaid 源码」，并保证返回的 `mermaid` 必然通过 `validateMermaid`（受限语法校验）。AI 能力同样走适配层 + 本地兜底。
```

- [ ] **Step 2: `docs/modules/diagram-generator.md`**

在文件顶部 `# 模块设计：图表生成（diagram-generator）` 之后加状态行：

```markdown
> 状态：阶段 6 已落地（2026-08-18，见 §7）。核心裁定：**自研受限 Mermaid 渲染器**（零新依赖，`shared/mermaid.ts` 单一真相源）、AI 优先本地兜底、`diagram:generate` 永不 reject、不做图表历史表（YAGNI）。
```

§2.3 渲染段改为自研渲染器口径（原文「渲染在渲染层：mermaid.render() 生成 SVG」改为「渲染在渲染层：自研受限渲染器（`shared/mermaid.ts` 解析 + 布局 + 纯 SVG），零第三方库」）。

§7 验收标准全部勾选为 `[x]`。

- [ ] **Step 3: `docs/ARCHITECTURE.md` §5.1**

在阶段 5 的 `**状态**` 行内、句末追加阶段 6 说明（保持单行）：在「…图表模块（阶段 6）将复用同一契约。」之后改为「…图表模块（阶段 6）复用同一契约（`services/diagram.service.ts` 的 `generate()` 调用 `complete(prompt)`，AI 失败 / 未配置 / 受限语法校验不过时走本地模板兜底，见 `modules/diagram-generator.md`）。」

- [ ] **Step 4: `docs/README.md` 阶段 6**

标题改为：

```markdown
### 阶段 6 · 图表生成模块 + 收尾（目标：完整交付）✅ 已落地
```

并在该节末尾（`- **验收**：...` 之后）补：

```markdown
- **状态**：已落地并验收通过（2026-08-18，见 `modules/diagram-generator.md` §7）；打包产物见 `release/`。
```

- [ ] **Step 5: `docs/DATABASE.md` §2.6**

把 `### 2.6 diagrams — 图表历史（可选）` 的标题与代码块下方加一行标注：

```markdown
> 阶段 6 明确**不做**（YAGNI）：无历史回看需求，未建该表。需要时按此结构补 v5 迁移。
```

- [ ] **Step 6: `docs/COMPONENT_LIBRARY.md` §3.5**

`MermaidPreview` 行的描述改为「Mermaid 源码渲染（自研受限渲染器：`shared/mermaid.ts` 解析 + 分层布局 + 纯 SVG，零第三方库）」；补一行 `MermaidCodeView | Mermaid 源码展示 + 复制`。

- [ ] **Step 7: `.claude/skills/diagram-generator/SKILL.md`**

把「## 集成约定」整节改为：

```markdown
## 集成约定

- 渲染层用**自研受限渲染器**（`src/shared/mermaid.ts` 为唯一语法真相源）：只支持 `mindmap` 缩进树与 `flowchart TD/LR` 的 `A-->B` / `A--标签-->B`、`{}` 判断节点、`(( ))` 根节点；`MermaidPreview` 解析 + 布局 + 纯 SVG，零第三方库。
- 主进程 `diagram.service` 在返回前用同一 `parseMermaid` 校验 AI 输出；不合规或 AI 失败 → `localGenerate` 本地模板兜底，`diagram:generate` 永不 reject。
- 输出同时给「Mermaid 源码」和「渲染结果」，源码可复制、二次编辑。
```

- [ ] **Step 8: `.claude/skills/diagram-generator/references/mermaid-snippets.md`**

在文件头部加一行声明：

```markdown
> 本速查只收录受限子集（`shared/mermaid.ts` 解析器支持的全部语法）；超出子集的 Mermaid 特性一律不用。
```

- [ ] **Step 9: 验证**

Run: `npm run typecheck`
Expected: 通过（文档改动不影响编译）。

- [ ] **Step 10: Commit**

```bash
git add docs/API_SPEC.md docs/modules/diagram-generator.md docs/ARCHITECTURE.md docs/README.md docs/DATABASE.md docs/COMPONENT_LIBRARY.md .claude/skills/diagram-generator/
git commit -m "docs: 阶段 6 落地记录（API 规范 / 模块文档 / 架构 / README / DATABASE / 组件库 / 技能）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review 核对（计划作者已执行）

**1. Spec 覆盖：**
- §1 目标（三类图表 + 页面 + 打包）→ Task 1-8。
- §3.1 文件结构 → Task 1-9 逐一对应（`shared/mermaid.ts` 在 Task 1）。
- §3.2 数据模型（DiagramRequest/Result + source）→ Task 1。
- §3.3 受限语法 + `parseMermaid` 单一真相源 → Task 1；主进程校验（Task 2）+ 渲染层布局（Task 5）共用。
- §3.4 生成引擎（classifyType / AI prompt / validateMermaid / localGenerate 不编造）→ Task 2。
- §3.5 渲染（mindmap 缩进树 / flowchart 分层布局 / SVG marker / 防御性失败提示）→ Task 5。
- §3.6 UI（Page + Preview + CodeView + store + 导航）→ Task 4-7。
- §4 IPC（diagram:generate，无持久化通道）→ Task 3。
- §5 错误处理（永不 reject、VALIDATION_ERROR）→ Task 2 + Task 3。
- §6 打包（electron-builder devDep + yml + dist 脚本）→ Task 8。
- §7 文档 / 技能 → Task 9。
- §8 验收 → 各任务验证 + 打包产出验证。

**2. 占位符扫描：** 全部代码块为完整可执行代码；无 TBD / TODO / 「写上面所述测试」类占位。唯一软引用是 electron-builder 版本号（由 npm 解析，Task 8 Step 1 说明）。

**3. 类型一致性：**
- `DiagramRequest` / `DiagramResult`（含 `source`）：Task 1 定义 → Task 2 产出 → Task 3 通道 → Task 4 store → Task 6 页面消费，字段一致。
- `DiagramType`：Task 1 定义 → Task 2 classify/generate → Task 6 下拉选项，一致。
- `parseMermaid` / `ParsedMermaid` / `MindmapTree` / `DiagramNode` / `DiagramEdge`：Task 1 定义 → Task 2 validateMermaid + Task 5 布局，签名一致。
- `generate(source, type?)` / `validateMermaid` / `localGenerate` / `classifyType`：Task 2 定义 → Task 3 使用，一致。
- `useDiagramStore` 方法：Task 4 定义 → Task 6 使用（`result/loading/error/generate`），一致。
- CSS 变量均为既有 tokens（`--space-*` / `--color-*` / `--radius` / `--radius-sm`）；Task 6 角标直接复用 `--color-success` / `--color-warning` / `--color-danger`（修正阶段 5 的 hex 先例）。

**4. 计划级裁定（非 spec 逐字，供评审 triage）：**
- **`ParsedMermaid` 接口与 spec §3.3 的示例签名有出入**：spec 写 `type: 'mindmap'` + `children: Record<string, DiagramNode[]>`；计划实现为 `kind: 'mindmap'` + `root: MindmapTree`（树结构）。理由：`kind` 与 `DiagramNode.kind` 命名一致，避免与 `DiagramType`（mindmap/flowchart/approval）混淆；树结构比 `Record<string, DiagramNode[]>` 更贴合布局递归。spec §3.3 明确标注该接口为「解析器接口（纯函数，无 DOM）」示例，语义不变。
- 「自动」类型 = 不传 `type`（store 透传 `undefined`），页面下拉显式化（Task 4/6）。
- `diagram:generate` 请求校验：`source` 空 / 超长（≤8000）→ `VALIDATION_ERROR`（Task 3，精确数值为计划级）。
- `localMindmap` 简化：识别根 + 每行一个子节点（spec §3.4 允许「无清晰层级 → 根 + 每行一个子节点」；不做缩进细粒度树）。
- `validateMermaid` 对 `approval` 接受 `flowchart` 解析结果（approval 本质是带角色 flowchart，spec §3.3 隐含）。
- AI 输出严格校验「边引用的节点必须已声明」（spec §3.3 逐字；本机模板总是先声明，AI 需按 prompt 遵守）。
- 任务顺序 Task 1→9 线性依赖，无阶段 5 那样的执行顺序调整需求。
