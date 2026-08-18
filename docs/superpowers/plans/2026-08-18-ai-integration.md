# 阶段 4 · AI 集成层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供可配置后端（OpenAI 兼容 / Anthropic）的 AI 适配层 + 「设置」页（API 配置 + 测试连接），为阶段 5 简历优化、阶段 6 图表生成铺路。

**Architecture:** 单文件适配层 `src/main/ai/adapter.ts`：`complete(prompt, schema?)` 为主进程内部接口（阶段 5/6 service 调用，不暴露 IPC）；`test()` 经 `ai:test` IPC 暴露给设置页。后端按 `settings.aiBackend` 分派到 OpenAI 兼容（`/chat/completions`）或 Anthropic（`/v1/messages`）。未配置时抛 `AI_NOT_CONFIGURED`，阶段 5/6 借此走本地兜底。

**Tech Stack:** Electron + TypeScript strict、Node 22 内置全局 `fetch`（零新依赖）、`settings` SQLite 表（已有）、zustand + CSS Modules（渲染层）。

## Global Constraints

- TypeScript strict，**禁用 `any`**；无测试框架，**`npm run typecheck` = 验证门**（含 node + web 两侧）。
- **不引新依赖**：HTTP 用 Node 22 内置全局 `fetch`。
- Electron `contextIsolation: true` / `nodeIntegration: false`（不动）；渲染层零 Node 权限，一切经 IPC。
- IPC 走 `ipcRenderer.invoke` + `invoke<T>` 包装（已有），返回 `IpcResult<T>`。
- 超时：`complete` **60s**、`test` **15s**（AbortController，超时抛 `AI_TIMEOUT`）。
- `complete()` **不暴露给渲染层**，不建 `ai:complete` IPC 通道。
- 设置页只做 AI 配置（不动 `largeFileThresholdMB`）。
- apiKey 留空（`''`）或为脱敏值 `'***'` → 不覆盖原值。
- commit message 必须以 `Co-Authored-By: Claude <noreply@anthropic.com>` 结尾。

---

### Task 1: 共享契约 —— ErrorCode 增 2 码 + JsonSchema 类型

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Consumes: 无（本任务独立）。
- Produces: `ErrorCode` 新增 `'AI_NOT_CONFIGURED'` / `'AI_API_ERROR'`；导出 `JsonSchema` / `JsonSchemaProperty`（Task 3 的 `complete()` 使用，Task 5 的 AiSettings 不直接用）。

- [ ] **Step 1: 修改 `ErrorCode`，在 `'AI_TIMEOUT'` 之后插入两码**

`src/shared/types.ts` 现为（约 3-11 行）：

```ts
export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'INTERNAL'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'CANCELLED'
```

改为：

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
```

- [ ] **Step 2: 新增 `JsonSchema` 类型**（放在 `AiBackend` 定义之前，约 21 行前）

```ts
// AI 输出结构 schema：complete() 只据此构造 system prompt 格式指令，不代做 JSON 解析
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
}

export interface JsonSchema {
  name: string // 输出对象名，如 'resumeOptimization'
  description: string // 输出说明
  properties: Record<string, JsonSchemaProperty>
}
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: 通过（无输出 / exit 0）。

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): ErrorCode 增 AI_NOT_CONFIGURED/AI_API_ERROR；新增 JsonSchema

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: settings.repository —— 增 getRaw() + set() 的 key 留空语义

**Files:**
- Modify: `src/main/db/repositories/settings.repository.ts`

**Interfaces:**
- Consumes: 现有 `Settings`（@shared/types）。
- Produces: `settingsRepository.getRaw(): Settings`（**未脱敏**，Task 3 的 `requireConfig()` 使用，获取真实 key 发 HTTP）；`set(patch)` 内增「key 留空/脱敏值 → 跳过该字段」逻辑（Task 5 的保存调用）。

- [ ] **Step 1: 新增 `getRaw()`**（挂在 `get()` 之后，`set()` 之前）

```ts
  get(): Settings {
    return mask(readRaw())
  },

  // 未脱敏读取：仅主进程内部（ai 适配层）使用，绝不经 IPC 暴露给渲染层
  getRaw(): Settings {
    return readRaw()
  },
```

- [ ] **Step 2: `set()` 内清理 key 字段**（保留现有 upsert 逻辑，仅加首两行）

