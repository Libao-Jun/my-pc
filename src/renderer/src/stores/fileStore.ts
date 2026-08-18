import { create } from 'zustand'
import type { FileEntry, FileStats, ScanProgress, SearchQuery } from '@shared/types'

const PAGE_SIZE = 50
const DEFAULT_QUERY: SearchQuery = { page: 1, pageSize: PAGE_SIZE }
// IPC 无法稳定透传 Error.code（Electron 序列化限制），取消动作可能落回 INTERNAL。
// 用本地标志位区分「用户主动取消」与真实错误，避免取消时误弹错误提示。
let cancelRequested = false

interface FileState {
  scanning: boolean
  progress: ScanProgress | null
  files: FileEntry[]
  total: number
  stats: FileStats | null
  error: string | null
  startScan: (roots: string[], minSizeMB: number) => Promise<void>
  cancelScan: () => void
  search: (query: SearchQuery) => Promise<void>
  loadStats: () => Promise<void>
}

export const useFileStore = create<FileState>((set, get) => ({
  scanning: false,
  progress: null,
  files: [],
  total: 0,
  stats: null,
  error: null,

  startScan: async (roots, minSizeMB) => {
    cancelRequested = false // 新一轮扫描重置取消标志
    set({ scanning: true, error: null, progress: null })
    const unsub = window.api.file.onProgress((progress) => set({ progress }))
    try {
      const r = await window.api.file.scan({ roots, minSizeMB })
      if (r.ok) {
        await get().loadStats()
        await get().search({ ...DEFAULT_QUERY })
      } else if (!cancelRequested) {
        set({ error: r.error.message })
      }
    } finally {
      unsub()
      set({ scanning: false, progress: null })
    }
  },

  cancelScan: () => {
    cancelRequested = true // 先落标志，再通知主进程；返回的 INTERNAL 错误不再弹窗
    window.api.file.cancelScan()
  },

  search: async (query) => {
    const r = await window.api.file.search(query)
    if (r.ok) {
      set({ files: r.data.items, total: r.data.total, error: null })
    } else {
      set({ error: r.error.message })
    }
  },

  loadStats: async () => {
    const r = await window.api.file.getStats()
    if (r.ok) set({ stats: r.data })
  }
}))
