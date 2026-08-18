import { spawn, spawnSync } from 'node:child_process'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { app } from 'electron'
import { AppError } from '@shared/errors'
import type { AdblockRule, AdblockStatus, ApplyResult, Backup } from '@shared/types'
import { adblockRepository } from '../db/repositories/adblock.repository'
import { SEED_GROUPS } from './adblock/seed-rules'

export const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts'
const BLOCK_BEGIN = '# >>> my-pc 广告拦截 · 开始'
const BLOCK_END = '# >>> my-pc 广告拦截 · 结束'
const MAX_LINES = 500

// —— 域名校验（字面域名，不支持通配符 / 注入字符）——
export function isValidDomain(domain: string): boolean {
  if (domain.length === 0 || domain.length > 253) return false
  const labels = domain.split('.')
  if (labels.length < 2) return false // 屏蔽目标至少是子域
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return false
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return false
  }
  return true
}

// —— hosts 读 / 写 ——

async function readHostsLines(): Promise<string[]> {
  try {
    const raw = await readFile(HOSTS_PATH, 'utf8')
    return raw.replace(/^\uFEFF/, '').split(/\r?\n/) // 剥 UTF-8 BOM
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return [] // 首次写入：按空 hosts 处理
    throw err
  }
}

// 原子写回：写同目录临时文件再 rename（Windows rename 覆盖已存在目标），
// 避免写入中途崩溃留下截断的 hosts 破坏整机解析。
async function writeHosts(lines: string[]): Promise<void> {
  const content = lines.join('\r\n') + '\r\n'
  const tmp = `${HOSTS_PATH}.my-pc.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, HOSTS_PATH)
}

// 定位托管段：返回块起止行号（含标记行）；无块则 begin = -1
function locateBlock(lines: string[]): { begin: number; end: number } {
  let begin = -1
  let end = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t === BLOCK_BEGIN) begin = i
    else if (t === BLOCK_END && begin >= 0) {
      end = i
      break
    }
  }
  // 残缺块（有开始无结束，如用户手动删掉结束标记）：视为无有效块。
  // 否则 applyBlock/restore 里 end+1===0 → slice(0) 会把整个 hosts 拼到块后，整文件重复。
  if (begin >= 0 && end < 0) return { begin: -1, end: -1 }
  return { begin, end }
}

// 组装托管段行（含标记）；规则按域名去重、限制行数
function composeBlock(rules: AdblockRule[]): string[] {
  const seen = new Set<string>()
  const domains: string[] = []
  for (const r of rules) {
    if (seen.has(r.domain)) continue
    seen.add(r.domain)
    domains.push(r.domain)
  }
  const entries = domains.slice(0, MAX_LINES).map((d) => `0.0.0.0 ${d}`)
  return [BLOCK_BEGIN, ...entries, BLOCK_END]
}

// 用启用规则替换托管段；enable 为空时移除托管段
function applyBlock(lines: string[], enabled: AdblockRule[]): string[] {
  const block = locateBlock(lines)
  const newBlock = enabled.length === 0 ? [] : composeBlock(enabled)
  return block.begin >= 0
    ? [...lines.slice(0, block.begin), ...newBlock, ...lines.slice(block.end + 1)]
    : [...lines, ...newBlock]
}

function mapWriteError(err: unknown, action: string): never {
  const e = err as NodeJS.ErrnoException
  if (e.code === 'EACCES' || e.code === 'EPERM') {
    throw new AppError('PERMISSION_DENIED', `${action}需要管理员权限，请以管理员身份重启应用`)
  }
  throw new AppError('INTERNAL', `${action}失败：${e.message}`)
}

// —— DNS 刷新（无需管理员；失败不阻塞）——
function flushDns(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(true)
  return new Promise((resolve) => {
    const child = spawn('ipconfig', ['/flushdns'], { windowsHide: true })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

// —— 管理员权限 ——

export function isElevated(): boolean {
  if (process.platform !== 'win32') return true
  const res = spawnSync('net', ['session'], { windowsHide: true, encoding: 'utf8' })
  return res.status === 0
}

export function relaunchElevated(): void {
  const cmd = app.isPackaged
    ? `Start-Process -FilePath "${process.execPath}" -Verb RunAs`
    : `Start-Process -FilePath "${process.execPath}" -Verb RunAs -ArgumentList "${app.getAppPath()}"`
  spawn('powershell', ['-NoProfile', '-Command', cmd], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  }).unref()
  setTimeout(() => app.exit(0), 300) // 给提权实例启动留一点时间，随后退出当前实例
}

// —— 种子规则（首次读取按需灌入）——

let seededChecked = false

async function ensureSeed(): Promise<void> {
  if (seededChecked) return
  seededChecked = true
  if (adblockRepository.isSeeded()) return
  const rules: Array<Omit<AdblockRule, 'id'>> = []
  for (const g of SEED_GROUPS) {
    for (const d of g.domains) {
      rules.push({ software: g.software, domain: d.domain, category: d.category, enabled: true })
    }
  }
  adblockRepository.seed(rules)
  adblockRepository.markSeeded()
}

// —— 规则 CRUD ——

export async function getRules(): Promise<AdblockRule[]> {
  await ensureSeed()
  return adblockRepository.list()
}

export function addRule(input: Omit<AdblockRule, 'id'>): AdblockRule {
  return adblockRepository.add(input)
}

export function updateRule(id: string, patch: Partial<AdblockRule>): AdblockRule {
  const existing = adblockRepository.getById(id)
  if (!existing) throw new AppError('NOT_FOUND', '规则不存在')
  const next = { ...existing, ...patch }
  adblockRepository.update(id, next)
  return next
}

export function removeRule(id: string): void {
  adblockRepository.remove(id)
}

// —— 应用 / 恢复 / 状态 ——

export async function apply(): Promise<ApplyResult> {
  await ensureSeed()
  const enabled = adblockRepository.list().filter((r) => r.enabled)
  const lines = await readHostsLines()
  const block = locateBlock(lines)
  // 先备份「当前块内容」（含标记；无块则空串），写入失败时回滚该冗余备份
  const prevBlock = block.begin >= 0 ? lines.slice(block.begin, block.end + 1).join('\r\n') : ''
  const backupId = adblockRepository.saveBackup(prevBlock, enabled.length)

  try {
    await writeHosts(applyBlock(lines, enabled))
  } catch (err) {
    adblockRepository.removeBackup(backupId) // hosts 未变，撤销刚建的冗余备份
    mapWriteError(err, '写入 hosts')
  }

  const flushOk = await flushDns()
  return { written: enabled.length, backupId, needsFlushDns: !flushOk }
}

export async function restore(backupId?: string): Promise<void> {
  const backups = adblockRepository.listBackups()
  const id = backupId ?? backups[0]?.id
  if (!id) throw new AppError('NOT_FOUND', '没有可恢复的备份')
  const content = adblockRepository.getBackupContent(id)
  if (content === null) throw new AppError('NOT_FOUND', '备份不存在')

  const lines = await readHostsLines()
  const block = locateBlock(lines)
  const restoreLines = content === '' ? [] : content.split(/\r?\n/)
  const newLines =
    block.begin >= 0
      ? [...lines.slice(0, block.begin), ...restoreLines, ...lines.slice(block.end + 1)]
      : [...lines, ...restoreLines]

  try {
    await writeHosts(newLines)
  } catch (err) {
    mapWriteError(err, '恢复 hosts')
  }
  await flushDns()
}

export async function getStatus(): Promise<AdblockStatus> {
  const rules = adblockRepository.list()
  const backups = adblockRepository.listBackups()
  const lines = await readHostsLines()
  return {
    applied: locateBlock(lines).begin >= 0,
    ruleCount: rules.length,
    enabledCount: rules.filter((r) => r.enabled).length,
    lastAppliedAt: backups[0]?.createdAt ?? null,
    elevated: isElevated()
  }
}

export function listBackups(): Backup[] {
  return adblockRepository.listBackups()
}
