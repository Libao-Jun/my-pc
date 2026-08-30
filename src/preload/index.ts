import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  AdblockRule,
  AdblockStatus,
  AppErrorShape,
  ApplyResult,
  Backup,
  CpuInfo,
  DiagramResult,
  DiskInfo,
  FileSearchResult,
  FileStats,
  IpcResult,
  MemoryInfo,
  NetworkInterface,
  OptimizeResult,
  PortProcess,
  ProcessInfo,
  Resume,
  ScanOptions,
  ScanPresets,
  ScanProgress,
  ScanResult,
  SearchQuery,
  Settings,
  SystemOverview,
  VideoProgress,
  WatermarkApplyResult,
  WatermarkConfig,
  WatermarkFileType,
  WindowApi
} from '@shared/types'

async function invoke<T>(channel: string, payload?: unknown): Promise<IpcResult<T>> {
  try {
    const data = (await ipcRenderer.invoke(channel, payload)) as T
    return { ok: true, data }
  } catch (err) {
    const e = err as Partial<AppErrorShape>
    const shape: AppErrorShape = {
      code: e.code ?? 'INTERNAL',
      message: e.message ?? '未知错误'
    }
    return { ok: false, error: shape }
  }
}

const api: WindowApi = {
  app: {
    getVersion: () => invoke<string>('app:getVersion'),
    ping: () => invoke<'pong'>('app:ping')
  },
  settings: {
    get: () => invoke<Settings>('settings:get'),
    set: (patch) => invoke<Settings>('settings:set', patch)
  },
  ai: {
    test: () => invoke<{ latencyMs: number }>('ai:test')
  },
  system: {
    getOverview: () => invoke<SystemOverview>('system:getOverview'),
    getCpu: () => invoke<CpuInfo>('system:getCpu'),
    getMemory: () => invoke<MemoryInfo>('system:getMemory'),
    getDisks: () => invoke<DiskInfo[]>('system:getDisks'),
    getNetwork: () => invoke<NetworkInterface[]>('system:getNetwork'),
    getProcesses: () => invoke<ProcessInfo[]>('system:getProcesses'),
    getPortProcess: (port) => invoke<PortProcess | null>('system:getPortProcess', { port })
  },
  file: {
    scan: (options: ScanOptions) => invoke<ScanResult>('file:scan', options),
    cancelScan: () => {
      ipcRenderer.send('file:scan:cancel')
    },
    search: (query: SearchQuery) => invoke<FileSearchResult>('file:search', query),
    getStats: () => invoke<FileStats>('file:getStats'),
    getScanPresets: () => invoke<ScanPresets>('file:getScanPresets'),
    pickDirectory: () => invoke<string | null>('file:pickDirectory'),
    onProgress: (cb) => {
      const listener = (_event: IpcRendererEvent, progress: ScanProgress): void => cb(progress)
      ipcRenderer.on('file:scan:progress', listener)
      return () => {
        ipcRenderer.removeListener('file:scan:progress', listener)
      }
    }
  },
  adblock: {
    getRules: () => invoke<AdblockRule[]>('adblock:getRules'),
    addRule: (rule) => invoke<AdblockRule>('adblock:addRule', rule),
    updateRule: (id, patch) => invoke<AdblockRule>('adblock:updateRule', { id, patch }),
    removeRule: (id) => invoke<void>('adblock:removeRule', { id }),
    apply: () => invoke<ApplyResult>('adblock:apply'),
    restore: (backupId) => invoke<void>('adblock:restore', { backupId }),
    getStatus: () => invoke<AdblockStatus>('adblock:getStatus'),
    listBackups: () => invoke<Backup[]>('adblock:listBackups'),
    relaunchElevated: () => {
      ipcRenderer.send('adblock:relaunchElevated')
    }
  },
  resume: {
    load: () => invoke<Resume | null>('resume:load'),
    save: (resume) => invoke<Resume>('resume:save', resume),
    optimize: (req) => invoke<OptimizeResult>('resume:optimize', req),
    export: (payload) => invoke<{ path: string } | null>('resume:export', payload),
    import: () => invoke<Resume | null>('resume:import')
  },
  diagram: {
    generate: (req) => invoke<DiagramResult>('diagram:generate', req)
  },
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
}

contextBridge.exposeInMainWorld('api', api)
