import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppErrorShape,
  CpuInfo,
  DiskInfo,
  IpcResult,
  MemoryInfo,
  NetworkInterface,
  PortProcess,
  ProcessInfo,
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
  system: {
    getOverview: () => invoke<SystemOverview>('system:getOverview'),
    getCpu: () => invoke<CpuInfo>('system:getCpu'),
    getMemory: () => invoke<MemoryInfo>('system:getMemory'),
    getDisks: () => invoke<DiskInfo[]>('system:getDisks'),
    getNetwork: () => invoke<NetworkInterface[]>('system:getNetwork'),
    getProcesses: () => invoke<ProcessInfo[]>('system:getProcesses'),
    getPortProcess: (port) => invoke<PortProcess | null>('system:getPortProcess', { port })
  }
}

contextBridge.exposeInMainWorld('api', api)
