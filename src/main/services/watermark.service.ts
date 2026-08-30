import { spawn, execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { PDFDocument, degrees, rgb } from 'pdf-lib'
import type { PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import ffmpegPath from 'ffmpeg-static'
import { AppError } from '@shared/errors'
import { computeWatermarkPlacements } from '@shared/watermark'
import type { WatermarkConfig } from '@shared/watermark'

const execFileAsync = promisify(execFile)

// 可嵌入的系统中文字体候选（Windows 10）。优先 .ttf（fontkit 直接支持），.ttc 集合尝试兜底。
const CJK_FONT_CANDIDATES = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/simsun.ttc'
]

export function watermarkOutputPath(filePath: string): string {
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath) // 保留原始扩展名（含大小写），满足「逐字一致」
  const base = path.basename(filePath, ext)
  let out = path.join(dir, `${base}.水印${ext}`)
  let i = 1
  while (existsSync(out)) {
    out = path.join(dir, `${base}.水印(${i})${ext}`)
    i++
  }
  return out
}

export async function readBinary(filePath: string): Promise<Buffer> {
  try {
    return await readFile(filePath)
  } catch {
    throw new AppError('NOT_FOUND', '文件不存在或不可读：' + filePath)
  }
}

export async function writeBinary(filePath: string, data: Uint8Array): Promise<string> {
  try {
    await writeFile(filePath, data)
    return filePath
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('PROCESS_FAILED', '写入输出文件失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

async function loadCjkFont(doc: PDFDocument): Promise<PDFFont> {
  for (const cand of CJK_FONT_CANDIDATES) {
    try {
      return await doc.embedFont(await readFile(cand))
    } catch {
      // 尝试下一个候选（TTC 解析失败属已知风险）
    }
  }
  throw new AppError('PROCESS_FAILED', '未找到可嵌入的中文字体（已尝试 simhei / msyh / simsun），请在系统中安装中文字体后重试')
}

export async function applyPdf(filePath: string, config: WatermarkConfig): Promise<string> {
  try {
    const doc = await PDFDocument.load(await readBinary(filePath))
    // 注册 fontkit：嵌入自定义字体（非标准 14 字体）前必须调用，否则 embedFont 抛错
    doc.registerFontkit(fontkit)
    const font = await loadCjkFont(doc)
    const allPages = doc.getPages()
    const pages = allPages.filter((_, i) => {
      if (config.pageScope === 'odd') return i % 2 === 0   // 第 1,3,5…页
      if (config.pageScope === 'even') return i % 2 === 1  // 第 2,4,6…页
      return true                                          // all
    })
    // 估算文本尺寸（中文全角近似）：宽 = 字号 × 字符数 × 0.6；高 ≈ 1.4em。用于多行模式的间距排布
    const textWidth = config.fontSize * config.text.length * 0.6
    const textHeight = config.fontSize * 1.4
    for (const page of pages) {
      const { width, height } = page.getSize()
      const placements = computeWatermarkPlacements(width, height, config, textWidth, textHeight)
      for (const p of placements) {
        // pdf-lib 坐标原点在左下角：翻转 y，且以文本左下为锚点，做居中修正
        page.drawText(config.text, {
          x: p.x - textWidth / 2,
          y: height - p.y - config.fontSize / 2,
          size: config.fontSize,
          font,
          rotate: degrees(config.rotation),
          opacity: config.opacity,
          color: rgb(0.5, 0.5, 0.5)
        })
      }
    }
    const out = watermarkOutputPath(filePath)
    await writeBinary(out, await doc.save())
    return out
  } catch (e) {
    if (e instanceof AppError) throw e
    throw new AppError('PROCESS_FAILED', 'PDF 处理失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

export interface VideoInfo {
  width: number
  height: number
  durationMs: number
}

function resolveFfmpeg(): string {
  if (!ffmpegPath) throw new AppError('PROCESS_FAILED', '未找到 ffmpeg 可执行文件')
  return ffmpegPath
}

function parseVideoInfo(stderr: string): VideoInfo | null {
  // 兼容 ffmpeg 6.x 的流 ID 标记（如 `Stream #0:0[0x1](und): Video: ...`）
  const stream = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?: Video:.*?(\d{2,5})x(\d{2,5})/.exec(stderr)
  const duration = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderr)
  if (!stream) return null
  let durationMs = 0
  if (duration) {
    durationMs = (Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000
  }
  return { width: Number(stream[1]), height: Number(stream[2]), durationMs }
}

export function getVideoInfo(filePath: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    // ffmpeg -i 无输出参数时退出码非 0，但媒体信息在 stderr
    execFile(resolveFfmpeg(), ['-i', filePath], (err, _stdout, stderr) => {
      const info = parseVideoInfo(stderr)
      if (info) resolve(info)
      else reject(new AppError('PROCESS_FAILED', '无法解析视频信息：' + String(err?.message ?? '').slice(0, 200)))
    })
  })
}

// 抽一帧预览图（PNG 字节）。timeMs 为时间点，-ss 置于 -i 前（快进）。
export async function extractVideoFrame(filePath: string, timeMs: number): Promise<Buffer> {
  const bin = resolveFfmpeg()
  const framePath = path.join(tmpdir(), `mypc-wm-frame-${randomUUID()}.png`)
  const secs = (timeMs / 1000).toFixed(3)
  try {
    await execFileAsync(bin, ['-ss', secs, '-i', filePath, '-frames:v', '1', '-f', 'image2', '-y', framePath])
    return await readBinary(framePath)
  } catch (e) {
    throw new AppError('PROCESS_FAILED', '视频抽帧失败：' + (e instanceof Error ? e.message : String(e)))
  } finally {
    void rm(framePath, { force: true })
  }
}

let activeVideo: { child: ChildProcess; wmPath: string } | null = null
let cancelled = false

export function cancelVideo(): void {
  if (activeVideo) {
    cancelled = true
    activeVideo.child.kill('SIGKILL')
  }
}

export function applyVideo(
  filePath: string,
  config: WatermarkConfig,
  watermarkPng: Uint8Array,
  onProgress: (percent: number) => void
): Promise<string> {
  return (async () => {
    cancelled = false
    const info = await getVideoInfo(filePath)
    const bin = resolveFfmpeg()
    const wmPath = path.join(tmpdir(), `mypc-wm-${Date.now()}.png`)
    const out = watermarkOutputPath(filePath)
    await writeBinary(wmPath, watermarkPng)

    // 按输入容器匹配视频编码：输出与输入同容器，不同 muxer 兼容的编码不同
    const ext = path.extname(filePath).toLowerCase()
    const videoCodec = ext === '.webm' ? 'libvpx-vp9' : ext === '.avi' || ext === '.wmv' ? 'mpeg4' : 'libx264'

    return new Promise<string>((resolve, reject) => {
      const args = [
        '-y',
        '-i', filePath,
        '-i', wmPath,
        '-filter_complex', '[1:v]format=rgba[wm];[0:v][wm]overlay=0:0[outv]',
        '-map', '[outv]',
        '-map', '0:a?',
        '-c:a', 'copy',
        '-c:v', videoCodec,
        '-preset', 'medium',
        '-crf', '18',
        // +faststart 仅对 mp4/mov/m4v（MP4 系 muxer）有意义，其余容器忽略该项
        ...(ext === '.mp4' || ext === '.mov' || ext === '.m4v' ? ['-movflags', '+faststart'] : []),
        out
      ]
      const child = spawn(bin, args)
      activeVideo = { child, wmPath }
      let stderrTail = ''

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stderrTail = (stderrTail + text).slice(-2000)
        if (info.durationMs > 0) {
          const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text)
          if (m) {
            const t = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
            onProgress(Math.min(99, Math.round((t / info.durationMs) * 100)))
          }
        }
      })

      const cleanup = (): void => {
        void rm(wmPath, { force: true }).finally(() => {
          activeVideo = null
        })
      }

      child.on('error', (err) => {
        cleanup()
        reject(new AppError('PROCESS_FAILED', 'ffmpeg 启动失败：' + err.message))
      })

      child.on('close', (code) => {
        cleanup()
        if (cancelled) {
          // 取消时清理可能已生成的部分输出文件
          void rm(out, { force: true })
          reject(new AppError('CANCELLED', '已取消'))
        } else if (code === 0) {
          onProgress(100)
          resolve(out)
        } else {
          reject(new AppError('PROCESS_FAILED', '视频处理失败（退出码 ' + code + '）：' + stderrTail.slice(-300)))
        }
      })
    })
  })()
}
