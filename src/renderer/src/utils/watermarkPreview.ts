import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { drawWatermarkOn } from './watermarkRenderer'
import type { WatermarkConfig } from '@shared/watermark'
import type { WatermarkFileType } from '@shared/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']
const PDF_EXT = ['pdf']
const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'ts', 'm4v']

export function inferPreviewType(filePath: string): WatermarkFileType | null {
  const dot = filePath.lastIndexOf('.')
  const ext = dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : ''
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (PDF_EXT.includes(ext)) return 'pdf'
  if (VIDEO_EXT.includes(ext)) return 'video'
  return null
}

// 预览框适配（maxW 340 / maxH 260，等比缩小，不放大）
const MAX_W = 340
const MAX_H = 260

function fitSize(w: number, h: number): { w: number; h: number } {
  const scale = Math.min(1, MAX_W / w, MAX_H / h)
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) }
}

export interface PreviewApi {
  readBinary(path: string): Promise<{ ok: boolean; data?: Uint8Array; error?: { message: string } }>
  getVideoInfo(
    path: string
  ): Promise<{ ok: boolean; data?: { width: number; height: number; durationMs: number }; error?: { message: string } }>
  extractVideoFrame(payload: { filePath: string; timeMs: number }): Promise<{ ok: boolean; data?: Uint8Array; error?: { message: string } }>
}

function drawBase(ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, config: WatermarkConfig): void {
  const { w, h } = fitSize(bitmap.width, bitmap.height)
  ctx.canvas.width = w
  ctx.canvas.height = h
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  drawWatermarkOn(ctx, w, h, config)
}

// 渲染「原件+水印」到 canvas；返回预览范围说明（无说明返回 ''）；失败抛错。
export async function renderOriginalPreview(
  canvas: HTMLCanvasElement,
  filePath: string,
  type: WatermarkFileType,
  config: WatermarkConfig,
  api: PreviewApi
): Promise<string> {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 初始化失败')

  if (type === 'image' || type === 'video') {
    let bytes: Uint8Array
    if (type === 'image') {
      const r = await api.readBinary(filePath)
      if (!r.ok || !r.data) throw new Error(r.error?.message ?? '读取图片失败')
      bytes = r.data
    } else {
      const info = await api.getVideoInfo(filePath)
      const durationMs = info.ok ? info.data?.durationMs ?? 0 : 0
      const timeMs = Math.min(5000, Math.max(1000, durationMs * 0.05)) // 避开黑场首帧：≥1s 且 ≤5s
      const f = await api.extractVideoFrame({ filePath, timeMs })
      if (!f.ok || !f.data) throw new Error(f.error?.message ?? '视频抽帧失败')
      bytes = f.data
    }
    const bitmap = await createImageBitmap(new Blob([bytes.slice()]))
    drawBase(ctx, bitmap, config)
    bitmap.close()
    return type === 'video' ? '预览为前几秒帧' : ''
  }

  // PDF：渲染第 1 页后叠加水印
  const r = await api.readBinary(filePath)
  if (!r.ok || !r.data) throw new Error(r.error?.message ?? '读取 PDF 失败')
  const pdf = await pdfjsLib.getDocument({ data: r.data }).promise
  try {
    const page = await pdf.getPage(1)
    const baseViewport = page.getViewport({ scale: 1 })
    const fit = fitSize(baseViewport.width, baseViewport.height)
    const viewport = page.getViewport({ scale: fit.w / baseViewport.width })
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: ctx, viewport }).promise
    drawWatermarkOn(ctx, canvas.width, canvas.height, config)
    return '预览为首页'
  } finally {
    await pdf.destroy()
  }
}
