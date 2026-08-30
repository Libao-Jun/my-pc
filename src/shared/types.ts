// 跨进程共享类型契约 —— 唯一真相源（main / preload / renderer 三方共用）

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

export interface AppErrorShape {
  code: ErrorCode
  message: string
}

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppErrorShape }

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

// —— 大文件域（file）——
export type FileCategory = 'video' | 'image' | 'document' | 'audio' | 'archive' | 'other'

export interface FileEntry {
  path: string // 绝对路径，唯一
  name: string
  size: number // 字节
  ext: string // 小写扩展名，不含点
  category: FileCategory
  birthtime: number // 创建时间（毫秒）
  mtime: number // 修改时间（毫秒）
}

export interface ScanOptions {
  roots: string[] // 绝对路径
  minSizeMB: number // 大文件阈值
}

export interface ScanProgress {
  current: number // 已处理文件数
  total: number // 0 = 不定进度（扫描前无法预知总数）
  currentPath: string // 当前遍历目录
}

export interface ScanResult {
  totalSize: number
  skipped: number // 权限错误等跳过的目录数
  durationMs: number
}

export interface FileStats {
  byCategory: Record<FileCategory, { count: number; size: number }>
  totalFiles: number
  totalSize: number
}

export interface SearchQuery {
  keyword?: string
  category?: FileCategory
  minSizeMB?: number
  maxSizeMB?: number
  page: number
  pageSize: number
}

export interface FileSearchResult {
  items: FileEntry[]
  total: number
}

export interface ScanPresets {
  home: string // 用户主目录
  drives: string[] // 盘符挂载点，如 ['C:\\']
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

export interface AiApi {
  test(): Promise<IpcResult<{ latencyMs: number }>>
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

export interface FileApi {
  scan(options: ScanOptions): Promise<IpcResult<ScanResult>>
  cancelScan(): void
  search(query: SearchQuery): Promise<IpcResult<FileSearchResult>>
  getStats(): Promise<IpcResult<FileStats>>
  getScanPresets(): Promise<IpcResult<ScanPresets>>
  pickDirectory(): Promise<IpcResult<string | null>>
  onProgress(cb: (progress: ScanProgress) => void): () => void // 订阅 'file:scan:progress'，返回退订函数
}

// —— 广告屏蔽域（adblock）——
export type AdblockCategory = 'ad' | 'recommend' // ad = 广告，recommend = 个性化推荐

export interface AdblockRule {
  id: string
  software: string // 所属软件分组，如「搜狗输入法」
  domain: string // 屏蔽域名（小写，字面域名，不支持通配符）
  category: AdblockCategory
  enabled: boolean
}

export interface AdblockStatus {
  applied: boolean // hosts 中是否存在托管段
  ruleCount: number
  enabledCount: number
  lastAppliedAt: number | null // 最新备份时间（毫秒）
  elevated: boolean // 当前进程是否具备管理员权限
}

export interface Backup {
  id: string
  createdAt: number
  ruleCount: number
}

export interface ApplyResult {
  written: number // 本次写入的规则数
  backupId: string
  needsFlushDns: boolean // DNS 刷新失败，需提示用户手动 ipconfig /flushdns
}

export interface AdblockApi {
  getRules(): Promise<IpcResult<AdblockRule[]>>
  addRule(rule: Omit<AdblockRule, 'id'>): Promise<IpcResult<AdblockRule>>
  updateRule(id: string, patch: Partial<AdblockRule>): Promise<IpcResult<AdblockRule>>
  removeRule(id: string): Promise<IpcResult<void>>
  apply(): Promise<IpcResult<ApplyResult>>
  restore(backupId?: string): Promise<IpcResult<void>>
  getStatus(): Promise<IpcResult<AdblockStatus>>
  listBackups(): Promise<IpcResult<Backup[]>>
  relaunchElevated(): void // 以管理员身份重启应用
}

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

// —— 水印保护域（watermark）——
import type { WatermarkConfig, WatermarkLayout, WatermarkHAlign, WatermarkVAlign, WatermarkPageScope } from './watermark'
export type { WatermarkConfig, WatermarkLayout, WatermarkHAlign, WatermarkVAlign, WatermarkPageScope } from './watermark'

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
