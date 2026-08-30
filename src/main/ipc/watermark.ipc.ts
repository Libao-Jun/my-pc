import { dialog, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { AppError } from '@shared/errors'
import type { WatermarkConfig, WatermarkFileType } from '@shared/types'
import {
  applyPdf,
  applyVideo,
  cancelVideo,
  getVideoInfo,
  readBinary,
  watermarkOutputPath,
  writeBinary
} from '../services/watermark.service'

const IMAGE_FILTER = { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
const PDF_FILTER = { name: 'PDF', extensions: ['pdf'] }
const VIDEO_FILTER = { name: '视频', extensions: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'flv', 'webm', 'ts', 'm4v'] }

function validateConfig(config: WatermarkConfig): void {
  if (typeof config !== 'object' || config === null) throw new AppError('VALIDATION_ERROR', '无效的水印配置')
  if (typeof config.text !== 'string' || config.text.trim().length === 0 || config.text.length > 200) {
    throw new AppError('VALIDATION_ERROR', '水印文本需为 1–200 字符')
  }
  if (typeof config.fontFamily !== 'string' || config.fontFamily.trim().length === 0) {
    throw new AppError('VALIDATION_ERROR', '字体无效')
  }
  if (!(config.fontSize > 0 && config.fontSize <= 500)) throw new AppError('VALIDATION_ERROR', '字号需为 1–500')
  if (!(config.opacity >= 0.05 && config.opacity <= 1)) throw new AppError('VALIDATION_ERROR', '不透明度需为 0.05–1')
  if (!(config.rotation >= -90 && config.rotation <= 90)) throw new AppError('VALIDATION_ERROR', '旋转角度需为 -90–90')
  const layouts = ['single', 'multi2', 'multi3', 'multi6', 'multi8']
  if (!layouts.includes(config.layout)) throw new AppError('VALIDATION_ERROR', '未知的布局模式')
}

export function registerWatermarkIpc(): void {
  ipcMain.handle('watermark:pickFiles', async (_event, type: WatermarkFileType) => {
    const filter = type === 'image' ? IMAGE_FILTER : type === 'pdf' ? PDF_FILTER : VIDEO_FILTER
    const result = await dialog.showOpenDialog({
      title: '选择要加水印的文件',
      properties: ['openFile', 'multiSelections'],
      filters: [filter]
    })
    return result.canceled ? null : result.filePaths
  })

  ipcMain.handle('watermark:readBinary', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) throw new AppError('VALIDATION_ERROR', '无效的文件路径')
    return readBinary(filePath)
  })

  ipcMain.handle('watermark:writeFile', async (_event, payload: { sourcePath: string; data: Uint8Array }) => {
    if (!payload || typeof payload.sourcePath !== 'string' || !payload.sourcePath) {
      throw new AppError('VALIDATION_ERROR', '无效的输出参数')
    }
    const out = watermarkOutputPath(payload.sourcePath)
    await writeBinary(out, payload.data)
    return { outputPath: out }
  })

  ipcMain.handle('watermark:applyPdf', async (_event, payload: { filePath: string; config: WatermarkConfig }) => {
    validateConfig(payload.config)
    if (typeof payload.filePath !== 'string') throw new AppError('VALIDATION_ERROR', '无效的文件路径')
    const outputPath = await applyPdf(payload.filePath, payload.config)
    return { outputPath }
  })

  ipcMain.handle('watermark:getVideoInfo', async (_event, filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) throw new AppError('VALIDATION_ERROR', '无效的文件路径')
    return getVideoInfo(filePath)
  })

  ipcMain.handle(
    'watermark:applyVideo',
    (event, payload: { filePath: string; config: WatermarkConfig; watermarkPng: Uint8Array }) => {
      validateConfig(payload.config)
      if (typeof payload.filePath !== 'string' || !payload.filePath) {
        throw new AppError('VALIDATION_ERROR', '无效的文件路径')
      }
      const sender: WebContents = event.sender
      return applyVideo(payload.filePath, payload.config, payload.watermarkPng, (percent) => {
        sender.send('watermark:videoProgress', { percent })
      })
    }
  )

  ipcMain.on('watermark:cancelVideo', () => {
    cancelVideo()
  })
}
