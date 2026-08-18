// 跨进程共享类型契约 —— 唯一真相源（main / preload / renderer 三方共用）

export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'INTERNAL'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'CANCELLED'

export interface AppErrorShape {
  code: ErrorCode
  message: string
}

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppErrorShape }

export type AiBackend = 'openai-compatible' | 'anthropic' | 'none'

export interface Settings {
  aiBackend: AiBackend
  aiBaseUrl: string
  aiApiKey: string // 只存本机，读取时脱敏
  aiModel: string
  largeFileThresholdMB: number
}

// window.api 的完整形状，preload 实现、renderer 消费
export interface AppApi {
  getVersion(): Promise<IpcResult<string>>
  ping(): Promise<IpcResult<'pong'>>
}

export interface SettingsApi {
  get(): Promise<IpcResult<Settings>>
  set(patch: Partial<Settings>): Promise<IpcResult<Settings>>
}

export interface WindowApi {
  app: AppApi
  settings: SettingsApi
}
