# 阶段 5 简历优化模块（STAR 闭环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现个人简历编辑器 + 单条 STAR 优化闭环（AI 优先、本地规则兜底、不编造）+ Markdown 导出 / JSON 导入导出。

**Architecture:** 沿用三层：主进程 `resume.service.ts`（优化引擎 + 兜底 + Markdown/导入校验）与 `resume.repository.ts`（SQLite `resumes` 单行 default）；preload 暴露 `window.api.resume.*`（5 通道）；渲染层 zustand `resumeStore`（内存态 + dirty）+ `pages/ResumeOptimizer/`（Tab 编辑器 + OptimizeModal）。AI 调用复用 Phase 4 `ai/complete(prompt, schema?)`，任何 AI 错误 catch 后走本地兜底。

**Tech Stack:** Electron + TypeScript strict + node:sqlite + zustand（既有栈，零新依赖）。验证门 = `npm run typecheck`（node + web）。

## Global Constraints（binding，逐字遵守）

- TypeScript strict，禁用 any；无测试框架，`npm run typecheck` = 唯一验证门（node + web 都过）
- 不引新依赖；HTTP 用 Node 22 内置 fetch（AI 路径复用 Phase 4 adapter，不在本计划内重写）
- contextIsolation:true / nodeIntegration:false 不动；渲染层零 Node 权限；对话框 / 文件 IO 只在主进程
- IPC invoke + IpcResult；`complete()` 是主进程内部接口，resume.service 直接 import，**不建 `resume:complete` IPC**
- **AI 错误一律兜底**：`resume:optimize` 永不 reject，AI 四码（AI_NOT_CONFIGURED/AI_TIMEOUT/AI_API_ERROR/AI_UNAVAILABLE）在 service 内 catch → 返回 `source: 'local'` 结果，不外泄渲染层
- **导出所见即所得**：`resume:export` 由渲染层传入当前内存态 resume（非 DB），保证未保存编辑也导出正确
- 显式保存：编辑只改内存 store，页面「保存」统一落库；**无自动保存**
- 简历条目**无 id**：增删改一律按数组 index 定位（与共享类型一致，不偏离 API_SPEC §6）
- commit 以 `Co-Authored-By: Claude <noreply@anthropic.com>` 结尾

---

### Task 1: 共享契约 —— Resume 模型 + Resume 域类型

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Consumes: 无（本任务独立）。
- Produces: `Resume` / `SkillItem` / `ExperienceItem` / `ProjectItem` / `OptimizeRequest` / `OptimizeResult` / `Star` / `ResumeApi`；`WindowApi` 增 `resume` 域（Task 2-8 全部使用）。

- [ ] **Step 1: 在 `WindowApi` 定义之前新增简历域类型**（插在 `AdblockApi` 定义之后、`WindowApi` 之前，约 241 行前）

```ts
// —— 简历优化域（resume）——
export interface SkillItem {
  name: string // 技能名
  level: string // 熟练度：了解 / 掌握 / 熟练 / 精通
  years: string // 年限，自由文本，如 '3 年'
  note: string // 一句可验证说明
}

export interface ExperienceItem {
  company: string
  title: string
  start: string // 自由文本，如 '2020-07'
  end: string // 如 '2024-06'，在职可留空
  bullets: string[] // 职责 / 成果，逐条可优化
}

export interface ProjectItem {
  name: string
  role: string
  start: string
  end: string
  description: string
  bullets: string[] // 逐条可优化
  tags: string[] // 技术栈标签
}

export interface Resume {
  basics: { name: string; title: string; summary: string }
  skills: SkillItem[]
  experience: ExperienceItem[]
  projects: ProjectItem[]
}

export interface Star {
  situation: string
  task: string
  action: string
  result: string
}

export interface OptimizeRequest {
  section: 'experience' | 'project' | 'skill'
  input: string
}

export interface OptimizeResult {
  star: Star
  source: 'ai' | 'local' // 用于 UI 展示「AI 优化 / 本地模板」角标
}

export interface ResumeApi {
  load(): Promise<IpcResult<Resume | null>>
  save(resume: Resume): Promise<IpcResult<Resume>>
  optimize(req: OptimizeRequest): Promise<IpcResult<OptimizeResult>>
  export(payload: { type: 'markdown' | 'json'; resume: Resume }): Promise<IpcResult<{ path: string } | null>>
  import(): Promise<IpcResult<Resume | null>>
}
```

- [ ] **Step 2: `WindowApi` 增 resume 域**（在 `adblock: AdblockApi` 之后加一行）