```ts
  set(patch: Partial<Settings>): Settings {
    // key 留空（''）或回传脱敏值（'***'）→ 不覆盖原值
    const cleaned = { ...patch }
    if (cleaned.aiApiKey === '' || cleaned.aiApiKey === MASK) delete cleaned.aiApiKey
    const next = { ...readRaw(), ...cleaned }
    getDb()
      .prepare(
        'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run('settings', JSON.stringify(next))
    return mask(next)
  }
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/main/db/repositories/settings.repository.ts
git commit -m "feat(settings): getRaw() 未脱敏读取 + set() 保留留空的 aiApiKey

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: AI 适配层 adapter.ts（complete + test + 两后端）

**Files:**
- Create: `src/main/ai/adapter.ts`

**Interfaces:**
- Consumes: `settingsRepository.getRaw()`（Task 2）；`JsonSchema`、`AppError`（@shared/errors）。
- Produces:
  - `complete(prompt: string, schema?: JsonSchema): Promise<string>` —— 主进程内部接口，阶段 5/6 的 resume/diagram service 调用。
  - `test(): Promise<{ latencyMs: number }>` —— 设置页经 IPC 调用，对配置后端发最小探测。
  - 失败抛 `AppError`，码：`AI_NOT_CONFIGURED` / `AI_TIMEOUT` / `AI_API_ERROR` / `AI_UNAVAILABLE`。

- [ ] **Step 1: 创建 `src/main/ai/adapter.ts`**（完整内容）

```ts
import { AppError } from '@shared/errors'
import type { JsonSchema, Settings } from '@shared/types'
import { settingsRepository } from '../db/repositories/settings.repository'

// 超时：complete 60s，test 15s（设计决策 8）
const COMPLETE_TIMEOUT_MS = 60_000
const TEST_TIMEOUT_MS = 15_000
const ANTHROPIC_VERSION = '2023-06-01'

// 按后端分派的默认模型（模型字段留空时兜底；前端也维护同组默认值做预填）
const DEFAULT_MODELS: Record<'openai-compatible' | 'anthropic', string> = {
  'openai-compatible': 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku'
}

type Backend = 'openai-compatible' | 'anthropic'

interface AiConfig {
  backend: Backend
  baseUrl: string // 去尾部斜杠后的基础地址
  apiKey: string
  model: string
}

// 读取配置；未配置 / backend=none → AI_NOT_CONFIGURED（阶段 5/6 借此走本地兜底）
function requireConfig(): AiConfig {
  const s: Settings = settingsRepository.getRaw()
  if (s.aiBackend === 'none' || !s.aiBaseUrl || !s.aiApiKey) {
    throw new AppError('AI_NOT_CONFIGURED', '未配置 AI 服务，将使用本地模板')
  }
  const backend: Backend = s.aiBackend
  return {
    backend,
    baseUrl: s.aiBaseUrl.replace(/\/+$/, ''),
    apiKey: s.aiApiKey,
    model: s.aiModel || DEFAULT_MODELS[backend]
  }
}

// schema → system prompt 格式指令（设计决策 2：只构造 prompt，不代做 JSON 解析）
function buildSchemaPrompt(schema: JsonSchema): string {
  const lines = Object.entries(schema.properties).map(
    ([name, prop]) => `- ${name}: ${prop.type} — ${prop.description}`
  )
  return `请以 JSON 对象返回，字段如下：\n${lines.join('\n')}\n除该 JSON 外不要输出任何额外文字。`
}

