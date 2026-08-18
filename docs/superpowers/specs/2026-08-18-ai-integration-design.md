# 阶段 4 设计：AI 集成层（AI integration layer）

> 对应 README §129-132 阶段 4 · AI 集成层（目标：为后两个模块铺路）。
> 前置：阶段 3 广告屏蔽已验收通过。本层为阶段 5 简历优化、阶段 6 图表生成提供 AI 调用能力。

## 1. 目标

- 提供**可配置后端**的 AI 适配层（OpenAI 兼容 / Anthropic / 不使用），阶段 5/6 的业务 service 在主进程直接调用。
- 提供完整设置页：backend / baseUrl / apiKey / model 配置 + 「测试连接」验证。
- 未配置后端时给出明确错误（`AI_NOT_CONFIGURED`），阶段 5/6 借此走**本地规则兜底**。
- 验收：配置好的 API 能完成一次真实测试调用；未配置则给出清晰提示。

## 2. 已确认的设计决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | HTTP 客户端 | Node 22 内置全局 `fetch`（不引新依赖） |
| 2 | 结构化输出策略 | schema 只用于构造 system prompt 格式指令；`complete()` 返回**纯文本**，阶段 5/6 自行 `JSON.parse` |
| 3 | 本地兜底范围 | 本层**只定契约 + 抛 `AI_NOT_CONFIGURED`**，不实现兜底逻辑（阶段 5/6 的 service 自己 catch 后走本地模板） |
| 4 | 设置页范围 | 只做 AI 配置（不动 `largeFileThresholdMB`，虽在 Settings 类型中） |
| 5 | apiKey 编辑 | 留空 = 不修改原值；新值 = 覆盖 |
| 6 | model 字段 | 自由文本 + 按 backend 默认预填 |
| 7 | 错误码 | 复用已有 `AI_UNAVAILABLE`/`AI_TIMEOUT`，新增 `AI_NOT_CONFIGURED`/`AI_API_ERROR` |
| 8 | 超时 | `complete` 60s / `test` 15s（AbortController） |
| 9 | 适配层结构 | 单文件 `adapter.ts`；`complete()` 为**主进程内部接口**，`test()` 暴露给渲染层 |

## 3. 架构

### 3.1 文件结构

```
src/main/ai/adapter.ts                    新增：complete() + test()，按 aiBackend 分派
src/main/ipc/ai.ipc.ts                    新增：仅注册 ai:test
src/main/ipc/index.ts                     修改：注册 ai 域
src/preload/index.ts                      修改：暴露 window.api.ai.test
src/shared/types.ts                       修改：ErrorCode 增 2 码；SettingsApi 增 ai 域
src/main/db/repositories/settings.repository.ts  修改：set() 处理 apiKey 留空语义
src/renderer/src/pages/Settings/SettingsPage.tsx 新增：页面容器
src/renderer/src/pages/Settings/AiSettings.tsx   新增：AI 配置卡片
src/renderer/src/pages/Settings/*.module.css      新增：样式
src/renderer/src/App.tsx                  修改：加 Settings 页四路分支
src/renderer/src/components/layout/SideNav.tsx   修改：PageId + NAV_ITEMS 加「设置」
```

### 3.2 适配层接口（`src/main/ai/adapter.ts`）

```ts
import type { AppError } from '@shared/errors'
import type { JsonSchema } from '@shared/types' // schema 结构见 3.3

// 主进程内部接口 —— 阶段 5/6 的 resume.service / diagram.service 调用
export async function complete(prompt: string, schema?: JsonSchema): Promise<string>
//   → 按 settings.aiBackend 分派 callOpenAi() / callAnthropic()
//   → 返回纯文本；阶段 5/6 自行 JSON.parse
//   → 超时 60s（AbortController，超时抛 AI_TIMEOUT）

// 仅设置页经 IPC 调用
export async function test(): Promise<{ latencyMs: number }>
//   → 对配置后端发一次最小探测，返回毫秒延迟
//   → 超时 15s（抛 AI_TIMEOUT）
//   → 失败抛 AppError（见 §4）
```