```ts
  resume: ResumeApi
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: 通过（types.ts 内引用 `IpcResult` 已存在；此时无实现，只有类型，仍应编译通过）。

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): 简历数据模型 + Resume 域 API 类型

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 存储 —— resumes 表（迁移 v4）+ resume.repository

**Files:**
- Modify: `src/main/db/migrations.ts`
- Create: `src/main/db/repositories/resume.repository.ts`

**Interfaces:**
- Consumes: `Resume`（Task 1）。
- Produces: `resumeRepository.load(): Resume | null`、`resumeRepository.save(resume: Resume): Resume`（Task 3/4 使用）。

- [ ] **Step 1: migrations.ts 追加迁移 v4**（在数组最后、`version: 3` 条目之后追加，`runMigrations` 不动）

```ts
  {
    version: 4,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS resumes (
          key  TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
      `)
    }
  }
```

- [ ] **Step 2: 新建 `src/main/db/repositories/resume.repository.ts`**

```ts
import type { Resume } from '@shared/types'
import { getDb } from '../index'

// 单行 default 存整份简历 JSON；load 无行返回 null（页面用空模板）
export const resumeRepository = {
  load(): Resume | null {
    const row = getDb()
      .prepare('SELECT data FROM resumes WHERE key = ?')
      .get('default') as { data: string } | undefined
    return row ? (JSON.parse(row.data) as Resume) : null
  },

  save(resume: Resume): Resume {
    getDb()
      .prepare('INSERT INTO resumes(key, data) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data')
      .run('default', JSON.stringify(resume))
    return resume
  }
}
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/main/db/migrations.ts src/main/db/repositories/resume.repository.ts
git commit -m "feat(db): resumes 表（迁移 v4）+ resume.repository（单行 default upsert）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 优化引擎 —— resume.service（AI 优先 + 本地兜底 + Markdown + 导入校验）

**Files:**
- Create: `src/main/services/resume.service.ts`

**Interfaces:**
- Consumes: `Resume`/`OptimizeRequest`/`OptimizeResult`/`Star`/`JsonSchema`（Task 1）；`complete(prompt, schema?)` from `../ai/adapter`（Phase 4）；`AppError` from `@shared/errors`。
- Produces: `optimize(section, input): Promise<OptimizeResult>`、`buildMarkdown(resume): string`、`validateResume(value: unknown): Resume`（Task 4 的 IPC 使用）。

- [ ] **Step 1: 新建 `src/main/services/resume.service.ts`**

```ts
import { AppError } from '@shared/errors'
import type { JsonSchema, OptimizeResult, Resume, Star } from '@shared/types'
import { complete } from '../ai/adapter'

// 本地兜底：规则按信号词把输入切成 STAR 四段；缺段 / 缺量化产出占位提示，不编造数字
const SENTENCE_SPLIT = /[。；;\n]+/
const SITUATION_RE = /背景|当时|现状|由于|因为|起初|此前|原先/
const TASK_RE = /需要|目标|要求|职责|要完成|承担/
const ACTION_RE = /完成|实现|主导|重构|搭建|开发|设计|引入|推动|组织|落地|上线|统一|编写|对接|优化|梳理|沉淀/
const RESULT_RE = /带来|使得|提升|降低|缩短|减少|增加|达到|覆盖|支撑|节省|交付|服务了/
const QUANT_RE = /[0-9％%]|提升|降低|缩短|减少|增加|节省|覆盖|万|亿|倍|人|天|个月|年|个|页|接口|用户|规模|周期|响应|交付/

const STAR_SCHEMA: JsonSchema = {
  name: 'starRewrite',
  description: '把平淡的经历描述改写为 STAR 四段结构',
  properties: {
    situation: { type: 'string', description: '情境：当时的背景与问题' },
    task: { type: 'string', description: '任务：需要达成的目标或职责' },
    action: { type: 'string', description: '行动：本人具体做了什么，主动语态' },
    result: { type: 'string', description: '结果：量化成果（数字 / 百分比 / 时间 / 规模）；输入未提供则如实说明缺失，不编造' }
  }
}

function buildPrompt(section: OptimizeRequest['section'], input: string): string {
  if (section === 'skill') {
    return `把这条技能说明改写成可验证的 STAR 描述（使用场景 → 承担事项 → 具体做法 → 可验证效果）。效果缺失则如实标注，不要编造。\n原文：${input}`
  }
  return `把这条平淡的经历描述改写成 STAR 四段：情境（当时的背景与问题）、任务（目标或职责）、行动（用「我」开头的主动语态）、结果（尽量量化；输入没有量化数据就不要编造）。\n原文：${input}`
}

function parseStar(raw: string): Star {
  const data = JSON.parse(raw) as Record<string, unknown>
  const star: Star = { situation: '', task: '', action: '', result: '' }
  for (const key of Object.keys(star) as Array<keyof Star>) {
    const v = data[key]
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`STAR 字段缺失：${key}`)
    star[key] = v.trim()
  }
  return star
}

function classifySentence(sentence: string): keyof Star | null {
  if (SITUATION_RE.test(sentence)) return 'situation'
  if (RESULT_RE.test(sentence)) return 'result'
  if (TASK_RE.test(sentence)) return 'task'
  if (ACTION_RE.test(sentence)) return 'action'
  return null
}

// 方案 A：规则切分 + 待补充标注（section 仅影响结果段占位文案）
function localOptimize(section: OptimizeRequest['section'], input: string): Star {
  const resultHint = section === 'skill' ? '可验证效果（数字 / 百分比 / 时间 / 规模）' : '量化数据（数字 / 百分比 / 时间 / 规模）'
  const star: Star = { situation: '', task: '', action: '', result: '' }
  const rest: string[] = []
  for (const sentence of input.split(SENTENCE_SPLIT)) {
    const s = sentence.trim()
    if (!s) continue
    const kind = classifySentence(s)
    if (kind) star[kind] = star[kind] ? `${star[kind]}；${s}` : s
    else rest.push(s)
  }
  if (rest.length) star.action = star.action ? `${star.action}；${rest.join('；')}` : rest.join('；')
  if (!star.situation) star.situation = '[待补充：当时的背景或问题情境]'
  if (!star.task) star.task = '[待补充：需要达成的目标或职责]'
  if (!star.result) star.result = `[待补充${resultHint}]`
  else if (!QUANT_RE.test(star.result)) star.result = `${star.result}\n[待补充${resultHint}]`
  return star
}

// 主进程内部接口：AI 优先，任何失败（含 JSON 解析失败）→ 本地兜底，永不 reject
export async function optimize(
  section: OptimizeRequest['section'],
  input: string
): Promise<OptimizeResult> {
  try {
    const raw = await complete(buildPrompt(section, input), STAR_SCHEMA)
    return { star: parseStar(raw), source: 'ai' }
  } catch {
    return { star: localOptimize(section, input), source: 'local' }
  }
}

// 导出 Markdown：整份简历 → .md 文本
export function buildMarkdown(resume: Resume): string {
  const lines: string[] = []
  const { name, title, summary } = resume.basics
  if (name || title) lines.push(`# ${name}${title ? ` · ${title}` : ''}`)
  if (summary) lines.push(summary)
  lines.push('')

  if (resume.skills.length) {
    lines.push('## 技能', '')
    for (const s of resume.skills) {
      const meta = [s.name, s.level, s.years].filter(Boolean).join(' · ')
      lines.push(`- ${meta ? `**${meta}**` : '（未命名技能）'}${s.note ? `：${s.note}` : ''}`)
    }
    lines.push('')
  }

  if (resume.experience.length) {
    lines.push('## 工作经历', '')
    for (const e of resume.experience) {
      const range = [e.start, e.end].filter(Boolean).join(' - ')
      lines.push(`### ${e.company || '（公司）'}${e.title ? ` · ${e.title}` : ''}${range ? `（${range}）` : ''}`, '')
      for (const b of e.bullets) lines.push(`- ${b}`)
      lines.push('')
    }
  }

  if (resume.projects.length) {
    lines.push('## 项目经历', '')
    for (const p of resume.projects) {
      const range = [p.start, p.end].filter(Boolean).join(' - ')
      lines.push(`### ${p.name || '（项目）'}${p.role ? ` · ${p.role}` : ''}${range ? `（${range}）` : ''}`, '')
      if (p.description) lines.push(p.description, '')
      for (const b of p.bullets) lines.push(`- ${b}`)
      if (p.tags.length) lines.push('', `标签：${p.tags.join('、')}`)
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd() + '\n'
}

// 导入 / 保存校验：顶层 section 存在但类型错 → 抛 VALIDATION_ERROR；条目内字段宽松归一
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function validateResume(value: unknown): Resume {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('VALIDATION_ERROR', '简历数据不是合法的 JSON 对象')
  }
  const raw = value as Record<string, unknown>
  if (raw.skills !== undefined && !Array.isArray(raw.skills)) throw new AppError('VALIDATION_ERROR', 'skills 需为数组')
  if (raw.experience !== undefined && !Array.isArray(raw.experience)) throw new AppError('VALIDATION_ERROR', 'experience 需为数组')
  if (raw.projects !== undefined && !Array.isArray(raw.projects)) throw new AppError('VALIDATION_ERROR', 'projects 需为数组')

  const basicsRaw = (raw.basics ?? {}) as Record<string, unknown>
  const skills: Resume['skills'] = (raw.skills as unknown[] ?? []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { name: asString(o.name), level: asString(o.level), years: asString(o.years), note: asString(o.note) }
  })
  const experience: Resume['experience'] = (raw.experience as unknown[] ?? []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { company: asString(o.company), title: asString(o.title), start: asString(o.start), end: asString(o.end), bullets: asStringList(o.bullets) }
  })
  const projects: Resume['projects'] = (raw.projects as unknown[] ?? []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { name: asString(o.name), role: asString(o.role), start: asString(o.start), end: asString(o.end), description: asString(o.description), bullets: asStringList(o.bullets), tags: asStringList(o.tags) }
  })
  return {
    basics: { name: asString(basicsRaw.name), title: asString(basicsRaw.title), summary: asString(basicsRaw.summary) },
    skills,
    experience,
    projects
  }
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck`
Expected: 通过。

行为自检（无测试框架，靠 code review 把关，最终由 §验收 的 E2E 实测）：
- `localOptimize('experience', '负责公司后台系统开发，完成了 40+ 接口的重构，使得接口平均响应时间降低 30%')` → 情境占位 `[待补充…]`；任务=`负责公司后台系统开发`；行动=`完成了 40+ 接口的重构`；结果=`使得接口平均响应时间降低 30%`（含量化，不追加占位）。
- `localOptimize('experience', '我负责开发页面')` → 任务=`我负责开发页面`；其余三段全为占位；**不产生任何编造数字**。
- `parseStar` 对缺字段 JSON 抛错 → `optimize` catch → 走 local。

- [ ] **Step 3: Commit**

```bash
git add src/main/services/resume.service.ts
git commit -m "feat(resume): 优化引擎（AI 优先 + 本地规则兜底 + Markdown 导出 + 导入校验）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: IPC 接入 —— resume 五通道 + preload