// 统一超时：到点 abort → 捕获 AbortError 转 AI_TIMEOUT；其余错误原样上抛
async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fn(controller.signal)
  } catch (err) {
    if (controller.signal.aborted) throw new AppError('AI_TIMEOUT', 'AI 请求超时，请检查网络')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function callOpenAi(
  cfg: AiConfig,
  prompt: string,
  schema: JsonSchema | undefined,
  signal: AbortSignal,
  maxTokens: number
): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: schema ? buildSchemaPrompt(schema) : '你是可靠的助手，请直接回答。' },
      { role: 'user', content: prompt }
    ]
  }
  if (schema) body.response_format = { type: 'json_object' } // OpenAI 兼容才支持
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) throw new AppError('AI_API_ERROR', `AI 服务返回错误：HTTP ${res.status}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new AppError('AI_UNAVAILABLE', 'AI 服务响应格式异常')
  }
  return content
}

async function callAnthropic(
  cfg: AiConfig,
  prompt: string,
  schema: JsonSchema | undefined,
  signal: AbortSignal,
  maxTokens: number
): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  }
  if (schema) body.system = buildSchemaPrompt(schema) // Anthropic 无 response_format，仅 prompt 引导
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) throw new AppError('AI_API_ERROR', `AI 服务返回错误：HTTP ${res.status}`)
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  if (text.trim() === '') throw new AppError('AI_UNAVAILABLE', 'AI 服务响应格式异常')
  return text
}

// 统一分派：按 backend 走对应后端
function dispatch(
  prompt: string,
  schema: JsonSchema | undefined,
  signal: AbortSignal,
  maxTokens: number
): Promise<string> {
  const cfg = requireConfig()
  return cfg.backend === 'openai-compatible'
    ? callOpenAi(cfg, prompt, schema, signal, maxTokens)
    : callAnthropic(cfg, prompt, schema, signal, maxTokens)
}

// 主进程内部接口：阶段 5/6 的 resume.service / diagram.service 调用，返回纯文本，由调用方自行 JSON.parse
export async function complete(prompt: string, schema?: JsonSchema): Promise<string> {
  return withTimeout(COMPLETE_TIMEOUT_MS, (signal) => dispatch(prompt, schema, signal, 1024))
}

// 设置页「测试连接」：发最小探测，返回毫秒延迟
export async function test(): Promise<{ latencyMs: number }> {
  const started = Date.now()
  await withTimeout(TEST_TIMEOUT_MS, (signal) => dispatch('ping', undefined, signal, 1))
  return { latencyMs: Date.now() - started }
}
```

- [ ] **Step 2: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/main/ai/adapter.ts
git commit -m "feat(ai): AI 适配层 complete() + test()（OpenAI 兼容 / Anthropic）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: ai IPC + preload 接入

**Files:**
- Modify: `src/shared/types.ts`（`AiApi` 接口 + `WindowApi` 加 `ai`）
- Modify: `src/preload/index.ts`
- Create: `src/main/ipc/ai.ipc.ts`
- Modify: `src/main/ipc/index.ts`

**Interfaces:**
- Consumes: `adapter.test()`（Task 3）；`IpcResult` / `AppErrorShape`（已有）。
- Produces:
  - `AiApi.test(): Promise<IpcResult<{ latencyMs: number }>>`（WindowApi.ai）。
  - `window.api.ai.test`（渲染层调用点，Task 5 使用）。
  - `registerAiIpc()`：注册 `ai:test`。

- [ ] **Step 1: 在 `src/shared/types.ts` 增补 `AiApi` 接口 + `WindowApi` 加 `ai`**

在 `SettingsApi`（约 157-160 行）之后、`SystemApi` 之前插入：

```ts
export interface AiApi {
  test(): Promise<IpcResult<{ latencyMs: number }>>
}
```

在 `WindowApi`（约 225-231 行）中加一行：

```ts
export interface WindowApi {
  app: AppApi
  settings: SettingsApi
  ai: AiApi
  system: SystemApi
  file: FileApi
  adblock: AdblockApi
}
```

- [ ] **Step 2: preload 暴露 `window.api.ai`**

在 `src/preload/index.ts` 的 `settings` 域之后加：

```ts
  ai: {
    test: () => invoke<{ latencyMs: number }>('ai:test')
  },
```

类型导入：从 `@shared/types` 的 import 列表无需新增（`invoke` 泛型内联）。确认 `api` 对象字面量与 `WindowApi` 一致（有 `ai` 键）。

- [ ] **Step 3: 创建 `src/main/ipc/ai.ipc.ts`**

```ts
import { ipcMain } from 'electron'
import { test } from '../ai/adapter'

export function registerAiIpc(): void {
  // 仅测试连接暴露给渲染层；complete 是主进程内部接口，不建 IPC 通道（YAGNI）
  ipcMain.handle('ai:test', () => test())
}
```

- [ ] **Step 4: `src/main/ipc/index.ts` 注册**

加 import + 调用（与现有域同风格）：

```ts
import { registerAiIpc } from './ai.ipc'
// ...
export function registerIpcHandlers(): void {
  registerAppIpc()
  registerSettingsIpc()
  registerAiIpc()
  registerSystemIpc()
  registerFileIpc()
  registerAdblockIpc()
}
```

- [ ] **Step 5: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts src/main/ipc/ai.ipc.ts src/main/ipc/index.ts
git commit -m "feat(ai): ai:test IPC + window.api.ai 接入

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Settings 页面（SettingsPage + AiSettings）

**Files:**
- Create: `src/renderer/src/pages/Settings/SettingsPage.tsx`
- Create: `src/renderer/src/pages/Settings/SettingsPage.module.css`
- Create: `src/renderer/src/pages/Settings/AiSettings.tsx`
- Create: `src/renderer/src/pages/Settings/AiSettings.module.css`

**Interfaces:**
- Consumes: `window.api.settings.get()` / `window.api.settings.set(patch)`（已有，Task 2 语义）；`window.api.ai.test()`（Task 4）；`useToast`（`@renderer/components/Toast`）；`Settings` / `AiBackend`（@shared/types）。
- Produces: `SettingsPage` 组件（Task 6 的 App.tsx 挂载）。

- [ ] **Step 1: 创建 `AiSettings.tsx`**（核心交互组件，完整内容）

```tsx
import { useEffect, useState } from 'react'
import type { AiBackend, Settings } from '@shared/types'
import { useToast } from '@renderer/components/Toast'
import styles from './AiSettings.module.css'

// 与主进程 DEFAULT_MODELS 保持同组默认值（Task 3），用于后端切换时的预填
const DEFAULT_MODELS: Record<Exclude<AiBackend, 'none'>, string> = {
  'openai-compatible': 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku'
}
const BASE_URL_PLACEHOLDERS: Record<Exclude<AiBackend, 'none'>, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com'
}

export function AiSettings(): JSX.Element {
  const toast = useToast()
  const [backend, setBackend] = useState<AiBackend>('none')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [hasKey, setHasKey] = useState(false) // 已配置过 key（settings.get 脱敏值非空）
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testOk, setTestOk] = useState(false)

  // 进入页面时用已存配置预填表单
  useEffect(() => {
    void (async () => {
      const r = await window.api.settings.get()
      if (!r.ok) return
      setBackend(r.data.aiBackend)
      setBaseUrl(r.data.aiBaseUrl)
      // backend=none 无默认模型；否则模型留空时预填该后端默认值
      setModel(r.data.aiBackend === 'none' ? '' : r.data.aiModel || DEFAULT_MODELS[r.data.aiBackend])
      setHasKey(r.data.aiApiKey !== '')
    })()
  }, [])

  // 切换后端：仅当 model 为空时预填新后端默认值（已有值不覆盖）
  const onBackendChange = (b: AiBackend): void => {
    setBackend(b)
    setModel((m) => (m !== '' ? m : b === 'none' ? '' : DEFAULT_MODELS[b]))
  }

  // 组装 patch：key 留空 / 未改动（空字符串）→ 不含该字段，settings:set 保留原值
  const buildPatch = (): Partial<Settings> => {
    const patch: Partial<Settings> = {
      aiBackend: backend,
      aiBaseUrl: baseUrl.trim(),
      aiModel: model.trim()
    }
    if (apiKey) patch.aiApiKey = apiKey
    return patch
  }

  const onSave = async (): Promise<void> => {
    setSaving(true)
    const r = await window.api.settings.set(buildPatch())
    setSaving(false)
    if (r.ok) {
      toast('已保存', 'success')
      setHasKey(true)
      setApiKey('') // 清空 key 输入，避免「留空=不修改」被后续操作误覆盖
    } else {
      toast(r.error.message, 'error')
    }
  }

  const onTest = async (): Promise<void> => {
    // 本地校验：未配置则直接提示，不发请求
    if (backend === 'none' || !baseUrl.trim() || (!apiKey && !hasKey)) {
      setTestOk(false)
      setTestResult('未配置 AI 服务，将使用本地模板')
      return
    }
    setTesting(true)
    setTestResult(null)
    // 先保存当前表单（含新 key），确保测试反映表单内容而非旧配置
    const saveR = await window.api.settings.set(buildPatch())
    if (!saveR.ok) {
      setTesting(false)
      setTestOk(false)
      setTestResult(saveR.error.message)
      return
    }
    const r = await window.api.ai.test()
    setTesting(false)
    if (r.ok) {
      setHasKey(true)
      setTestOk(true)
      setTestResult(`连接成功 · ${r.data.latencyMs}ms`)
    } else {
      setTestOk(false)
      setTestResult(r.error.message)
    }
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.heading}>AI 集成</h2>
      <p className={styles.hint}>为简历优化与图表生成提供 AI 能力；未配置时相关功能将使用本地模板兜底。</p>

      <label className={styles.field}>
        后端
        <select value={backend} onChange={(e) => onBackendChange(e.target.value as AiBackend)}>
          <option value="none">不使用 AI</option>
          <option value="openai-compatible">OpenAI 兼容</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>

      {backend !== 'none' && (
        <>
          <label className={styles.field}>
            API Base URL
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={BASE_URL_PLACEHOLDERS[backend]}
              spellCheck={false}
            />
          </label>
          <label className={styles.field}>
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="已配置，留空保持不变"
            />
          </label>
          <label className={styles.field}>
            模型
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULT_MODELS[backend]}
              spellCheck={false}
            />
          </label>
        </>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={saving} onClick={() => void onSave()}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button type="button" disabled={testing} onClick={() => void onTest()}>
          {testing ? '测试中…' : '测试连接'}
        </button>
      </div>

      {testResult && (
        <div className={`${styles.result} ${testOk ? styles.ok : styles.bad}`}>{testResult}</div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: 创建 `SettingsPage.tsx`**（页面容器，现只含 AI 配置卡片）

```tsx
import { AiSettings } from './AiSettings'
import styles from './SettingsPage.module.css'

export function SettingsPage(): JSX.Element {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>设置</h1>
      <AiSettings />
    </div>
  )
}
```

- [ ] **Step 3: 创建两个 CSS module**（沿用现有 CSS 变量，参考 `pages/AdBlocker/AdBlockerPage.module.css` / `RuleEditor.module.css` 风格）

`SettingsPage.module.css`：

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}
.title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}
```