- **`complete()` 不暴露给渲染层**：阶段 5/6 的 service 在主进程直接 import，维持架构文档「渲染层只发业务请求」的分层。`ai:complete` 通道本次不建（YAGNI，阶段 5/6 需要时再建）。
- **backend 为 `none` 或 key/baseUrl 未配置** → `complete`/`test` 都抛 `AI_NOT_CONFIGURED`。

### 3.3 schema 与 system prompt

`schema` 采用最小 JSON Schema 子集，只描述**输出结构**，不描述业务语义之外的东西：

```ts
interface JsonSchema {
  name: string        // 输出对象名，如 'resumeOptimization'
  description: string // 输出说明
  properties: Record<string, { type: 'string' | 'number' | 'boolean' | 'array' | 'object'; description: string }>
}
```

- OpenAI 兼容：schema 存在时（a）转成「请以 JSON 返回，结构为 …」指令拼入 system prompt，（b）请求体加 `response_format: { type: 'json_object' }`。
- Anthropic：schema 只拼入 system prompt（Anthropic 不支持 response_format）。
- 阶段 5/6 传入 schema 时约定返回值可被 `JSON.parse`；`complete()` 不代做解析。

### 3.4 两个后端实现细节（adapter.ts 内私有函数）

**OpenAI 兼容（`callOpenAi`）**

- 端点：`POST {aiBaseUrl}/chat/completions`（baseUrl 含版本路径，如 `https://api.openai.com/v1`）
- 头：`Authorization: Bearer {key}`、`Content-Type: application/json`
- 体：`{ model, messages: [{role:'system', content: <schema指令|默认说明>}, {role:'user', content: prompt}], ...(schema ? { response_format: { type: 'json_object' } } : {}) }`
- 解析：`data.choices[0].message.content`（string）

**Anthropic（`callAnthropic`）**

- 端点：`POST {aiBaseUrl}/v1/messages`（baseUrl 如 `https://api.anthropic.com`）
- 头：`x-api-key: {key}`、`anthropic-version: 2023-06-01`、`Content-Type: application/json`
- 体：`{ model, max_tokens: 1024, system: <schema指令|undefined>, messages: [{ role: 'user', content: prompt }] }`
- 解析：`data.content` 取 `text` 块拼接

**test() 探测内容**：openai 发最小请求（`max_tokens: 1`、`"hi"`）；anthropic 发 `max_tokens: 1` 最小消息。只要非 2xx 即抛 `AI_API_ERROR`。

## 4. 错误处理

复用已有 `ErrorCode` 中未使用的 `AI_UNAVAILABLE`、`AI_TIMEOUT`，新增 2 码：

```ts
// shared/types.ts
export type ErrorCode =
  | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'PERMISSION_DENIED' | 'INTERNAL'
  | 'AI_UNAVAILABLE' | 'AI_TIMEOUT'
  | 'AI_NOT_CONFIGURED'   // 新增：未配置 backend / key / baseUrl
  | 'AI_API_ERROR'        // 新增：远端非 2xx
  | 'CANCELLED'
```

| 错误码 | 触发 | message（主进程抛中文，渲染层直接展示） |
|--------|------|------------------------------------------|
| `AI_NOT_CONFIGURED` | aiBackend='none' 或 key/baseUrl 为空 | 「未配置 AI 服务，将使用本地模板」 |
| `AI_TIMEOUT` | complete 60s / test 15s | 「AI 请求超时，请检查网络」 |
| `AI_API_ERROR` | 远端非 2xx | `AI 服务返回错误：HTTP {status}` |
| `AI_UNAVAILABLE` | 网络失败（fetch 抛错）、响应格式异常 | `AI 服务不可用：{原因}` |

**渲染层错误展示**：沿用现有 store 模式——`invoke<T>` 返回 `IpcResult`，页面直接展示 `error.message`（现有 adblockStore 即如此，**不新建**渲染层错误码映射表）。主进程抛出的 AppError message 已是中文，渲染层无需翻译。

## 5. Settings 语义

### 5.1 apiKey 留空 = 不修改（`settings.repository.set`）

