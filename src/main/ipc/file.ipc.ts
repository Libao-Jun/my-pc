import { dialog, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { AppError } from '@shared/errors'
import type { FileCategory, ScanOptions, SearchQuery } from '@shared/types'
import { cancelScan, getScanPresets, getStats, scan, search } from '../services/file.service'

const CATEGORIES: FileCategory[] = ['video', 'image', 'document', 'audio', 'archive', 'other']

function validateSearch(query: SearchQuery): void {
  if (typeof query !== 'object' || query === null) {
    throw new AppError('VALIDATION_ERROR', '无效的搜索参数')
  }
  if (!Number.isInteger(query.page) || query.page < 1) {
    throw new AppError('VALIDATION_ERROR', '页码需为 >= 1 的整数')
  }
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 500) {
    throw new AppError('VALIDATION_ERROR', '每页数量需为 1–500 的整数')
  }
  if (query.category && !CATEGORIES.includes(query.category)) {
    throw new AppError('VALIDATION_ERROR', '未知的文件分类')
  }
  for (const v of [query.minSizeMB, query.maxSizeMB]) {
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) {
      throw new AppError('VALIDATION_ERROR', '大小范围需为非负数字')
    }
  }
}

export function registerFileIpc(): void {
  ipcMain.handle('file:scan', (event, options: ScanOptions) => {
    const sender: WebContents = event.sender
    return scan(options, (progress) => sender.send('file:scan:progress', progress))
  })

  ipcMain.on('file:scan:cancel', () => {
    cancelScan()
  })

  ipcMain.handle('file:search', (_event, query: SearchQuery) => {
    validateSearch(query)
    return search(query)
  })

  ipcMain.handle('file:getStats', () => getStats())

  ipcMain.handle('file:getScanPresets', () => getScanPresets())

  ipcMain.handle('file:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择要扫描的文件夹',
      properties: ['openDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