**Files:**
- Create: `src/main/ipc/resume.ipc.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `resumeRepository`（Task 2）；`optimize`/`buildMarkdown`/`validateResume`（Task 3）；`Resume`/`OptimizeRequest`/`OptimizeResult`（Task 1）。
- Produces: IPC `resume:load`/`resume:save`/`resume:optimize`/`resume:export`/`resume:import`；`window.api.resume.*`（Task 5-8 使用）。

- [ ] **Step 1: 新建 `src/main/ipc/resume.ipc.ts`**（对话框 + 文件 IO 只在主进程）

```ts
import { dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { AppError } from '@shared/errors'
import type { OptimizeRequest, Resume } from '@shared/types'
import { resumeRepository } from '../db/repositories/resume.repository'
import { buildMarkdown, optimize, validateResume } from '../services/resume.service'

const SECTIONS: OptimizeRequest['section'][] = ['experience', 'project', 'skill']

function validateOptimizeRequest(req: OptimizeRequest): void {
  if (typeof req !== 'object' || req === null) throw new AppError('VALIDATION_ERROR', '无效的优化参数')
  if (!SECTIONS.includes(req.section)) throw new AppError('VALIDATION_ERROR', 'section 需为 experience/project/skill')
  if (typeof req.input !== 'string' || req.input.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'input 不能为空')
  if (req.input.length > 2000) throw new AppError('VALIDATION_ERROR', 'input 过长（上限 2000 字符）')
}

function validateExportType(type: unknown): asserts type is 'markdown' | 'json' {
  if (type !== 'markdown' && type !== 'json') throw new AppError('VALIDATION_ERROR', 'type 需为 markdown 或 json')
}

export function registerResumeIpc(): void {
  ipcMain.handle('resume:load', () => resumeRepository.load())

  ipcMain.handle('resume:save', (_e, resume: Resume) => {
    return resumeRepository.save(validateResume(resume))
  })

  ipcMain.handle('resume:optimize', (_e, req: OptimizeRequest) => {
    validateOptimizeRequest(req)
    return optimize(req.section, req.input.trim())
  })

  // 导出所见即所得：渲染层传入当前内存态 resume（非 DB）
  ipcMain.handle('resume:export', async (_e, payload: { type: 'markdown' | 'json'; resume: Resume }) => {
    if (typeof payload !== 'object' || payload === null) throw new AppError('VALIDATION_ERROR', '无效的导出参数')
    validateExportType(payload.type)
    const resume = validateResume(payload.resume)
    const isMarkdown = payload.type === 'markdown'
    const result = await dialog.showSaveDialog({
      title: isMarkdown ? '导出简历为 Markdown' : '导出简历为 JSON',
      defaultPath: isMarkdown ? '简历.md' : 'resume.json',
      filters: isMarkdown
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    const content = isMarkdown ? buildMarkdown(resume) : JSON.stringify(resume, null, 2)
    await writeFile(result.filePath, content, 'utf-8')
    return { path: result.filePath }
  })

  ipcMain.handle('resume:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入简历 JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const raw = await readFile(result.filePaths[0], 'utf-8')
    return validateResume(JSON.parse(raw))
  })
}
```

- [ ] **Step 2: `src/main/ipc/index.ts` 注册 resume 域**（import 加 `registerResumeIpc`；调用加在 `registerSettingsIpc()` 之后）

```ts
import { registerResumeIpc } from './resume.ipc'
```
```ts
  registerSettingsIpc()
  registerResumeIpc()
```

- [ ] **Step 3: `src/preload/index.ts` 暴露 resume 域**（import 加类型；`api` 对象加 `resume` 键）

```ts
  OptimizeResult,
  ProjectItem,
  Resume,
```
```ts
  resume: {
    load: () => invoke<Resume | null>('resume:load'),
    save: (resume) => invoke<Resume>('resume:save', resume),
    optimize: (req) => invoke<OptimizeResult>('resume:optimize', req),
    export: (payload) => invoke<{ path: string } | null>('resume:export', payload),
    import: () => invoke<Resume | null>('resume:import')
  },
```

- [ ] **Step 4: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/resume.ipc.ts src/main/ipc/index.ts src/preload/index.ts
git commit -m "feat(resume): resume 五通道 IPC（load/save/optimize/export/import）+ preload 接入

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: resumeStore —— 内存态 + dirty + 显式保存

**Files:**
- Create: `src/renderer/src/stores/resumeStore.ts`

**Interfaces:**
- Consumes: `window.api.resume.*`（Task 4）；`Resume`/`SkillItem`/`ExperienceItem`/`ProjectItem`/`OptimizeResult`/`IpcResult`（Task 1）。
- Produces: `useResumeStore`（Task 6-8 使用）——见下方接口清单。

- [ ] **Step 1: 新建 `src/renderer/src/stores/resumeStore.ts`**

```ts
import { create } from 'zustand'
import type {
  ExperienceItem,
  IpcResult,
  OptimizeResult,
  ProjectItem,
  Resume,
  SkillItem
} from '@shared/types'

const EMPTY_RESUME: Resume = { basics: { name: '', title: '', summary: '' }, skills: [], experience: [], projects: [] }

type Section = 'experience' | 'project' | 'skill'
type BulletKind = 'experience' | 'project'

interface ResumeState {
  resume: Resume
  loaded: boolean // load 是否完成（首次渲染显示加载中）
  dirty: boolean // 是否有未保存修改
  loading: boolean
  saving: boolean
  error: string | null
  load: () => Promise<void>
  save: () => Promise<boolean>
  replaceAll: (resume: Resume) => void // 导入 JSON 后整体替换（置 dirty）
  updateBasics: (patch: Partial<Resume['basics']>) => void
  addSkill: () => void
  updateSkill: (index: number, patch: Partial<SkillItem>) => void
  removeSkill: (index: number) => void
  addExperience: () => void
  updateExperience: (index: number, patch: Partial<ExperienceItem>) => void
  removeExperience: (index: number) => void
  addProject: () => void
  updateProject: (index: number, patch: Partial<ProjectItem>) => void
  removeProject: (index: number) => void
  addBullet: (kind: BulletKind, index: number) => void
  updateBullet: (kind: BulletKind, index: number, bulletIndex: number, value: string) => void
  removeBullet: (kind: BulletKind, index: number, bulletIndex: number) => void
  addTag: (index: number, tag: string) => void
  removeTag: (index: number, tagIndex: number) => void
  optimize: (section: Section, input: string) => Promise<IpcResult<OptimizeResult>> // 直接透传 IPC
  clearError: () => void
}

export const useResumeStore = create<ResumeState>((set, get) => ({
  resume: EMPTY_RESUME,
  loaded: false,
  dirty: false,
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    const r = await window.api.resume.load()
    if (r.ok) set({ resume: r.data ?? EMPTY_RESUME, loaded: true, loading: false })
    else set({ error: r.error.message, loading: false })
  },

  save: async () => {
    set({ saving: true, error: null })
    const r = await window.api.resume.save(get().resume)
    set({ saving: false })
    if (r.ok) {
      set({ dirty: false })
      return true
    }
    set({ error: r.error.message })
    return false
  },

  replaceAll: (resume) => set({ resume, dirty: true }),
  updateBasics: (patch) =>
    set((s) => ({ resume: { ...s.resume, basics: { ...s.resume.basics, ...patch } }, dirty: true })),

  addSkill: () =>
    set((s) => ({ resume: { ...s.resume, skills: [...s.resume.skills, { name: '', level: '', years: '', note: '' }] }, dirty: true })),
  updateSkill: (index, patch) =>
    set((s) => ({ resume: { ...s.resume, skills: s.resume.skills.map((it, i) => (i === index ? { ...it, ...patch } : it)) }, dirty: true })),
  removeSkill: (index) =>
    set((s) => ({ resume: { ...s.resume, skills: s.resume.skills.filter((_, i) => i !== index) }, dirty: true })),

  addExperience: () =>
    set((s) => ({ resume: { ...s.resume, experience: [...s.resume.experience, { company: '', title: '', start: '', end: '', bullets: [''] }] }, dirty: true })),
  updateExperience: (index, patch) =>
    set((s) => ({ resume: { ...s.resume, experience: s.resume.experience.map((it, i) => (i === index ? { ...it, ...patch } : it)) }, dirty: true })),
  removeExperience: (index) =>
    set((s) => ({ resume: { ...s.resume, experience: s.resume.experience.filter((_, i) => i !== index) }, dirty: true })),

  addProject: () =>
    set((s) => ({ resume: { ...s.resume, projects: [...s.resume.projects, { name: '', role: '', start: '', end: '', description: '', bullets: [''], tags: [] }] }, dirty: true })),
  updateProject: (index, patch) =>
    set((s) => ({ resume: { ...s.resume, projects: s.resume.projects.map((it, i) => (i === index ? { ...it, ...patch } : it)) }, dirty: true })),
  removeProject: (index) =>
    set((s) => ({ resume: { ...s.resume, projects: s.resume.projects.filter((_, i) => i !== index) }, dirty: true })),

  addBullet: (kind, index) =>
    set((s) => {
      if (kind === 'experience') {
        const next = s.resume.experience.map((it, i) => (i === index ? { ...it, bullets: [...it.bullets, ''] } : it))
        return { resume: { ...s.resume, experience: next }, dirty: true }
      }
      const next = s.resume.projects.map((it, i) => (i === index ? { ...it, bullets: [...it.bullets, ''] } : it))
      return { resume: { ...s.resume, projects: next }, dirty: true }
    }),
  updateBullet: (kind, index, bulletIndex, value) =>
    set((s) => {
      if (kind === 'experience') {
        const next = s.resume.experience.map((it, i) =>
          i === index ? { ...it, bullets: it.bullets.map((b, j) => (j === bulletIndex ? value : b)) } : it
        )
        return { resume: { ...s.resume, experience: next }, dirty: true }
      }
      const next = s.resume.projects.map((it, i) =>
        i === index ? { ...it, bullets: it.bullets.map((b, j) => (j === bulletIndex ? value : b)) } : it
      )
      return { resume: { ...s.resume, projects: next }, dirty: true }
    }),
  removeBullet: (kind, index, bulletIndex) =>
    set((s) => {
      if (kind === 'experience') {
        const next = s.resume.experience.map((it, i) =>
          i === index ? { ...it, bullets: it.bullets.filter((_, j) => j !== bulletIndex) } : it
        )
        return { resume: { ...s.resume, experience: next }, dirty: true }
      }
      const next = s.resume.projects.map((it, i) =>
        i === index ? { ...it, bullets: it.bullets.filter((_, j) => j !== bulletIndex) } : it
      )
      return { resume: { ...s.resume, projects: next }, dirty: true }
    }),

  addTag: (index, tag) =>
    set((s) => ({ resume: { ...s.resume, projects: s.resume.projects.map((it, i) => (i === index ? { ...it, tags: [...it.tags, tag] } : it)) }, dirty: true })),
  removeTag: (index, tagIndex) =>
    set((s) => ({ resume: { ...s.resume, projects: s.resume.projects.map((it, i) => (i === index ? { ...it, tags: it.tags.filter((_, j) => j !== tagIndex) } : it)) }, dirty: true })),

  optimize: async (section, input) => window.api.resume.optimize({ section, input }),
  clearError: () => set({ error: null })
}))
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck`
Expected: 通过（store 引用 `window.api.resume` 需 Task 4 已落地；本任务在 Task 4 之后执行）。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/resumeStore.ts
git commit -m "feat(resume): resumeStore（内存态 + dirty + 显式保存 + 优化透传）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 编辑区组件 —— BasicsForm + SkillsEditor + ExperienceEditor + ProjectEditor

**Files:**
- Create: `src/renderer/src/pages/ResumeOptimizer/BasicsForm.tsx` + `BasicsForm.module.css`
- Create: `src/renderer/src/pages/ResumeOptimizer/SkillsEditor.tsx` + `SkillsEditor.module.css`
- Create: `src/renderer/src/pages/ResumeOptimizer/ExperienceEditor.tsx` + `ExperienceEditor.module.css`
- Create: `src/renderer/src/pages/ResumeOptimizer/ProjectEditor.tsx` + `ProjectEditor.module.css`
- (OptimizeModal 由 Task 7 提供，本任务的「优化」按钮先占位到 Task 7 完成后接上——见 Step 5 说明)

**Interfaces:**
- Consumes: `useResumeStore`（Task 5）；`OptimizeModal`（Task 7，本任务先在按钮处留 import 待 Task 7 完成）。
- Produces: 四个编辑组件（Task 8 的页面挂载）。

- [ ] **Step 1: BasicsForm.tsx + BasicsForm.module.css**

`BasicsForm.tsx`:
```tsx
import { useResumeStore } from '@renderer/stores/resumeStore'
import styles from './BasicsForm.module.css'

export function BasicsForm(): JSX.Element {
  const basics = useResumeStore((s) => s.resume.basics)
  const updateBasics = useResumeStore((s) => s.updateBasics)
  return (
    <section className={styles.form}>
      <label className={styles.field}>
        姓名
        <input value={basics.name} onChange={(e) => updateBasics({ name: e.target.value })} placeholder="张三" />
      </label>
      <label className={styles.field}>
        职位
        <input value={basics.title} onChange={(e) => updateBasics({ title: e.target.value })} placeholder="前端工程师" />
      </label>
      <label className={styles.field}>
        一句话概述
        <textarea
          value={basics.summary}
          onChange={(e) => updateBasics({ summary: e.target.value })}
          rows={2}
          placeholder="3 年前端经验，专注可视化与性能优化"
        />
      </label>
    </section>
  )
}
```

`BasicsForm.module.css`:
```css
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 520px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 13px;
  color: var(--color-text-muted);
}
.field input,
.field textarea {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
  resize: vertical;
}
.field input:focus,
.field textarea:focus {
  outline: none;
  border-color: var(--color-primary);
}
```

- [ ] **Step 2: SkillsEditor.tsx + SkillsEditor.module.css**

`SkillsEditor.tsx`:
```tsx
import { useState } from 'react'
import { useResumeStore } from '@renderer/stores/resumeStore'
import { OptimizeModal } from './OptimizeModal'
import styles from './SkillsEditor.module.css'