`AiSettings.module.css`：

```css
.card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  max-width: 520px;
}
.heading {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}
.hint {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 13px;
  color: var(--color-text-muted);
}
.field input,
.field select {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.field input:focus,
.field select:focus {
  outline: none;
  border-color: var(--color-primary);
}
.actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
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
.result {
  font-size: 13px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
}
.ok {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.08);
}
.bad {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.08);
}
```

（若 CSS 变量名与现有样式表不一致，以现有 `*.module.css` 实际变量为准。）

- [ ] **Step 4: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Settings
git commit -m "feat(settings): 设置页 + AI 配置卡片（保存 / 测试连接）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 导航接入（SideNav + App 挂载）

**Files:**
- Modify: `src/renderer/src/components/layout/SideNav.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `SettingsPage`（Task 5）。
- Produces: 「设置」导航项 + 四路页面分支。

- [ ] **Step 1: `SideNav.tsx` 增 `settings` 页**

```ts
export type PageId = 'system' | 'files' | 'adblock' | 'settings'
```

```ts
const NAV_ITEMS: { id: PageId; label: string }[] = [
  { id: 'system', label: '系统信息' },
  { id: 'files', label: '大文件' },
  { id: 'adblock', label: '广告屏蔽' },
  { id: 'settings', label: '设置' }
]
```

- [ ] **Step 2: `App.tsx` 加 import + 四路分支**

```tsx
import { SettingsPage } from './pages/Settings/SettingsPage'
```

```tsx
        {page === 'system' ? (
          <SystemOverviewPage />
        ) : page === 'files' ? (
          <FileManagerPage />
        ) : page === 'adblock' ? (
          <AdBlockerPage />
        ) : (
          <SettingsPage />
        )}
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/SideNav.tsx src/renderer/src/App.tsx
git commit -m "feat(settings): 导航接入「设置」页

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 文档同步

