import { contextBridge, ipcRenderer } from 'electron'
import type { AppErrorShape, IpcResult, Settings, WindowApi } from '@shared/types'

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
  }
}

contextBridge.exposeInMainWorld('api', api)
