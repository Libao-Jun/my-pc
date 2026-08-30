import { create } from 'zustand'
import { DEFAULT_WATERMARK_CONFIG } from '@shared/watermark'
import type { WatermarkConfig } from '@shared/watermark'
import type { WatermarkFileType } from '@shared/types'
import { renderWatermarkPng, watermarkImageBytes } from '@renderer/utils/watermarkRenderer'
import type { WatermarkImageExt } from '@renderer/utils/watermarkRenderer'

export interface WatermarkQueueItem {
  path: string
  name: string
  type: WatermarkFileType
  status: 'pending' | 'processing' | 'done' | 'failed'
  outputPath?: string
  error?: string
}

interface WatermarkState {
  config: WatermarkConfig
  queue: WatermarkQueueItem[]
  processing: boolean
  videoProgress: number | null
  error: string | null
  setConfig: (patch: Partial<WatermarkConfig>) => void
  addFiles: (type: WatermarkFileType) => Promise<void>
  removeItem: (path: string) => void
  clearQueue: () => void
  run: () => Promise<void>
  cancelVideo: () => void
}

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  return dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : ''
}

export const useWatermarkStore = create<WatermarkState>((set, get) => ({
  config: { ...DEFAULT_WATERMARK_CONFIG },
  queue: [],
  processing: false,
  videoProgress: null,
  error: null,

  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),

  addFiles: async (type) => {
    const r = await window.api.watermark.pickFiles(type)
    if (!r.ok || !r.data) return
    const items: WatermarkQueueItem[] = r.data.map((p) => ({
      path: p,
      name: p.split(/[\\/]/).pop() ?? p,
      type,
      status: 'pending'
    }))
    set((s) => ({ queue: [...s.queue, ...items] }))
  },

  removeItem: (path) => set((s) => ({ queue: s.queue.filter((q) => q.path !== path) })),

  clearQueue: () => set({ queue: [] }),

  cancelVideo: () => {
    set({ videoProgress: null })
    window.api.watermark.cancelVideo()
  },

  run: async () => {
    const { queue, config } = get()
    const items = queue.filter((i) => i.status === 'pending')
    if (items.length === 0 || get().processing) return
    set({ processing: true, error: null, videoProgress: null })

    const unsubVideo = window.api.watermark.onVideoProgress((p) => set({ videoProgress: p.percent }))
    try {
      for (const item of items) {
        set((s) => ({
          queue: s.queue.map((q) => (q.path === item.path ? { ...q, status: 'processing' as const, error: undefined } : q))
        }))
        try {
          const outputPath = await processItem(item, config)
          set((s) => ({
            queue: s.queue.map((q) => (q.path === item.path ? { ...q, status: 'done' as const, outputPath } : q))
          }))
        } catch (e) {
          const msg = e instanceof Error ? e.message : '未知错误'
          set((s) => ({
            queue: s.queue.map((q) => (q.path === item.path ? { ...q, status: 'failed' as const, error: msg } : q))
          }))
        }
      }
    } finally {
      unsubVideo()
      set({ processing: false, videoProgress: null })
    }
  }
}))

async function processItem(item: WatermarkQueueItem, config: WatermarkConfig): Promise<string> {
  if (item.type === 'pdf') {
    const r = await window.api.watermark.applyPdf({ filePath: item.path, config })
    if (!r.ok) throw new Error(r.error.message)
    return r.data.outputPath
  }
  if (item.type === 'video') {
    const info = await window.api.watermark.getVideoInfo(item.path)
    if (!info.ok) throw new Error(info.error.message)
    const png = await renderWatermarkPng(info.data.width, info.data.height, config)
    const r = await window.api.watermark.applyVideo({ filePath: item.path, config, watermarkPng: png })
    if (!r.ok) throw new Error(r.error.message)
    return r.data.outputPath
  }
  // image：读字节 → 渲染层合成 → 写新文件（保持原格式）
  const read = await window.api.watermark.readBinary(item.path)
  if (!read.ok) throw new Error(read.error.message)
  const ext = extOf(item.path) as WatermarkImageExt
  const out = await watermarkImageBytes(read.data, config, ext)
  const write = await window.api.watermark.writeFile({ sourcePath: item.path, data: out.data })
  if (!write.ok) throw new Error(write.error.message)
  return write.data.outputPath
}
