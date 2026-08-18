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
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
      signal
    })
  } catch (err) {
    // 网络失败（DNS/连接拒绝/离线）→ AI_UNAVAILABLE；AppError 原样透传（AI_TIMEOUT 由 withTimeout 兜底）
    if (err instanceof AppError) throw err
    throw new AppError('AI_UNAVAILABLE', 'AI 服务网络不可达，请检查地址与网络')
  }
  if (!res.ok) throw new AppError('AI_API_ERROR', `AI 服务返回错误：HTTP ${res.status}`)
  let data: unknown
  try {
    data = await res.json()
  } catch (err) {
    // 非 JSON 响应体（如代理返回 HTML 错误页）→ AI_UNAVAILABLE
    if (err instanceof AppError) throw err
    throw new AppError('AI_UNAVAILABLE', 'AI 服务响应格式异常')
  }
  if (!data || typeof data !== 'object') throw new AppError('AI_UNAVAILABLE', 'AI 服务响应格式异常')
  const content = (data as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message?.content
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
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal
    })
  } catch (err) {
    // 网络失败（DNS/连接拒绝/离线）→ AI_UNAVAILABLE；AppError 原样透传（AI_TIMEOUT 由 withTimeout 兜底）
    if (err instanceof AppError) throw err
    throw new AppError('AI_UNAVAILABLE', 'AI 服务网络不可达，请检查地址与网络')
  }
  if (!res.ok) throw new AppError('AI_API_ERROR', `AI 服务返回错误：HTTP ${res.status}`)
  let data: unknown
  try {
    data = await res.json()
  } catch (err) {
    // 非 JSON 响应体（如代理返回 HTML 错误页）→ AI_UNAVAILABLE
    if (err instanceof AppError) throw err
    throw new AppError('AI_UNAVAILABLE', 'AI 服务响应格式异常')
  }
  if (!data || typeof data !== 'object') throw new AppError('AI_UNAVAILABLE', 'AI 服务响应格式异常')
  const rawContent = (data as { content?: unknown }).content
  const blocks = Array.isArray(rawContent) ? (rawContent as Array<{ type?: string; text?: string }>) : []
  const text = blocks
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
