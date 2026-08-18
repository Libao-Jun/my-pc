import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  AdblockRule,
  AdblockStatus,
  AppErrorShape,
  ApplyResult,
  Backup,
  CpuInfo,
  DiskInfo,
  FileSearchResult,
  FileStats,
  IpcResult,
  MemoryInfo,
  NetworkInterface,
  PortProcess,
  ProcessInfo,
  ScanOptions,
  ScanPresets,
  ScanProgress,
  ScanResult,
  SearchQuery,
  Settings,
  SystemOverview,
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
  }
}

contextBridge.exposeInMainWorld('api', api)