```ts
// set(patch) 内，合并前清理：
const cleaned = { ...patch }
if (cleaned.aiApiKey === '' || cleaned.aiApiKey === MASK /* '***' */) {
  delete cleaned.aiApiKey   // 留空（''）或未改动回传（'***'）→ 保留原值
}
const next = { ...readRaw(), ...cleaned }
```

- `MASK = '***'` 已是 `settings.repository` 私有常量，复用。
- 效果：设置页把渲染层读到的脱敏值（'***'）原样回传，不会污染真实 key。

### 5.2 model 默认预填（AiSettings 组件内，纯前端）

| backend | 默认 model |
|---------|-----------|
| `openai-compatible` | `gpt-4o-mini` |
| `anthropic` | `claude-3-5-haiku` |

- 切换 backend 时若 model 为空则预填新默认值；已有值不覆盖。
- model 始终为自由文本，用户可任意修改。

### 5.3 baseUrl 语义

- 用户填**完整基础地址（含版本路径）**：openai 填 `https://api.openai.com/v1`，anthropic 填 `https://api.anthropic.com`。
- adapter 直接拼接资源路径（openai 拼 `/chat/completions`，anthropic 拼 `/v1/messages`）。
- 设置页输入框 placeholder 给出示例。

## 6. IPC 接口

| 通道 | 方向 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| `ai:test` | renderer→main | 无 | `{ latencyMs: number }` | 测试连接，15s 超时 |

preload 增补：

```ts
// window.api 增 ai 域（SettingsApi）
ai: {
  test: () => invoke<{ latencyMs: number }>('ai:test')
}
```

## 7. UI（页面 pages/Settings/）

| 组件 | 用途 |
|------|------|
| `SettingsPage` | 页面容器，本次只渲染 AI 配置卡片 |
| `AiSettings` | AI 集成配置卡片 |

**AiSettings 交互**：
- **backend 下拉**：`none`（不使用 AI）/ `openai-compatible` / `anthropic`。
- **baseUrl**：文本输入，placeholder 按 backend 给示例。
- **apiKey**：密码框，**初始值为空**、placeholder `已配置，留空保持不变`（不回显脱敏值 '***'；留空语义见 §5.1）。
- **model**：自由文本 + backend 默认预填（§5.2）。
- **「测试连接」按钮**：先本地校验（backend 非 none 且 key/baseUrl 非空），通过则调 `window.api.ai.test()`；成功显示 `✅ 连接成功 · {latencyMs}ms`，失败用现有 Toast 显示 `error.message`。
- **「保存」按钮**：`window.api.settings.set(patch)`，成功 Toast「已保存」。
- 进入页面时 `settings.get()` 预填表单。

**导航接入**：
```ts
// SideNav.tsx
type PageId = 'system' | 'files' | 'adblock' | 'settings'
// NAV_ITEMS 追加 { id: 'settings', label: '设置', icon: '⚙️' }

// App.tsx：四路分支渲染
{page === 'settings' ? <SettingsPage /> : /* 其余三路 */}
```

## 8. 文档同步

- `docs/modules/ai-integration.md` —— **新建**：本层设计 + 验收记录。
- `docs/ARCHITECTURE.md` §5.1 —— 更新为「已落地」。
- `docs/README.md` §129-132 —— 阶段 4 状态行更新。
- `docs/API_SPEC.md` —— 增补 `ai:test`、`window.api.ai.test`、新错误码。

## 9. 验收标准

- [ ] 设置页可配置 backend / baseUrl / key / model 并保存；apiKey 留空保存后原 key 不变。
- [ ] 「测试连接」对配置好的 API 完成一次真实调用并显示延迟（openai 兼容与 anthropic 各验一次）。
- [ ] backend=none 或 key/baseUrl 未配置时，测试连接给出「未配置 AI 服务」提示，不发起请求。
- [ ] `npm run typecheck` 通过。

## 10. 阶段外（明确不做）

- 不实现本地兜底规则（阶段 5/6 做）。
- 不建 `ai:complete` IPC 通道（阶段 5/6 需要时建）。
- 不做 key 加密存储（明文存 SQLite，与应用一致；`get()` 已脱敏）。
- 不做模型列表拉取 / 预设下拉（只做自由文本 + 默认预填）。
