import { dialog, ipcMain } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { AppError } from '@shared/errors'
import type { OptimizeRequest, Resume } from '@shared/types'
import { resumeRepository } from '../db/repositories/resume.repository'
import { buildMarkdown, optimize, validateResume } from '../services/resume.service'

const SECTIONS: OptimizeRequest['section'][] = ['experience', 'project', 'skill']

function validateOptimizeRequest(req: OptimizeRequest): void {
  if (typeof req !== 'object' || req === null) throw new AppError('VALIDATION_ERROR', '无效的优化参数')
  if (!SECTIONS.includes(req.section)) throw new AppError('VALIDATION_ERROR', 'section 需为 experience/project/skill')
  if (typeof req.input !== 'string' || req.input.trim().length === 0) throw new AppError('VALIDATION_ERROR', 'input 不能为空')
  if (req.input.length > 2000) throw new AppError('VALIDATION_ERROR', 'input 过长（上限 2000 字符）')
}

function validateExportType(type: unknown): asserts type is 'markdown' | 'json' {
  if (type !== 'markdown' && type !== 'json') throw new AppError('VALIDATION_ERROR', 'type 需为 markdown 或 json')
}

export function registerResumeIpc(): void {
  ipcMain.handle('resume:load', () => resumeRepository.load())

  ipcMain.handle('resume:save', (_e, resume: Resume) => {
    return resumeRepository.save(validateResume(resume))
  })

  ipcMain.handle('resume:optimize', (_e, req: OptimizeRequest) => {
    validateOptimizeRequest(req)
    return optimize(req.section, req.input.trim())
  })

  // 导出所见即所得：渲染层传入当前内存态 resume（非 DB）
  ipcMain.handle('resume:export', async (_e, payload: { type: 'markdown' | 'json'; resume: Resume }) => {
    if (typeof payload !== 'object' || payload === null) throw new AppError('VALIDATION_ERROR', '无效的导出参数')
    validateExportType(payload.type)
    const resume = validateResume(payload.resume)
    const isMarkdown = payload.type === 'markdown'
    const result = await dialog.showSaveDialog({
      title: isMarkdown ? '导出简历为 Markdown' : '导出简历为 JSON',
      defaultPath: isMarkdown ? '简历.md' : 'resume.json',
      filters: isMarkdown
        ? [{ name: 'Markdown', extensions: ['md'] }]
        : [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    const content = isMarkdown ? buildMarkdown(resume) : JSON.stringify(resume, null, 2)
    await writeFile(result.filePath, content, 'utf-8')
    return { path: result.filePath }
  })

  ipcMain.handle('resume:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '导入简历 JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const raw = await readFile(result.filePaths[0], 'utf-8')
    return validateResume(JSON.parse(raw))
  })
}