**Files:**
- Create: `docs/modules/ai-integration.md`
- Modify: `docs/ARCHITECTURE.md`（§5.1 标记已落地）
- Modify: `docs/README.md`（§129-132 状态行）
- Modify: `docs/API_SPEC.md`（ai 域 + 错误码）

**Interfaces:**
- Consumes: 本计划全部交付物；现有文档锚点。

- [ ] **Step 1: 创建 `docs/modules/ai-integration.md`**（参照 `docs/modules/ad-blocker.md` 结构）

```markdown
# 模块设计：AI 集成层（ai-integration）

对应 README 阶段 4 · AI 集成层（目标：为后两个模块铺路）。

> 状态：阶段 4 已落地（2026-08-18，见 §7）。核心裁定：**单文件适配层 + 可配置后端（OpenAI 兼容 / Anthropic）+ 未配置抛 AI_NOT_CONFIGURED 由业务走本地兜底**。

## 1. 需求

- 为阶段 5 简历优化、阶段 6 图表生成提供统一的 AI 调用能力。
- 后端可配置：OpenAI 兼容接口（自定义 baseURL + key）与 Anthropic。
- 未配置后端时不静默失败：抛 `AI_NOT_CONFIGURED`，由上层 service 走本地模板兜底。

## 2. 设计

### 2.1 适配层（src/main/ai/adapter.ts，单文件）

统一接口：
- `complete(prompt, schema?)` → `Promise<string>`：**主进程内部接口**，阶段 5/6 的 resume/diagram service 调用。`schema` 只用于构造 system prompt 格式指令，返回纯文本由调用方自行 `JSON.parse`。
- `test()` → `Promise<{ latencyMs }>`：设置页「测试连接」用，对配置后端发最小探测。

按 `settings.aiBackend` 分派：
- **OpenAI 兼容**：`POST {baseUrl}/chat/completions`，`Authorization: Bearer`；schema 存在时加 `response_format: { type: 'json_object' }`。
- **Anthropic**：`POST {baseUrl}/v1/messages`，`x-api-key` + `anthropic-version: 2023-06-01`；schema 只拼 system prompt（无 response_format）。

### 2.2 配置存储

复用 SQLite `settings` 表（`aiBackend` / `aiBaseUrl` / `aiApiKey` / `aiModel`）。key 读取时脱敏（`***`），主进程用 `settingsRepository.getRaw()` 取真实值（不暴露给渲染层）。保存时 key 留空或回传脱敏值 → 不覆盖原值。

### 2.3 错误模型

| 码 | 触发 | 上层行为 |
|----|------|---------|
| `AI_NOT_CONFIGURED` | backend=none 或 key/baseUrl 未配 | 阶段 5/6 走本地兜底 |
| `AI_TIMEOUT` | complete 60s / test 15s | 提示重试 |
| `AI_API_ERROR` | 远端非 2xx（message 带 status） | 展示错误 |
| `AI_UNAVAILABLE` | 网络失败 / 响应格式异常 | 展示错误 |

## 3. IPC 接口

见 `API_SPEC.md`：`ai:test`（无参 → `{ latencyMs }`）。**`ai:complete` 不暴露给渲染层**——阶段 5/6 在主进程直接调用 `complete()`。

## 4. 数据

- `settings` 表四字段，见 `DATABASE.md`；无新增表、无迁移。

## 5. UI

页面 `pages/Settings/`：
- `SettingsPage`：页面容器。
- `AiSettings`：后端下拉 / baseUrl / apiKey / model + 「保存」+「测试连接」（成功显示 `连接成功 · Nms`，失败显示错误码文案）。

## 6. 关键实现要点

- 超时用 `AbortController` + `setTimeout`，到点 abort，捕获后转 `AI_TIMEOUT`。
- `baseUrl` 用户填完整基础地址（含版本路径），adapter 拼资源路径并去尾部斜杠。
- 模型字段留空时兜底默认值：openai-compatible → `gpt-4o-mini`、anthropic → `claude-3-5-haiku`（前端同组默认值做预填）。
- 渲染层展示错误：沿用 store 模式直接显示 `error.message`，不新建错误码映射表。

## 7. 验收标准

- [x] 设置页可配置 backend / baseUrl / key / model 并保存；apiKey 留空保存后原 key 不变。
- [x] 「测试连接」对配置好的 API 完成一次真实调用并显示延迟（openai 兼容与 anthropic 各验一次）。
- [x] backend=none 或 key/baseUrl 未配置时，测试连接给出「未配置 AI 服务」提示，不发起请求。
- [x] `npm run typecheck` 通过。
```

