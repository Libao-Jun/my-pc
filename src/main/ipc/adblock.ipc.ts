import { ipcMain } from 'electron'
import { AppError } from '@shared/errors'
import type { AdblockRule } from '@shared/types'
import {
  addRule,
  apply,
  getRules,
  getStatus,
  isValidDomain,
  listBackups,
  relaunchElevated,
  removeRule,
  restore,
  updateRule
} from '../services/adblock.service'

// 参数校验（与 file.ipc 同风格）；字段缺省即跳过，支持部分 patch
const RULE_KEYS = ['software', 'domain', 'category', 'enabled'] as const

function validateRule(input: Partial<AdblockRule>): void {
  // 拒绝未知键（如 patch 携带 id），防御直接 IPC 调用方；enabled 必须是布尔
  for (const key of Object.keys(input)) {
    if (!RULE_KEYS.includes(key as (typeof RULE_KEYS)[number])) {
      throw new AppError('VALIDATION_ERROR', `非法字段：${key}`)
    }
  }
  if (
    input.software !== undefined &&
    (typeof input.software !== 'string' || input.software.trim().length === 0 || input.software.length > 30)
  ) {
    throw new AppError('VALIDATION_ERROR', '软件分组名为 1–30 字符')
  }
  if (
    input.domain !== undefined &&
    (typeof input.domain !== 'string' || !isValidDomain(input.domain.trim().toLowerCase()))
  ) {
    throw new AppError('VALIDATION_ERROR', '域名格式非法（需字面域名，不支持通配符）')
  }
  if (input.category !== undefined && input.category !== 'ad' && input.category !== 'recommend') {
    throw new AppError('VALIDATION_ERROR', '类别需为 ad 或 recommend')
  }
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new AppError('VALIDATION_ERROR', 'enabled 需为布尔值')
  }
}

export function registerAdblockIpc(): void {
  ipcMain.handle('adblock:getRules', () => getRules())

  ipcMain.handle('adblock:addRule', (_e, rule: Omit<AdblockRule, 'id'>) => {
    validateRule(rule)
    return addRule({ ...rule, domain: rule.domain.trim().toLowerCase() })
  })

  ipcMain.handle('adblock:updateRule', (_e, payload: { id: string; patch: Partial<AdblockRule> }) => {
    if (!payload || typeof payload.id !== 'string' || typeof payload.patch !== 'object' || payload.patch === null) {
      throw new AppError('VALIDATION_ERROR', '无效的更新参数')
    }
    validateRule(payload.patch)
    const patch = { ...payload.patch }
    if (patch.domain !== undefined) patch.domain = patch.domain.trim().toLowerCase()
    return updateRule(payload.id, patch)
  })

  ipcMain.handle('adblock:removeRule', (_e, payload: { id: string }) => {
    if (!payload || typeof payload.id !== 'string') throw new AppError('VALIDATION_ERROR', '无效的规则 id')
    removeRule(payload.id)
  })

  ipcMain.handle('adblock:apply', () => apply())

  ipcMain.handle('adblock:restore', (_e, payload: { backupId?: string }) => restore(payload?.backupId))

  ipcMain.handle('adblock:getStatus', () => getStatus())

  ipcMain.handle('adblock:listBackups', () => listBackups())

  ipcMain.on('adblock:relaunchElevated', () => {
    relaunchElevated()
  })
}
