import { GIFEncoder, quantize, applyPalette } from 'gifenc'
import { computeWatermarkPlacements } from '@shared/watermark'
import type { WatermarkConfig } from '@shared/watermark'

export type WatermarkImageExt = 'png' | 'jpg' | 'jpeg' | 'webp' | 'bmp' | 'gif'

// 在指定 canvas 上下文上绘制水印（图片合成 / 预览 / 视频覆盖层共用）
export function drawWatermarkOn(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  config: WatermarkConfig
): void {
  ctx.font = `${config.fontSize}px ${config.fontFamily}`
  ctx.fillStyle = '#808080'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const textWidth = ctx.measureText(config.text).width
  // 文本高度统一按 1.4em 参与布局（与共享层 computeWatermarkPlacements 默认、PDF 输出路径一致），
  // 使图片/视频/PDF/预览各路径行距语义相同 → 预览与真实输出跨类型一致。
  // 不再按字体实际度量（actualBoundingBoxAscent+Descent）取高，避免字体相关差异导致各类型行距不同。
  const textHeight = config.fontSize * 1.4
  const placements = computeWatermarkPlacements(width, height, config, textWidth, textHeight)
  for (const p of placements) {
    ctx.save()
    ctx.globalAlpha = config.opacity
    ctx.translate(p.x, p.y)
    ctx.rotate((config.rotation * Math.PI) / 180)
    ctx.fillText(config.text, 0, 0)
    ctx.restore()
  }
}

// 完整图片管线：解码 → 合成 → 按原扩展名编码（png/jpg/jpeg/webp 用 toBlob；bmp/gif 用自编码）
export async function watermarkImageBytes(
  data: Uint8Array,
  config: WatermarkConfig,
  ext: WatermarkImageExt
): Promise<{ data: Uint8Array }> {
  const bitmap = await createImageBitmap(new Blob([data as Uint8Array<ArrayBuffer>]))
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 初始化失败')

  if (ext === 'gif') {
    // GIF 输出：先铺白底（避免透明区域在编码时丢失），再画首帧
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  drawWatermarkOn(ctx, canvas.width, canvas.height, config)
  return { data: await encodeCanvas(canvas, ext) }
}

async function encodeCanvas(canvas: HTMLCanvasElement, ext: WatermarkImageExt): Promise<Uint8Array> {
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, ext === 'png' ? undefined : 0.92))
    if (!blob) throw new Error('图片编码失败')
    return new Uint8Array(await blob.arrayBuffer())
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 初始化失败')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return ext === 'bmp' ? encodeBmp(imageData) : encodeGif(imageData)
}

// 渲染透明水印 PNG（视频覆盖层用；预览也可复用 drawWatermarkOn）
export async function renderWatermarkPng(
  width: number,
  height: number,
  config: WatermarkConfig
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 初始化失败')
  drawWatermarkOn(ctx, width, height, config)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('水印 PNG 生成失败')
  return new Uint8Array(await blob.arrayBuffer())
}

// —— BMP 编码（未压缩 24 位，自下而上）——
function writeU16(a: Uint8Array, off: number, v: number): void {
  a[off] = v & 0xff
  a[off + 1] = (v >> 8) & 0xff
}

function writeU32(a: Uint8Array, off: number, v: number): void {
  a[off] = v & 0xff
  a[off + 1] = (v >> 8) & 0xff
  a[off + 2] = (v >> 16) & 0xff
  a[off + 3] = (v >>> 24) & 0xff
}

export function encodeBmp(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelSize = rowSize * height
  const fileSize = 54 + pixelSize
  const out = new Uint8Array(fileSize)

  // BITMAPFILEHEADER（14 字节）
  out[0] = 0x42
  out[1] = 0x4d // 'BM'
  writeU32(out, 2, fileSize)
  writeU32(out, 10, 54) // 像素数据偏移

  // BITMAPINFOHEADER（40 字节）
  writeU32(out, 14, 40)
  writeU32(out, 18, width >>> 0)
  writeU32(out, 22, height >>> 0) // 正数 → 自下而上
  writeU16(out, 26, 1) // planes
  writeU16(out, 28, 24) // 每像素位数
  writeU32(out, 30, 0) // BI_RGB（未压缩）
  writeU32(out, 34, pixelSize)
  writeU32(out, 38, 2835) // ppmX ≈ 72dpi
  writeU32(out, 42, 2835) // ppmY

  // 像素：自下而上逐行，BGR 序，每行按 rowSize 对齐
  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y
    const dstRow = 54 + y * rowSize
    for (let x = 0; x < width; x++) {
      const si = (srcRow * width + x) * 4
      const di = dstRow + x * 3
      out[di] = data[si + 2] // B
      out[di + 1] = data[si + 1] // G
      out[di + 2] = data[si] // R
    }
  }
  return out
}

// —— GIF 编码（静态帧；调用方已保证画到白底，无透明区域）——
export function encodeGif(imageData: ImageData): Uint8Array {
  const { width, height, data } = imageData
  const palette = quantize(data, 256)
  const index = applyPalette(data, palette)
  const gif = GIFEncoder()
  gif.writeFrame(index, width, height, { palette, delay: 0 })
  gif.finish()
  return gif.bytes()
}