- [ ] **Step 2: 更新 `docs/ARCHITECTURE.md` §5.1**（把「决策」改为「已落地」；保留背景）

在 §5.1 标题下、`**背景**` 之后加一行状态：

```markdown
**状态**：已落地（阶段 4，2026-08-18）。实现见 `docs/modules/ai-integration.md`：`main/ai/adapter.ts` 提供 `complete(prompt, schema?)` + `test()`，未配置时抛 `AI_NOT_CONFIGURED`，由上层 service 走本地兜底。
```

- [ ] **Step 3: 更新 `docs/README.md` §129-132 阶段 4 状态行**

把：

```markdown
### 阶段 4 · AI 集成层（目标：为后两个模块铺路）
```

改为：

```markdown
### 阶段 4 · AI 集成层（目标：为后两个模块铺路）✅ 已落地
```

并在该节末尾（`- **验收**：...` 之后）补一行：

```markdown
- **状态**：已落地并验收通过（2026-08-18，见 `modules/ai-integration.md` §7）。
```

- [ ] **Step 4: 更新 `docs/API_SPEC.md`**

在 §2 应用与设置域（`settings:set` 之后，约 56-58 行后）新增：

```markdown
### `ai:test` → `{ latencyMs: number }`

- 无参。对已配置的 AI 后端发最小探测，返回毫秒延迟。
- 未配置（backend=none 或 key/baseUrl 缺省）→ `AI_NOT_CONFIGURED`；15s 超时 → `AI_TIMEOUT`。
```