const LEVELS = ['了解', '掌握', '熟练', '精通']

export function SkillsEditor(): JSX.Element {
  const skills = useResumeStore((s) => s.resume.skills)
  const addSkill = useResumeStore((s) => s.addSkill)
  const updateSkill = useResumeStore((s) => s.updateSkill)
  const removeSkill = useResumeStore((s) => s.removeSkill)
  const [optimizing, setOptimizing] = useState<number | null>(null)

  return (
    <section className={styles.list}>
      {skills.map((skill, i) => (
        <div key={i} className={styles.item}>
          <div className={styles.row}>
            <input value={skill.name} onChange={(e) => updateSkill(i, { name: e.target.value })} placeholder="技能名（如 React）" />
            <select value={skill.level} onChange={(e) => updateSkill(i, { level: e.target.value })}>
              <option value="">熟练度</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <input value={skill.years} onChange={(e) => updateSkill(i, { years: e.target.value })} placeholder="年限（如 3 年）" />
            <button type="button" onClick={() => removeSkill(i)}>删除</button>
          </div>
          <div className={styles.row}>
            <input value={skill.note} onChange={(e) => updateSkill(i, { note: e.target.value })} placeholder="一句可验证说明" />
            <button type="button" onClick={() => setOptimizing(i)}>优化</button>
          </div>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={addSkill}>+ 添加技能</button>
      {optimizing !== null && (
        <OptimizeModal
          section="skill"
          initial={skills[optimizing]?.note ?? ''}
          onConfirm={(text) => {
            updateSkill(optimizing, { note: text })
            setOptimizing(null)
          }}
          onClose={() => setOptimizing(null)}
        />
      )}
    </section>
  )
}
```

`SkillsEditor.module.css`:
```css
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 720px;
}
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.row input,
.row select {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.row input:first-child { flex: 1; }
.row input:nth-child(2) { width: 160px; }
.row button {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 12px;
}
.add {
  align-self: flex-start;
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
}
```

- [ ] **Step 3: ExperienceEditor.tsx + ExperienceEditor.module.css**

`ExperienceEditor.tsx`:
```tsx
import { useState } from 'react'
import { useResumeStore } from '@renderer/stores/resumeStore'
import { OptimizeModal } from './OptimizeModal'
import styles from './ExperienceEditor.module.css'

interface Target {
  item: number
  bullet: number
}

export function ExperienceEditor(): JSX.Element {
  const experience = useResumeStore((s) => s.resume.experience)
  const addExperience = useResumeStore((s) => s.addExperience)
  const updateExperience = useResumeStore((s) => s.updateExperience)
  const removeExperience = useResumeStore((s) => s.removeExperience)
  const addBullet = useResumeStore((s) => s.addBullet)
  const updateBullet = useResumeStore((s) => s.updateBullet)
  const removeBullet = useResumeStore((s) => s.removeBullet)
  const [optimizing, setOptimizing] = useState<Target | null>(null)

  return (
    <section className={styles.list}>
      {experience.map((exp, i) => (
        <div key={i} className={styles.item}>
          <div className={styles.row}>
            <input value={exp.company} onChange={(e) => updateExperience(i, { company: e.target.value })} placeholder="公司" />
            <input value={exp.title} onChange={(e) => updateExperience(i, { title: e.target.value })} placeholder="职位" />
            <input value={exp.start} onChange={(e) => updateExperience(i, { start: e.target.value })} placeholder="开始（如 2020-07）" />
            <input value={exp.end} onChange={(e) => updateExperience(i, { end: e.target.value })} placeholder="结束（如 2024-06）" />
            <button type="button" onClick={() => removeExperience(i)}>删除</button>
          </div>
          {exp.bullets.map((b, j) => (
            <div key={j} className={styles.bulletRow}>
              <input value={b} onChange={(e) => updateBullet('experience', i, j, e.target.value)} placeholder="一句职责 / 成果" />
              <button type="button" title="删除该条" onClick={() => removeBullet('experience', i, j)}>×</button>
              <button type="button" onClick={() => setOptimizing({ item: i, bullet: j })}>优化</button>
            </div>
          ))}
          <button type="button" className={styles.addSmall} onClick={() => addBullet('experience', i)}>+ 添加条目</button>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={addExperience}>+ 添加工作经历</button>
      {optimizing && (
        <OptimizeModal
          section="experience"
          initial={experience[optimizing.item]?.bullets[optimizing.bullet] ?? ''}
          onConfirm={(text) => {
            updateBullet('experience', optimizing.item, optimizing.bullet, text)
            setOptimizing(null)
          }}
          onClose={() => setOptimizing(null)}
        />
      )}
    </section>
  )
}
```

`ExperienceEditor.module.css`:
```css
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 860px;
}
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.row input {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.row input:first-child { flex: 1; }
.row input:nth-child(2) { width: 140px; }
.row input:nth-child(3),
.row input:nth-child(4) { width: 110px; }
.bulletRow {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.bulletRow input {
  flex: 1;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.row button,
.bulletRow button {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 12px;
}
.add,
.addSmall {
  align-self: flex-start;
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
}
.addSmall {
  padding: var(--space-1) var(--space-2);
  font-size: 12px;
}
```

- [ ] **Step 4: ProjectEditor.tsx + ProjectEditor.module.css**

`ProjectEditor.tsx`:
```tsx
import { useState } from 'react'
import { useResumeStore } from '@renderer/stores/resumeStore'
import { OptimizeModal } from './OptimizeModal'
import styles from './ProjectEditor.module.css'

interface Target {
  item: number
  bullet: number
}

export function ProjectEditor(): JSX.Element {
  const projects = useResumeStore((s) => s.resume.projects)
  const addProject = useResumeStore((s) => s.addProject)
  const updateProject = useResumeStore((s) => s.updateProject)
  const removeProject = useResumeStore((s) => s.removeProject)
  const addBullet = useResumeStore((s) => s.addBullet)
  const updateBullet = useResumeStore((s) => s.updateBullet)
  const removeBullet = useResumeStore((s) => s.removeBullet)
  const addTag = useResumeStore((s) => s.addTag)
  const removeTag = useResumeStore((s) => s.removeTag)
  const [optimizing, setOptimizing] = useState<Target | null>(null)
  const [tagDraft, setTagDraft] = useState<{ item: number; value: string } | null>(null)

  return (
    <section className={styles.list}>
      {projects.map((proj, i) => (
        <div key={i} className={styles.item}>
          <div className={styles.row}>
            <input value={proj.name} onChange={(e) => updateProject(i, { name: e.target.value })} placeholder="项目名" />
            <input value={proj.role} onChange={(e) => updateProject(i, { role: e.target.value })} placeholder="角色" />
            <input value={proj.start} onChange={(e) => updateProject(i, { start: e.target.value })} placeholder="开始" />
            <input value={proj.end} onChange={(e) => updateProject(i, { end: e.target.value })} placeholder="结束" />
            <button type="button" onClick={() => removeProject(i)}>删除</button>
          </div>
          <textarea
            className={styles.description}
            value={proj.description}
            onChange={(e) => updateProject(i, { description: e.target.value })}
            rows={2}
            placeholder="一句话项目背景"
          />
          {proj.bullets.map((b, j) => (
            <div key={j} className={styles.bulletRow}>
              <input value={b} onChange={(e) => updateBullet('project', i, j, e.target.value)} placeholder="一句贡献 / 成果" />
              <button type="button" title="删除该条" onClick={() => removeBullet('project', i, j)}>×</button>
              <button type="button" onClick={() => setOptimizing({ item: i, bullet: j })}>优化</button>
            </div>
          ))}
          <button type="button" className={styles.addSmall} onClick={() => addBullet('project', i)}>+ 添加条目</button>
          <div className={styles.tags}>
            {proj.tags.map((t, j) => (
              <span key={j} className={styles.tag}>
                {t}
                <button type="button" title="移除标签" onClick={() => removeTag(i, j)}>×</button>
              </span>
            ))}
            <input
              className={styles.tagInput}
              value={tagDraft?.item === i ? tagDraft.value : ''}
              placeholder="+ 标签（回车添加）"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const v = tagDraft?.item === i ? tagDraft.value.trim() : ''
                if (v) addTag(i, v)
                setTagDraft({ item: i, value: '' })
              }}
              onChange={(e) => setTagDraft({ item: i, value: e.target.value })}
            />
          </div>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={addProject}>+ 添加项目经历</button>
      {optimizing && (
        <OptimizeModal
          section="project"
          initial={projects[optimizing.item]?.bullets[optimizing.bullet] ?? ''}
          onConfirm={(text) => {
            updateBullet('project', optimizing.item, optimizing.bullet, text)
            setOptimizing(null)
          }}
          onClose={() => setOptimizing(null)}
        />
      )}
    </section>
  )
}
```

`ProjectEditor.module.css`:
```css
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 860px;
}
.item {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.row input {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.row input:first-child { flex: 1; }
.row input:nth-child(2) { width: 130px; }
.row input:nth-child(3),
.row input:nth-child(4) { width: 100px; }
.description {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
  resize: vertical;
}
.bulletRow {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
.bulletRow input {
  flex: 1;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.row button,
.bulletRow button {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 12px;
}
.add,
.addSmall {
  align-self: flex-start;
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
}
.addSmall {
  padding: var(--space-1) var(--space-2);
  font-size: 12px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  align-items: center;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 12px;
  background: var(--color-surface);
}
.tag button {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-muted);
}
.tagInput {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: 12px;
  background: var(--color-surface);
  color: var(--color-text);
  width: 140px;
}
```

- [ ] **Step 5: 依赖说明**——四个组件都 `import { OptimizeModal } from './OptimizeModal'`。**必须先完成 Task 7 再验证本任务**（否则 typecheck 因缺文件失败）。若按顺序执行：先做 Task 7（OptimizeModal），再回来跑本任务 Step 5 的 typecheck。若严格串行执行，可在 Task 7 完成后的统一验证点跑。

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/ResumeOptimizer/BasicsForm.tsx src/renderer/src/pages/ResumeOptimizer/BasicsForm.module.css src/renderer/src/pages/ResumeOptimizer/SkillsEditor.tsx src/renderer/src/pages/ResumeOptimizer/SkillsEditor.module.css src/renderer/src/pages/ResumeOptimizer/ExperienceEditor.tsx src/renderer/src/pages/ResumeOptimizer/ExperienceEditor.module.css src/renderer/src/pages/ResumeOptimizer/ProjectEditor.tsx src/renderer/src/pages/ResumeOptimizer/ProjectEditor.module.css
git commit -m "feat(resume): 编辑区组件（基本信息 / 技能 / 工作经历 / 项目经历）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: OptimizeModal —— 单条 STAR 优化弹层

**Files:**
- Create: `src/renderer/src/pages/ResumeOptimizer/OptimizeModal.tsx` + `OptimizeModal.module.css`

**Interfaces:**
- Consumes: `useResumeStore().optimize`（Task 5）；`Star`/`OptimizeResult`（Task 1）；`useToast`。
- Produces: `<OptimizeModal section initial onConfirm onClose />`（Task 6 四个编辑器已引用）。

- [ ] **Step 1: 新建 `src/renderer/src/pages/ResumeOptimizer/OptimizeModal.tsx`**

```tsx
import { useState } from 'react'
import type { Star } from '@shared/types'
import { useToast } from '@renderer/components/Toast'
import { useResumeStore } from '@renderer/stores/resumeStore'
import styles from './OptimizeModal.module.css'

type Section = 'experience' | 'project' | 'skill'

const FIELD_LABELS: Record<keyof Star, string> = {
  situation: '情境',
  task: '任务',
  action: '行动',
  result: '结果'
}

interface OptimizeModalProps {
  section: Section
  initial: string // 预填当前条文字
  onConfirm: (text: string) => void // 确认回填：替换原条
  onClose: () => void
}

export function OptimizeModal({ section, initial, onConfirm, onClose }: OptimizeModalProps): JSX.Element {
  const toast = useToast()
  const optimize = useResumeStore((s) => s.optimize)
  const [input, setInput] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<Star | null>(null)
  const [source, setSource] = useState<'ai' | 'local' | null>(null)

  const run = async (): Promise<void> => {
    if (!input.trim()) {
      toast('请先输入要优化的描述', 'error')
      return
    }
    setLoading(true)
    const r = await optimize(section, input.trim())
    setLoading(false)
    if (r.ok) {
      setDraft(r.data.star)
      setSource(r.data.source)
    } else {
      toast(r.error.message, 'error')
    }
  }

  const confirm = (): void => {
    if (!draft) return
    // 拼接非占位段（跳过 [待补充…]），段间以「。」连接
    const text = [draft.situation, draft.task, draft.action, draft.result]
      .filter((s) => s && !s.startsWith('[待补充'))
      .join('。')
    onConfirm(text)
    onClose()
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.heading}>STAR 优化</h3>
        <textarea
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          placeholder="粘贴要优化的平淡描述"
        />
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => void run()} disabled={loading}>
            {loading ? '优化中…' : '优化'}
          </button>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        {draft && source && (
          <>
            <span className={`${styles.badge} ${source === 'ai' ? styles.ai : styles.local}`}>
              {source === 'ai' ? 'AI 优化' : '本地模板'}
            </span>
            {(Object.keys(FIELD_LABELS) as Array<keyof Star>).map((key) => (
              <label key={key} className={styles.field}>
                {FIELD_LABELS[key]}
                <textarea
                  className={styles.segment}
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  rows={2}
                />
              </label>
            ))}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={confirm}>确认回填</button>
              <button type="button" onClick={() => void run()}>重新优化</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

`OptimizeModal.module.css`:
```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: 560px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-surface);
}
.heading {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.input,
.segment {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
  resize: vertical;
}
.input:focus,
.segment:focus {
  outline: none;
  border-color: var(--color-primary);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 13px;
  color: var(--color-text-muted);
}
.actions {
  display: flex;
  gap: var(--space-2);
}
.actions button {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 13px;
}
.actions .primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.badge {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
}
.ai {
  background: rgba(22, 163, 74, 0.1);
  color: #16a34a;
}
.local {
  background: rgba(249, 115, 22, 0.1);
  color: #d97706;
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck`
Expected: 通过（此刻 OptimizeModal 已存在，Task 6 组件的 import 可解析；若 Task 6 尚未提交也先验本任务单独编译——OptimizeModal 自身不依赖编辑器组件）。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/ResumeOptimizer/OptimizeModal.tsx src/renderer/src/pages/ResumeOptimizer/OptimizeModal.module.css
git commit -m "feat(resume): OptimizeModal 单条 STAR 优化弹层（AI/本地角标 + 可编辑四段 + 确认回填）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: ResumeOptimizerPage —— 容器 + Tab + 顶栏 + 导航接入

**Files:**
- Create: `src/renderer/src/pages/ResumeOptimizer/ResumeOptimizerPage.tsx` + `ResumeOptimizerPage.module.css`
- Modify: `src/renderer/src/components/layout/SideNav.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `useResumeStore`（Task 5）；`BasicsForm`/`SkillsEditor`/`ExperienceEditor`/`ProjectEditor`（Task 6）；`window.api.resume.export/import`（Task 4）。
- Produces: 导航第 5 项「简历」+ 五路页面分支。

- [ ] **Step 1: 新建 `src/renderer/src/pages/ResumeOptimizer/ResumeOptimizerPage.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useToast } from '@renderer/components/Toast'
import { useResumeStore } from '@renderer/stores/resumeStore'
import { BasicsForm } from './BasicsForm'
import { SkillsEditor } from './SkillsEditor'
import { ExperienceEditor } from './ExperienceEditor'
import { ProjectEditor } from './ProjectEditor'
import styles from './ResumeOptimizerPage.module.css'

type Tab = 'basics' | 'skills' | 'experience' | 'projects'

const TAB_LABELS: Record<Tab, string> = {
  basics: '基本信息',
  skills: '技能',
  experience: '工作经历',
  projects: '项目经历'
}

export function ResumeOptimizerPage(): JSX.Element {
  const toast = useToast()
  const loaded = useResumeStore((s) => s.loaded)
  const dirty = useResumeStore((s) => s.dirty)
  const saving = useResumeStore((s) => s.saving)
  const error = useResumeStore((s) => s.error)
  const load = useResumeStore((s) => s.load)
  const save = useResumeStore((s) => s.save)
  const replaceAll = useResumeStore((s) => s.replaceAll)
  const [tab, setTab] = useState<Tab>('basics')

  useEffect(() => {
    void load()
  }, [load])

  const onExport = async (type: 'markdown' | 'json'): Promise<void> => {
    // 导出所见即所得：传当前内存态 resume（未保存的编辑也导出）
    const resume = useResumeStore.getState().resume
    const r = await window.api.resume.export({ type, resume })
    if (r.ok) {
      if (r.data) toast(`已导出：${r.data.path}`, 'success')
      else toast('已取消导出', 'info')
    } else {
      toast(r.error.message, 'error')
    }
  }

  const onImport = async (): Promise<void> => {
    const r = await window.api.resume.import()
    if (!r.ok) {
      toast(r.error.message, 'error')
      return
    }
    if (!r.data) return // 用户取消
    if (!window.confirm('导入将覆盖当前简历（未保存修改也会被替换），确定？')) return
    replaceAll(r.data)
    toast('已导入，点击「保存」生效', 'success')
  }

  const onSave = async (): Promise<void> => {
    const ok = await save()
    toast(ok ? '已保存' : (useResumeStore.getState().error ?? '保存失败'), ok ? 'success' : 'error')
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>简历优化</h1>
        <div className={styles.toolbar}>
          <button type="button" onClick={() => void onExport('markdown')}>导出 Markdown</button>
          <button type="button" onClick={() => void onExport('json')}>导出 JSON</button>
          <button type="button" onClick={() => void onImport()}>导入 JSON</button>
          <button
            type="button"
            className={dirty ? styles.primary : undefined}
            onClick={() => void onSave()}
            disabled={saving}
          >
            {saving ? '保存中…' : dirty ? '保存（有未保存修改）' : '保存'}
          </button>
        </div>
      </header>
      <nav className={styles.tabs}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? styles.active : undefined}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>
      {error && <div className={styles.error}>{error}</div>}
      {!loaded ? (
        <p className={styles.hint}>加载中…</p>
      ) : (
        <>
          {tab === 'basics' && <BasicsForm />}
          {tab === 'skills' && <SkillsEditor />}
          {tab === 'experience' && <ExperienceEditor />}
          {tab === 'projects' && <ProjectEditor />}
        </>
      )}
    </div>
  )
}
```

`ResumeOptimizerPage.module.css`:
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
}
.toolbar button {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 13px;
}
.toolbar .primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.tabs {
  display: flex;
  gap: var(--space-2);
  border-bottom: 1px solid var(--color-border);
  padding-bottom: var(--space-2);
}
.tabs button {
  padding: var(--space-2) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text-muted);
}
.tabs .active {
  background: var(--color-surface);
  border-color: var(--color-border);
  color: var(--color-text);
  font-weight: 600;
}
.error {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
}
.hint {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}
```

- [ ] **Step 2: `src/renderer/src/components/layout/SideNav.tsx` 加「简历」页**

```ts
export type PageId = 'system' | 'files' | 'adblock' | 'resume' | 'settings'
```
```ts
  { id: 'adblock', label: '广告屏蔽' },
  { id: 'resume', label: '简历' },
  { id: 'settings', label: '设置' }
```

- [ ] **Step 3: `src/renderer/src/App.tsx` 五路分支**

```tsx
import { ResumeOptimizerPage } from './pages/ResumeOptimizer/ResumeOptimizerPage'
```
```tsx
        {page === 'system' ? (
          <SystemOverviewPage />
        ) : page === 'files' ? (
          <FileManagerPage />
        ) : page === 'adblock' ? (
          <AdBlockerPage />
        ) : page === 'resume' ? (
          <ResumeOptimizerPage />
        ) : (
          <SettingsPage />
        )}
```

- [ ] **Step 4: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/ResumeOptimizer/ResumeOptimizerPage.tsx src/renderer/src/pages/ResumeOptimizer/ResumeOptimizerPage.module.css src/renderer/src/components/layout/SideNav.tsx src/renderer/src/App.tsx
git commit -m "feat(resume): 简历优化页面（Tab 编辑 + 导出/导入 + 保存）+ 导航接入

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: 文档同步

**Files:**
- Modify: `docs/modules/resume-optimizer.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/README.md`
- Modify: `docs/API_SPEC.md`

**Interfaces:**
- Consumes: 本计划全部交付物；现有文档锚点。

- [ ] **Step 1: `docs/modules/resume-optimizer.md` 更新为已落地**

在文件顶部 `# 模块设计：简历优化（resume-optimizer）` 之后加状态行：
```markdown
> 状态：阶段 5 已落地（2026-08-18，见 §7）。核心裁定：单条 STAR 改写（AI 优先 / 本地规则兜底不编造）、显式保存、导出 Markdown + 导入导出 JSON。
```
§3 IPC 接口下更新：补 `resume:export` / `resume:import` 两行描述；`OptimizeResult` 注明含 `source` 字段。
§7 验收标准全部勾选为 `[x]`。

- [ ] **Step 2: `docs/ARCHITECTURE.md` §5.1 补状态**

在 §5.1（约第 85 行 `### 5.1 简历与图表的 AI 能力：可配置后端 + 本地兜底`）标题下、`**背景**` 之后加一行：
```markdown
**状态**：已落地（阶段 5，2026-08-18）。`services/resume.service.ts` 的 `optimize()` 直接调用 `main/ai/adapter.ts` 的 `complete(prompt, schema?)`，AI 失败 / 未配置时走本地 STAR 规则兜底（见 `modules/resume-optimizer.md`）。图表模块（阶段 6）将复用同一契约。
```

- [ ] **Step 3: `docs/README.md` §135-138 阶段 5 状态行**

把：
```markdown
### 阶段 5 · 简历优化模块（目标：STAR 闭环）
```
改为：
```markdown
### 阶段 5 · 简历优化模块（目标：STAR 闭环）✅ 已落地
```
并在该节末尾（`- **验收**：...` 之后）补：
```markdown
- **状态**：已落地并验收通过（2026-08-18，见 `modules/resume-optimizer.md` §7）。
```

- [ ] **Step 4: `docs/API_SPEC.md` §6 更新**

- `OptimizeResult` 接口补 `source: 'ai' | 'local'` 字段。
- 通道表加两行：
```markdown
| `resume:export` | `{ type: 'markdown' \| 'json'; resume: Resume }` | `{ path: string } \| null` |
| `resume:import` | — | `Resume \| null` |
```
- 在 §6 说明段补一句：`resume:export` 由渲染层传入当前内存态简历（所见即所得）；`resume:import` 走主进程对话框读 JSON 并校验。

- [ ] **Step 5: 验证**

Run: `npm run typecheck`
Expected: 通过（文档改动不影响编译）。

- [ ] **Step 6: Commit**

```bash
git add docs/modules/resume-optimizer.md docs/ARCHITECTURE.md docs/README.md docs/API_SPEC.md
git commit -m "docs: 阶段 5 · 简历优化模块落地记录（模块文档 / 架构 / README / API 规范）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review 核对（计划作者已执行）

**1. Spec 覆盖：**
- §1 目标（STAR 闭环、AI 优先本地兜底、导入导出）→ Task 3（引擎）+ Task 4（导入导出 IPC）+ Task 8（页面）。
- §3.1 文件结构 → Task 1-9 逐一对应。
- §3.2 数据模型（Resume 全字段）→ Task 1。
- §3.3 优化引擎（prompt 按 section、JsonSchema、catch 四码兜底、localOptimize 信号词切分 + 待补充标注）→ Task 3。
- §3.4 导入导出（buildMarkdown / dialog / JSON 校验）→ Task 3（buildMarkdown + validateResume）+ Task 4（dialog + fs）。
- §4 IPC 五通道 → Task 4。
- §5 错误处理（AI 码不外泄、VALIDATION_ERROR）→ Task 3（catch）+ Task 4（校验）。
- §6 UI（Page + 四编辑器 + OptimizeModal + store）→ Task 5-8。
- §7 验收 → 各任务验证 + 人工 E2E。

**2. 占位符扫描：** 全部代码块为完整可执行代码；无 TBD / TODO / 「写上面所述测试」类占位。唯一跨任务引用是 Task 6 → Task 7 的 `OptimizeModal` import，已在 Task 6 Step 5 显式说明执行顺序。

**3. 类型一致性：**
- `Star` / `OptimizeResult`（含 `source`）：Task 1 定义 → Task 3 产出 → Task 7 消费，字段一致。
- `resumeRepository.load(): Resume | null` / `save(resume): Resume`：Task 2 定义 → Task 4 使用。
- `optimize(section, input)` / `buildMarkdown(resume)` / `validateResume(value)`：Task 3 定义 → Task 4 使用（签名一致）。
- `ResumeApi` 五方法签名：Task 1 定义 → Task 4 preload 实现 → Task 5/8 消费，逐一对应。
- `useResumeStore` 方法名：Task 5 定义 → Task 6-8 使用，一致（`updateBullet` 三处、`addTag`/`removeTag`、`optimize(section, input)`）。
- CSS 变量均为既有 tokens：`--space-1..4` / `--color-*` / `--radius` / `--radius-sm` / `--color-primary`（无 `--radius-md`）。

**4. 计划级裁定（非 spec 逐字，供评审 triage）：**
- `resume:export` 参数由 spec 的 `{ type }` 精确化为 `{ type, resume }`（渲染层传内存态，导出所见即所得，避免「先保存才能导出」的隐式耦合）——已在 Global Constraints 声明。
- `resume:save` 也过 `validateResume`（防御性，防非法写入）。
- 本地兜底 classifier 为 section 通用（skill 仅结果占位文案不同）——实现简化，产出仍是四段结构，符合 spec「产出结构、不编造」。
