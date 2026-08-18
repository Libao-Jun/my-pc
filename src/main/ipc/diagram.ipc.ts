import { ipcMain } from 'electron'
import { AppError } from '@shared/errors'
import type { DiagramRequest } from '@shared/types'
import { generate } from '../services/diagram.service'

const TYPES: DiagramRequest['type'][] = ['mindmap', 'flowchart', 'approval']

export function registerDiagramIpc(): void {
  ipcMain.handle('diagram:generate', async (_e, req: DiagramRequest) => {
    if (typeof req !== 'object' || req === null) throw new AppError('VALIDATION_ERROR', '无效的生成参数')
    if (typeof req.source !== 'string' || req.source.trim().length === 0) {
      throw new AppError('VALIDATION_ERROR', '资料不能为空')
    }
    if (req.source.length > 8000) throw new AppError('VALIDATION_ERROR', '资料过长（上限 8000 字符）')
    if (req.type !== undefined && !TYPES.includes(req.type)) {
      throw new AppError('VALIDATION_ERROR', 'type 需为 mindmap/flowchart/approval')
    }
    return generate(req.source.trim(), req.type)
  })
}