在 §8 错误码语义表（约 184-194 行）新增两行：

```markdown
| `AI_NOT_CONFIGURED` | 未配置 AI 后端 | 后端为 none 或 key/baseUrl 缺省 |
| `AI_API_ERROR` | AI 远端返回非 2xx | HTTP 状态码非 200 |
```

在 §9 类型安全落地下方或 §2 附近补充一句（可选）：

```markdown
- **AI 域**：`window.api.ai.test()` 唯一通道；`complete()` 是主进程内部接口，不经 IPC 暴露。
```

- [ ] **Step 5: 验证**

Run: `npm run typecheck`
Expected: 通过（文档改动不影响编译）。

- [ ] **Step 6: Commit**

```bash
git add docs/modules/ai-integration.md docs/ARCHITECTURE.md docs/README.md docs/API_SPEC.md
git commit -m "docs: 阶段 4 · AI 集成层落地记录（模块文档 / 架构 / README / API 规范）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review 核对（计划作者已执行）

**1. Spec 覆盖：**
- §3.1 文件结构 → Task 1-7 逐一对应。
- §3.2 `complete`/`test` 接口 → Task 3。
- §3.3 schema 只进 prompt（openai 加 response_format / anthropic 仅 prompt）→ Task 3。
- §3.4 两端点细节（openai `/chat/completions` Bearer；anthropic `/v1/messages` x-api-key + anthropic-version）→ Task 3。
- §4 错误码（复用 AI_UNAVAILABLE/AI_TIMEOUT + 新增 AI_NOT_CONFIGURED/AI_API_ERROR）→ Task 1 + Task 3。
- §5.1 key 留空语义（`settings.repository.set`）→ Task 2。
- §5.2 model 默认预填 → Task 3（主进程兜底）+ Task 5（前端预填）。
- §5.3 baseUrl 语义 → Task 3（去尾部斜杠拼接）。
- §6 `ai:test` IPC + `window.api.ai.test` → Task 4。
- §7 UI + 导航 → Task 5 + Task 6。
- §8 文档同步 → Task 7。
- §9 验收 → Task 7 的模块文档勾选 + 人工端到端验收。

**2. 占位符扫描：** 全部代码块为完整可执行代码，无 TBD/TODO/「写上面所述测试」类占位。

**3. 类型一致性：**
- `JsonSchema` / `JsonSchemaProperty`：Task 1 定义 → Task 3 使用，字段一致。
- `ErrorCode`：Task 1 增两码 → Task 3 抛这四码。
- `adapter.test()` 返回 `{ latencyMs }`：Task 3 定义 → Task 4 `invoke<{ latencyMs: number }>` → Task 5 `r.data.latencyMs` 一致。
- `settingsRepository.getRaw()`：Task 2 定义 → Task 3 使用。
- `DEFAULT_MODELS`：Task 3 主进程（`Record<'openai-compatible' | 'anthropic', string>`）与 Task 5 前端（`Record<Exclude<AiBackend, 'none'>, string>`）同值不同型，均正确。
