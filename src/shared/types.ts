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

// —— 系统信息域（system）——
export interface OsInfo {
  platform: string
  distro: string
  release: string
  arch: string
}

export interface CpuInfo {
  model: string
  cores: number
  speedGHz: number
  loadPercent: number
  perCore: number[]
}

export interface MemoryInfo {
  total: number
  used: number
  free: number
  active: number
  swapTotal: number
  usedPercent: number
}

export interface DiskInfo {
  device: string
  mount: string
  fsType: string
  total: number
  used: number
  usedPercent: number
}

export interface NetworkInterface {
  iface: string
  ip4: string
  mac: string
  dhcp: boolean
  subnet: string
  isDefault: boolean
  dns: string[]
}

export interface ProcessInfo {
  pid: number
  name: string
  cpuPercent: number
  memBytes: number
  user?: string
}

export interface PortProcess {
  port: number
  pid: number
  name: string
  protocol: 'tcp' | 'udp'
}

export interface SystemOverview {
  os: OsInfo
  cpu: { model: string; cores: number; loadPercent: number }
  memory: { total: number; used: number; free: number; usedPercent: number }
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

export interface SystemApi {
  getOverview(): Promise<IpcResult<SystemOverview>>
  getCpu(): Promise<IpcResult<CpuInfo>>
  getMemory(): Promise<IpcResult<MemoryInfo>>
  getDisks(): Promise<IpcResult<DiskInfo[]>>
  getNetwork(): Promise<IpcResult<NetworkInterface[]>>
  getProcesses(): Promise<IpcResult<ProcessInfo[]>>
  getPortProcess(port: number): Promise<IpcResult<PortProcess | null>>
}

export interface WindowApi {
  app: AppApi
  settings: SettingsApi
  system: SystemApi
}
