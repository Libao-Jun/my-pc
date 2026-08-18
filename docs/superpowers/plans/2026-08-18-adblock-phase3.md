# 阶段 3 · 广告屏蔽模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现广告屏蔽模块——hosts 规则管理（按软件分组 + ad/recommend 分类）、托管段应用 / 回滚、管理员权限引导 + 可提权重启、内置种子清单，交付 AdBlocker 页面。目标：hosts 拦截闭环。

**Architecture:** 严格三层：renderer（AdBlocker 页面 + adblockStore）→ preload（`window.api.adblock`）→ main（`adblock.ipc → adblock.service → adblock.repository → node:sqlite`）。核心机制是 **hosts 托管段**：以固定标记包围的块，应用 = 只重写该块，恢复 = 把该块恢复为备份内容；文件其余部分（含用户手动条目）永不触碰。写入采用「临时文件 + rename」原子写回。提权：主进程探测管理员（`net session`），非管理员页面横幅提示，应用遇 EACCES 时弹窗可选「以管理员身份重启」。

**Tech Stack:** Electron 36 · React 18 · TypeScript 5 · Zustand 5 · `node:sqlite`（DatabaseSync）· CSS Modules。**不新增依赖**（提权用 `child_process` + PowerShell，DNS 刷新用 `ipconfig /flushdns`）。

## Global Constraints

- TypeScript 严格模式；禁用 `any`（除非必要）。
- Electron 安全：`contextIsolation: true`、`nodeIntegration: false`；IPC 走 `contextBridge` + `invoke`，只传可序列化数据。
- 通道命名 `domain:action`，全部在 `src/main/ipc/index.ts` 注册。
- 数据库读写只发生在主进程，经 `db/repositories/` 暴露；`node:sqlite` 同步 API，事务用 `BEGIN/COMMIT/ROLLBACK` 手动控制，`PRAGMA` 用 `prepare().get()/exec()`。
- **hosts 是系统关键文件**：只读写托管段（`# >>> my-pc 广告拦截 · 开始/结束` 之间），其余行逐行透传；写回用同目录临时文件 + `rename` 原子替换；写前对启用规则去重；只写字面域名（hosts 不支持通配符）。
- 目标 IP 固定 `0.0.0.0`。
- 渲染层零 Node 权限：一切 hosts 读写 / 提权 / flushdns 都在主进程。
- 时间戳存毫秒（整数）；备份保留最近 10 份。
- 不引 zod / router / 其他新依赖；参数校验用现有手写风格。
- **无测试框架**：每个任务验证 = `npm run typecheck`（node+web）通过；最终端到端手动验收在 Task 9。
- Commit 信息末尾附 `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

### Task 1: 共享契约（adblock 类型 + AdblockApi）

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces: 类型 `AdblockCategory`、`AdblockRule`、`AdblockStatus`、`Backup`、`ApplyResult`、`AdblockApi`。`WindowApi` **不在本任务改动**（`adblock` 字段在 Task 4 与 preload 一并接入，保证每个任务可独立 typecheck）。

- [ ] **Step 1: 在 `src/shared/types.ts` 追加广告屏蔽域类型**

在 `FileApi` 定义之后、`WindowApi` 之前插入：

```ts
// —— 广告屏蔽域（adblock）——
export type AdblockCategory = 'ad' | 'recommend' // ad = 广告，recommend = 个性化推荐

export interface AdblockRule {
  id: string
  software: string // 所属软件分组，如「搜狗输入法」
  domain: string // 屏蔽域名（小写，字面域名，不支持通配符）
  category: AdblockCategory
  enabled: boolean
}

export interface AdblockStatus {
  applied: boolean // hosts 中是否存在托管段
  ruleCount: number
  enabledCount: number
  lastAppliedAt: number | null // 最新备份时间（毫秒）
  elevated: boolean // 当前进程是否具备管理员权限
}

export interface Backup {
  id: string
  createdAt: number
  ruleCount: number
}

export interface ApplyResult {
  written: number // 本次写入的规则数
  backupId: string
  needsFlushDns: boolean // DNS 刷新失败，需提示用户手动 ipconfig /flushdns
}

export interface AdblockApi {
  getRules(): Promise<IpcResult<AdblockRule[]>>
  addRule(rule: Omit<AdblockRule, 'id'>): Promise<IpcResult<AdblockRule>>
  updateRule(id: string, patch: Partial<AdblockRule>): Promise<IpcResult<AdblockRule>>
  removeRule(id: string): Promise<IpcResult<void>>
  apply(): Promise<IpcResult<ApplyResult>>
  restore(backupId?: string): Promise<IpcResult<void>>
  getStatus(): Promise<IpcResult<AdblockStatus>>
  listBackups(): Promise<IpcResult<Backup[]>>
  relaunchElevated(): void // 以管理员身份重启应用
}
```

- [ ] **Step 2: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS（仅新增导出类型，无消费方，不应破坏现有编译）。

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(adblock): 共享契约 adblock 类型 + AdblockApi"
```

---

### Task 2: DB 迁移 v3 + adblock.repository

**Files:**
- Modify: `src/main/db/migrations.ts`
- Create: `src/main/db/repositories/adblock.repository.ts`

**Interfaces:**
- Consumes: `AdblockRule`、`Backup`（Task 1）。
- Produces: `adblockRepository`（`list` / `getById` / `seed` / `add` / `update` / `remove` / `saveBackup` / `removeBackup` / `listBackups` / `getBackupContent` / `pruneBackups` / `isSeeded` / `markSeeded`）。Task 3 使用。

- [ ] **Step 1: 在 `migrations.ts` 追加 version 3**

在 `migrations` 数组末尾（`version: 2` 之后）追加：

```ts
{
  version: 3,
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS adblock_rules (
        id        TEXT PRIMARY KEY,
        software  TEXT NOT NULL,
        domain    TEXT NOT NULL,
        category  TEXT NOT NULL,
        enabled   INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_adblock_software ON adblock_rules(software);
      CREATE TABLE IF NOT EXISTS adblock_backups (
        id         TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        rule_count INTEGER NOT NULL,
        content    TEXT NOT NULL
      );
    `)
  }
}
```

> 只追加，不修改 v1 / v2。`adblock_seeded` 标志复用 `settings` 表（无新表）。

- [ ] **Step 2: 创建 `src/main/db/repositories/adblock.repository.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { AdblockRule, Backup } from '@shared/types'
import { getDb } from '../index'

// enabled 列为 INTEGER（0/1），映射回 boolean
function mapRule(r: AdblockRule): AdblockRule {
  return { ...r, enabled: Boolean(r.enabled) }
}

export const adblockRepository = {
  list(): AdblockRule[] {
    const rows = getDb()
      .prepare('SELECT id, software, domain, category, enabled FROM adblock_rules ORDER BY software COLLATE NOCASE, domain')
      .all() as unknown as AdblockRule[]
    return rows.map(mapRule)
  },

  getById(id: string): AdblockRule | null {
    const row = getDb()
      .prepare('SELECT id, software, domain, category, enabled FROM adblock_rules WHERE id = ?')
      .get(id) as unknown as AdblockRule | undefined
    return row ? mapRule(row) : null
  },

  // 种子批量插入（仅首次灌入）
  seed(rules: Array<Omit<AdblockRule, 'id'>>): void {
    const stmt = getDb().prepare(
      'INSERT INTO adblock_rules (id, software, domain, category, enabled) VALUES (?, ?, ?, ?, ?)'
    )
    getDb().exec('BEGIN')
    try {
      for (const r of rules) stmt.run(randomUUID(), r.software, r.domain, r.category, r.enabled ? 1 : 0)
      getDb().exec('COMMIT')
    } catch (err) {
      getDb().exec('ROLLBACK')
      throw err
    }
  },

  add(rule: Omit<AdblockRule, 'id'>): AdblockRule {
    const id = randomUUID()
    getDb()
      .prepare('INSERT INTO adblock_rules (id, software, domain, category, enabled) VALUES (?, ?, ?, ?, ?)')
      .run(id, rule.software, rule.domain, rule.category, rule.enabled ? 1 : 0)
    return { id, ...rule }
  },

  update(id: string, rule: Omit<AdblockRule, 'id'>): void {
    getDb()
      .prepare('UPDATE adblock_rules SET software = ?, domain = ?, category = ?, enabled = ? WHERE id = ?')
      .run(rule.software, rule.domain, rule.category, rule.enabled ? 1 : 0, id)
  },

  remove(id: string): void {
    getDb().prepare('DELETE FROM adblock_rules WHERE id = ?').run(id)
  },

  // —— hosts 备份 ——

  saveBackup(content: string, ruleCount: number): string {
    const id = randomUUID()
    getDb()
      .prepare('INSERT INTO adblock_backups (id, created_at, rule_count, content) VALUES (?, ?, ?, ?)')
      .run(id, Date.now(), ruleCount, content)
    this.pruneBackups(10)
    return id
  },

  removeBackup(id: string): void {
    getDb().prepare('DELETE FROM adblock_backups WHERE id = ?').run(id)
  },

  listBackups(): Backup[] {
    const rows = getDb()
      .prepare(
        'SELECT id, created_at AS createdAt, rule_count AS ruleCount FROM adblock_backups ORDER BY created_at DESC'
      )
      .all() as unknown as Backup[]
    return rows
  },

  getBackupContent(id: string): string | null {
    const row = getDb()
      .prepare('SELECT content FROM adblock_backups WHERE id = ?')
      .get(id) as { content: string } | undefined
    return row?.content ?? null
  },

  pruneBackups(keep: number): void {
    getDb()
      .prepare(
        `DELETE FROM adblock_backups WHERE id NOT IN (
           SELECT id FROM adblock_backups ORDER BY created_at DESC LIMIT ?
         )`
      )
      .run(keep)
  },

  // —— 种子标志（settings 表复用）——

  isSeeded(): boolean {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = 'adblock_seeded'")
      .get() as { value: string } | undefined
    return row?.value === '1'
  },

  markSeeded(): void {
    getDb()
      .prepare("INSERT INTO settings(key, value) VALUES('adblock_seeded', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run()
  }
}
```

- [ ] **Step 3: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/main/db/migrations.ts src/main/db/repositories/adblock.repository.ts
git commit -m "feat(adblock): DB 迁移 v3（adblock_rules/adblock_backups）+ adblock.repository"
```

---

### Task 3: adblock.service + 种子规则

**Files:**
- Create: `src/main/services/adblock/seed-rules.ts`
- Create: `src/main/services/adblock.service.ts`

**Interfaces:**
- Consumes: `adblockRepository`（Task 2）、`AdblockRule`/`AdblockStatus`/`ApplyResult`/`Backup`（Task 1）。
- Produces: `getRules` / `addRule` / `updateRule` / `removeRule` / `apply` / `restore` / `getStatus` / `listBackups` / `isValidDomain` / `isElevated` / `relaunchElevated`。Task 4 使用。

- [ ] **Step 1: 创建 `src/main/services/adblock/seed-rules.ts`**

```ts
import type { AdblockCategory } from '@shared/types'

export interface SeedGroup {
  software: string
  domains: Array<{ domain: string; category: AdblockCategory }>
}

// 起步种子清单（用户可在 UI 增删改，hosts 不支持通配符，全为字面子域）。
// 提示：域名准确性需按实际软件排查维护，避免屏蔽整站主域。
export const SEED_GROUPS: SeedGroup[] = [
  {
    software: '通用广告网络',
    domains: [
      { domain: 'pagead2.googlesyndication.com', category: 'ad' },
      { domain: 'adservice.google.com', category: 'ad' },
      { domain: 'googleads.g.doubleclick.net', category: 'ad' },
      { domain: 'static.doubleclick.net', category: 'ad' },
      { domain: 'adsrvr.org', category: 'ad' },
      { domain: 'ib.adnxs.com', category: 'ad' }
    ]
  },
  {
    software: '搜狗输入法',
    domains: [
      { domain: 'tuijian.sogou.com', category: 'recommend' },
      { domain: 'mt.sogoucdn.com', category: 'recommend' },
      { domain: 'ad.sogou.com', category: 'ad' }
    ]
  },
  {
    software: '百度输入法',
    domains: [
      { domain: 'cpro.baidu.com', category: 'ad' },
      { domain: 'pos.baidu.com', category: 'ad' },
      { domain: 'nsclick.baidu.com', category: 'ad' }
    ]
  },
  {
    software: '视频播放器',
    domains: [
      { domain: 'ad.qq.com', category: 'ad' },
      { domain: 'vd.l.qq.com', category: 'ad' }
    ]
  }
]
```

- [ ] **Step 2: 创建 `src/main/services/adblock.service.ts`**

```ts
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
```

> 说明：`Backup` 类型仅作 re-export 别名，实际返回由 `adblockRepository.listBackups()` 提供。

- [ ] **Step 3: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/main/services/adblock/seed-rules.ts src/main/services/adblock.service.ts
git commit -m "feat(adblock): adblock.service（托管段应用/恢复 + 提权 + flushdns）+ 种子规则"
```

---

### Task 4: adblock.ipc + preload 接入

**Files:**
- Create: `src/main/ipc/adblock.ipc.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/shared/types.ts`（`WindowApi` 追加 `adblock`）
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `adblock.service`（Task 3）、`AdblockRule`/`AdblockApi`（Task 1）。
- Produces: `window.api.adblock`（Task 6/7 使用）。

- [ ] **Step 1: 创建 `src/main/ipc/adblock.ipc.ts`**

```ts
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
function validateRule(input: Partial<AdblockRule>): void {
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
```

- [ ] **Step 2: 在 `src/main/ipc/index.ts` 注册**

在 `registerFileIpc()` 之后追加：

```ts
import { registerAdblockIpc } from './adblock.ipc'
...
export function registerIpcHandlers(): void {
  registerAppIpc()
  registerSettingsIpc()
  registerSystemIpc()
  registerFileIpc()
  registerAdblockIpc()
}
```

- [ ] **Step 3: `src/shared/types.ts` 的 `WindowApi` 追加 `adblock`**

```ts
export interface WindowApi {
  app: AppApi
  settings: SettingsApi
  system: SystemApi
  file: FileApi
  adblock: AdblockApi
}
```

- [ ] **Step 4: `src/preload/index.ts` 接入 adblock 域**

在 import 块追加类型：`AdblockRule, AdblockStatus, ApplyResult, Backup`。在 `file:` 域之后、`api` 对象末尾追加：

```ts
adblock: {
  getRules: () => invoke<AdblockRule[]>('adblock:getRules'),
  addRule: (rule) => invoke<AdblockRule>('adblock:addRule', rule),
  updateRule: (id, patch) => invoke<AdblockRule>('adblock:updateRule', { id, patch }),
  removeRule: (id) => invoke<void>('adblock:removeRule', { id }),
  apply: () => invoke<ApplyResult>('adblock:apply'),
  restore: (backupId) => invoke<void>('adblock:restore', { backupId }),
  getStatus: () => invoke<AdblockStatus>('adblock:getStatus'),
  listBackups: () => invoke<Backup[]>('adblock:listBackups'),
  relaunchElevated: () => {
    ipcRenderer.send('adblock:relaunchElevated')
  }
}
```

- [ ] **Step 5: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/adblock.ipc.ts src/main/ipc/index.ts src/shared/types.ts src/preload/index.ts
git commit -m "feat(adblock): adblock.ipc + preload 接入 window.api.adblock"
```

---

### Task 5: 共享组件 Switch / Modal / ConfirmDialog / Toast

**Files:**
- Create: `src/renderer/src/components/Switch.tsx` + `.module.css`
- Create: `src/renderer/src/components/Modal.tsx` + `.module.css`
- Create: `src/renderer/src/components/ConfirmDialog.tsx` + `.module.css`
- Create: `src/renderer/src/components/Toast.tsx` + `.module.css`

**Interfaces:**
- Produces: `Switch`（`checked; onChange; disabled?`）、`Modal`（`open; title; onClose; children`）、`ConfirmDialog`（`open; title; description; onConfirm; onCancel; confirmText?; danger?`）、`useToast()`（`(message, tone?) => void`）+ `ToastHost`。Task 7 使用。

- [ ] **Step 1: 创建 `Switch.tsx` + `.module.css`**

```tsx
import styles from './Switch.module.css'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Switch({ checked, onChange, disabled }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`${styles.switch}${checked ? ` ${styles.on}` : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  )
}
```

```css
.switch {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: none;
  background: var(--color-border);
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
  padding: 0;
  flex-shrink: 0;
}
.switch:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.on {
  background: var(--color-primary);
}
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
}
.on .knob {
  left: 18px;
}
```

- [ ] **Step 2: 创建 `Modal.tsx` + `.module.css`**

```tsx
import type { ReactNode } from 'react'
import styles from './Modal.module.css'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ open, title, onClose, children }: ModalProps): JSX.Element | null {
  if (!open) return null // 关闭时返回 null，签名需含 null 才能过严格类型检查
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button type="button" className={styles.close} onClick={onClose}>
            ×
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
```

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.dialog {
  background: var(--color-surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  width: 480px;
  max-width: calc(100vw - var(--space-5) * 2);
  max-height: 80vh;
  overflow-y: auto;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.title {
  font-size: 14px;
  font-weight: 600;
}
.close {
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
  color: var(--color-text-muted);
}
.body {
  padding: var(--space-4);
}
```

- [ ] **Step 3: 创建 `ConfirmDialog.tsx` + `.module.css`**

```tsx
import { Modal } from './Modal'
import styles from './ConfirmDialog.module.css'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
  danger?: boolean
}

export function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmText = '确认',
  danger
}: ConfirmDialogProps): JSX.Element {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className={styles.desc}>{description}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className={`${styles.confirm}${danger ? ` ${styles.danger}` : ''}`}
          onClick={onConfirm}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  )
}
```

```css
.desc {
  margin: 0 0 var(--space-4);
  font-size: 13px;
  color: var(--color-text);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}
.cancel,
.confirm {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 13px;
}
.confirm {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
.danger {
  background: var(--color-danger);
  border-color: var(--color-danger);
}
```

- [ ] **Step 4: 创建 `Toast.tsx` + `.module.css`**

```tsx
import { useEffect, useState } from 'react'
import styles from './Toast.module.css'

type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

// 极简全局消息队列：useToast() 触发，ToastHost 渲染
let nextId = 0
let items: ToastItem[] = []
const listeners = new Set<(items: ToastItem[]) => void>()

function emit(): void {
  for (const l of listeners) l(items)
}

export function useToast(): (message: string, tone?: ToastTone) => void {
  return (message, tone = 'info') => {
    const id = ++nextId
    items = [...items, { id, message, tone }]
    emit()
    setTimeout(() => {
      items = items.filter((t) => t.id !== id)
      emit()
    }, 3000)
  }
}

export function ToastHost(): JSX.Element {
  const [list, setList] = useState<ToastItem[]>([])
  useEffect(() => {
    listeners.add(setList)
    setList(items)
    return () => {
      listeners.delete(setList)
    }
  }, [])
  return (
    <div className={styles.host}>
      {list.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.tone]}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
```

```css
.host {
  position: fixed;
  top: var(--space-4);
  right: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  z-index: 100;
}
.toast {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow);
  font-size: 13px;
}
.success {
  border-left: 3px solid var(--color-success);
}
.error {
  border-left: 3px solid var(--color-danger);
}
.info {
  border-left: 3px solid var(--color-primary);
}
```

- [ ] **Step 5: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Switch.tsx src/renderer/src/components/Switch.module.css src/renderer/src/components/Modal.tsx src/renderer/src/components/Modal.module.css src/renderer/src/components/ConfirmDialog.tsx src/renderer/src/components/ConfirmDialog.module.css src/renderer/src/components/Toast.tsx src/renderer/src/components/Toast.module.css
git commit -m "feat(ui): 共享组件 Switch/Modal/ConfirmDialog/Toast"
```

---

### Task 6: adblockStore

**Files:**
- Create: `src/renderer/src/stores/adblockStore.ts`

**Interfaces:**
- Consumes: `AdblockApi`（Task 1，运行时经 `window.api.adblock`，Task 4 已接入）。
- Produces: `useAdblockStore`（`rules` / `status` / `backups` / `error` / `loading` / `applying` / `load` / `addRule` / `updateRule` / `removeRule` / `apply` / `restore` / `clearError`）。Task 7 使用。

- [ ] **Step 1: 创建 `src/renderer/src/stores/adblockStore.ts`**

```ts
import { create } from 'zustand'
import type { AdblockRule, AdblockStatus, ApplyResult, Backup } from '@shared/types'

interface AdblockState {
  rules: AdblockRule[]
  status: AdblockStatus | null
  backups: Backup[]
  error: string | null
  loading: boolean
  applying: boolean
  load: () => Promise<void>
  addRule: (rule: Omit<AdblockRule, 'id'>) => Promise<boolean>
  updateRule: (id: string, patch: Partial<AdblockRule>) => Promise<boolean>
  removeRule: (id: string) => Promise<boolean>
  apply: () => Promise<ApplyResult | null>
  restore: (backupId?: string) => Promise<boolean>
  clearError: () => void
}

export const useAdblockStore = create<AdblockState>((set, get) => ({
  rules: [],
  status: null,
  backups: [],
  error: null,
  loading: false,
  applying: false,

  load: async () => {
    set({ loading: true, error: null })
    const [rulesR, statusR, backupsR] = await Promise.all([
      window.api.adblock.getRules(),
      window.api.adblock.getStatus(),
      window.api.adblock.listBackups()
    ])
    const next: Partial<AdblockState> = { loading: false }
    if (rulesR.ok) next.rules = rulesR.data
    if (statusR.ok) next.status = statusR.data
    if (backupsR.ok) next.backups = backupsR.data
    if (!rulesR.ok) next.error = rulesR.error.message
    else if (!statusR.ok) next.error = statusR.error.message
    else if (!backupsR.ok) next.error = backupsR.error.message
    set(next)
  },

  addRule: async (rule) => {
    const r = await window.api.adblock.addRule(rule)
    if (r.ok) {
      await get().load()
      return true
    }
    set({ error: r.error.message })
    return false
  },

  updateRule: async (id, patch) => {
    const r = await window.api.adblock.updateRule(id, patch)
    if (r.ok) {
      await get().load()
      return true
    }
    set({ error: r.error.message })
    return false
  },

  removeRule: async (id) => {
    const r = await window.api.adblock.removeRule(id)
    if (r.ok) {
      await get().load()
      return true
    }
    set({ error: r.error.message })
    return false
  },

  apply: async () => {
    set({ applying: true, error: null })
    const r = await window.api.adblock.apply()
    set({ applying: false })
    if (r.ok) {
      await get().load()
      return r.data
    }
    set({ error: r.error.message })
    return null
  },

  restore: async (backupId) => {
    const r = await window.api.adblock.restore(backupId)
    if (r.ok) {
      await get().load()
      return true
    }
    set({ error: r.error.message })
    return false
  },

  clearError: () => set({ error: null })
}))
```

- [ ] **Step 2: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/adblockStore.ts
git commit -m "feat(adblock): adblockStore 状态管理"
```

---

### Task 7: AdBlocker 页面组件 + AdBlockerPage

**Files:**
- Create: `src/renderer/src/pages/AdBlocker/AdBlockerPage.tsx` + `.module.css`
- Create: `src/renderer/src/pages/AdBlocker/ApplyBar.tsx` + `.module.css`
- Create: `src/renderer/src/pages/AdBlocker/RuleGroupList.tsx` + `.module.css`
- Create: `src/renderer/src/pages/AdBlocker/RuleEditor.tsx` + `.module.css`
- Create: `src/renderer/src/pages/AdBlocker/BackupList.tsx` + `.module.css`

**Interfaces:**
- Consumes: `useAdblockStore`（Task 6）、`Switch`/`Modal`/`ConfirmDialog`/`useToast`（Task 5）。
- Produces: `AdBlockerPage`。Task 8 接入 App。

- [ ] **Step 1: 创建 `AdBlockerPage.tsx` + `.module.css`**

```tsx
import { useEffect } from 'react'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import { ApplyBar } from './ApplyBar'
import { RuleGroupList } from './RuleGroupList'
import styles from './AdBlockerPage.module.css'

export function AdBlockerPage(): JSX.Element {
  const load = useAdblockStore((s) => s.load)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>广告屏蔽</h1>
      <ApplyBar />
      <RuleGroupList />
    </div>
  )
}
```

```css
.page {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.title {
  font-size: 20px;
  font-weight: 600;
  margin: 0;
}
```

- [ ] **Step 2: 创建 `ApplyBar.tsx` + `.module.css`**

```tsx
import { useState } from 'react'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { useToast } from '@renderer/components/Toast'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import { BackupList } from './BackupList'
import styles from './ApplyBar.module.css'

export function ApplyBar(): JSX.Element | null {
  const status = useAdblockStore((s) => s.status)
  const applying = useAdblockStore((s) => s.applying)
  const error = useAdblockStore((s) => s.error)
  const apply = useAdblockStore((s) => s.apply)
  const restore = useAdblockStore((s) => s.restore)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [elevOpen, setElevOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const toast = useToast()

  const onApply = async (): Promise<void> => {
    const result = await apply()
    if (result) {
      toast(result.needsFlushDns ? '已写入，请手动刷新 DNS 缓存' : '屏蔽已生效', result.needsFlushDns ? 'info' : 'success')
      return
    }
    // 写入失败：非管理员是常见原因，弹「提权重启」引导（error.code 跨 IPC 不可靠，用 status.elevated 判断）
    if (status?.elevated === false) setElevOpen(true)
    else toast('应用失败', 'error')
  }

  const onRestore = async (): Promise<void> => {
    setRestoreOpen(false)
    const ok = await restore()
    if (ok) toast('已恢复到上次应用前状态', 'success')
    else toast('恢复失败', 'error')
  }

  if (!status) return null

  return (
    <section className={styles.bar}>
      {!status.elevated && (
        <div className={styles.banner}>当前非管理员：hosts 写入需要管理员权限。</div>
      )}
      <div className={styles.status}>
        <span className={styles.item}>
          状态：{status.applied ? '已应用' : '未应用'}
        </span>
        <span className={styles.item}>
          规则 {status.ruleCount} 条 / 启用 {status.enabledCount} 条
        </span>
        {status.lastAppliedAt !== null && (
          <span className={styles.item}>
            上次应用 {new Date(status.lastAppliedAt).toLocaleString()}
          </span>
        )}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={applying} onClick={() => void onApply()}>
          {applying ? '应用中…' : '应用屏蔽'}
        </button>
        <button type="button" disabled={applying} onClick={() => setRestoreOpen(true)}>
          恢复
        </button>
        <button type="button" disabled={applying} onClick={() => setBackupOpen(true)}>
          备份记录
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}

      <ConfirmDialog
        open={restoreOpen}
        title="恢复 hosts"
        description="把 hosts 的托管段恢复到上次应用前的内容，hosts 其余部分不受影响。确定继续？"
        confirmText="恢复"
        danger
        onConfirm={() => void onRestore()}
        onCancel={() => setRestoreOpen(false)}
      />
      <ConfirmDialog
        open={elevOpen}
        title="需要管理员权限"
        description="写入 hosts 需要管理员权限。将以管理员身份重启应用，重启后请重新点击「应用屏蔽」。"
        confirmText="以管理员身份重启"
        onConfirm={() => {
          setElevOpen(false)
          window.api.adblock.relaunchElevated()
        }}
        onCancel={() => setElevOpen(false)}
      />
      <BackupList open={backupOpen} onClose={() => setBackupOpen(false)} />
    </section>
  )
}
```

```css
.bar {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.banner {
  background: var(--color-warning);
  color: #fff;
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  font-size: 13px;
}
.status {
  display: flex;
  gap: var(--space-4);
  font-size: 13px;
  color: var(--color-text-muted);
}
.actions {
  display: flex;
  gap: var(--space-2);
}
.actions button {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 13px;
}
.actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.primary {
  background: var(--color-primary) !important;
  border-color: var(--color-primary) !important;
  color: #fff;
}
.error {
  font-size: 13px;
  color: var(--color-danger);
}
```

- [ ] **Step 3: 创建 `RuleGroupList.tsx` + `.module.css`**

```tsx
import { useMemo, useState } from 'react'
import type { AdblockRule } from '@shared/types'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { Switch } from '@renderer/components/Switch'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import { RuleEditor } from './RuleEditor'
import styles from './RuleGroupList.module.css'

const CATEGORY_LABELS: Record<string, string> = {
  ad: '广告',
  recommend: '个性化推荐'
}

export function RuleGroupList(): JSX.Element {
  const rules = useAdblockStore((s) => s.rules)
  const updateRule = useAdblockStore((s) => s.updateRule)
  const removeRule = useAdblockStore((s) => s.removeRule)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdblockRule | null>(null)
  const [deleting, setDeleting] = useState<AdblockRule | null>(null)

  const groups = useMemo(() => {
    const map = new Map<string, AdblockRule[]>()
    for (const r of rules) {
      const arr = map.get(r.software) ?? []
      arr.push(r)
      map.set(r.software, arr)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [rules])

  const toggleGroup = (software: string, enable: boolean): void => {
    for (const r of rules.filter((x) => x.software === software)) {
      if (r.enabled !== enable) void updateRule(r.id, { enabled: enable })
    }
  }

  return (
    <section className={styles.list}>
      <div className={styles.toolbar}>
        <span className={styles.hint}>按软件分组：组级开关批量启停，组内每条规则可单独开关。</span>
        <button
          type="button"
          className={styles.add}
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          + 新增规则
        </button>
      </div>
      {groups.length === 0 && <div className={styles.empty}>暂无规则，点右上角「新增规则」添加。</div>}
      {groups.map(([software, groupRules]) => {
        const allOn = groupRules.length > 0 && groupRules.every((r) => r.enabled)
        return (
          <div key={software} className={styles.group}>
            <div className={styles.groupHead}>
              <Switch checked={allOn} onChange={(v) => toggleGroup(software, v)} />
              <span className={styles.software}>{software}</span>
              <span className={styles.count}>{groupRules.length} 条</span>
              <button
                type="button"
                className={styles.addInGroup}
                onClick={() => {
                  setEditing({ id: '', software, domain: '', category: 'ad', enabled: true })
                  setEditorOpen(true)
                }}
              >
                + 规则
              </button>
            </div>
            <ul className={styles.rules}>
              {groupRules.map((r) => (
                <li key={r.id} className={styles.rule}>
                  <Switch checked={r.enabled} onChange={(v) => void updateRule(r.id, { enabled: v })} />
                  <code className={styles.domain}>{r.domain}</code>
                  <span className={styles.category}>{CATEGORY_LABELS[r.category]}</span>
                  <div className={styles.ops}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(r)
                        setEditorOpen(true)
                      }}
                    >
                      编辑
                    </button>
                    <button type="button" onClick={() => setDeleting(r)}>
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      <ConfirmDialog
        open={deleting !== null}
        title="删除规则"
        description={deleting ? `确定删除 ${deleting.domain}？` : ''}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (deleting) void removeRule(deleting.id)
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />

      <RuleEditor
        open={editorOpen}
        initial={editing}
        onClose={() => {
          setEditorOpen(false)
          setEditing(null)
        }}
      />
    </section>
  )
}
```

```css
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hint {
  font-size: 12px;
  color: var(--color-text-muted);
}
.add {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}
.empty {
  padding: var(--space-5);
  text-align: center;
  font-size: 13px;
  color: var(--color-text-muted);
}
.group {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  padding: var(--space-3);
}
.groupHead {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.software {
  font-size: 14px;
  font-weight: 600;
}
.count {
  font-size: 12px;
  color: var(--color-text-muted);
}
.addInGroup {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 13px;
}
.rules {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  border-top: 1px solid var(--color-border);
}
.rule {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-1);
  border-bottom: 1px solid var(--color-border);
}
.rule:last-child {
  border-bottom: none;
}
.domain {
  font-size: 13px;
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.category {
  font-size: 12px;
  color: var(--color-text-muted);
  background: var(--color-bg);
  border-radius: 999px;
  padding: 1px 8px;
}
.ops {
  display: flex;
  gap: var(--space-2);
}
.ops button {
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 13px;
}
.ops button:hover {
  color: var(--color-primary);
}
```

- [ ] **Step 4: 创建 `RuleEditor.tsx` + `.module.css`**

```tsx
import { useEffect, useState } from 'react'
import type { AdblockRule } from '@shared/types'
import { Modal } from '@renderer/components/Modal'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import styles from './RuleEditor.module.css'

const SOFTWARE_SUGGESTIONS = ['搜狗输入法', '百度输入法', '浏览器', '视频播放器', '通用广告网络']

interface RuleEditorProps {
  open: boolean
  initial: AdblockRule | null // null = 新增
  onClose: () => void
}

export function RuleEditor({ open, initial, onClose }: RuleEditorProps): JSX.Element {
  const addRule = useAdblockStore((s) => s.addRule)
  const updateRule = useAdblockStore((s) => s.updateRule)
  const [software, setSoftware] = useState('')
  const [domain, setDomain] = useState('')
  const [category, setCategory] = useState<'ad' | 'recommend'>('ad')

  useEffect(() => {
    if (open) {
      setSoftware(initial?.software ?? '')
      setDomain(initial?.domain ?? '')
      setCategory(initial?.category ?? 'ad')
    }
  }, [open, initial])

  const save = async (): Promise<void> => {
    const name = software.trim()
    const d = domain.trim().toLowerCase()
    if (!name || !d) return // 服务端会二次校验并回显错误
    const input = { software: name, domain: d, category, enabled: true } // addRule 入参为 Omit<AdblockRule,'id'>，需含 enabled
    // 组内「+ 规则」传入 { id: '', software, ... } 表示新增，仅真 id 走 updateRule
    const ok = initial?.id ? await updateRule(initial.id, input) : await addRule(input)
    if (ok) onClose()
  }

  return (
    <Modal open={open} title={initial ? '编辑规则' : '新增规则'} onClose={onClose}>
      <div className={styles.form}>
        <label className={styles.field}>
          软件分组
          <input
            list="adblock-software"
            value={software}
            onChange={(e) => setSoftware(e.target.value)}
            placeholder="如 搜狗输入法"
          />
          <datalist id="adblock-software">
            {SOFTWARE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          域名（字面域名，不支持通配符）
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="ad.example.com"
            spellCheck={false}
          />
        </label>
        <label className={styles.field}>
          类别
          <select value={category} onChange={(e) => setCategory(e.target.value as 'ad' | 'recommend')}>
            <option value="ad">广告</option>
            <option value="recommend">个性化推荐</option>
          </select>
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            取消
          </button>
          <button type="button" className={styles.save} onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

```css
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 13px;
  color: var(--color-text-muted);
}
.field input,
.field select {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}
.field input:focus,
.field select:focus {
  outline: none;
  border-color: var(--color-primary);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.cancel,
.save {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 13px;
}
.save {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}
```

- [ ] **Step 5: 创建 `BackupList.tsx` + `.module.css`**

```tsx
import { Modal } from '@renderer/components/Modal'
import { useToast } from '@renderer/components/Toast'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import styles from './BackupList.module.css'

interface BackupListProps {
  open: boolean
  onClose: () => void
}

export function BackupList({ open, onClose }: BackupListProps): JSX.Element {
  const backups = useAdblockStore((s) => s.backups)
  const restore = useAdblockStore((s) => s.restore)
  const toast = useToast()

  const onRestore = async (id: string): Promise<void> => {
    const ok = await restore(id)
    if (ok) {
      toast('已恢复', 'success')
      onClose()
    } else {
      toast('恢复失败', 'error')
    }
  }

  return (
    <Modal open={open} title="hosts 备份记录" onClose={onClose}>
      {backups.length === 0 ? (
        <div className={styles.empty}>暂无备份。应用屏蔽时会自动生成备份（保留最近 10 份）。</div>
      ) : (
        <ul className={styles.list}>
          {backups.map((b) => (
            <li key={b.id} className={styles.item}>
              <div className={styles.meta}>
                <span>{new Date(b.createdAt).toLocaleString()}</span>
                <span className={styles.count}>{b.ruleCount} 条规则</span>
              </div>
              <button type="button" className={styles.restoreBtn} onClick={() => void onRestore(b.id)}>
                恢复
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
```

```css
.empty {
  padding: var(--space-5);
  text-align: center;
  font-size: 13px;
  color: var(--color-text-muted);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
}
.item:last-child {
  border-bottom: none;
}
.meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.count {
  font-size: 12px;
  color: var(--color-text-muted);
}
.restoreBtn {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  cursor: pointer;
  font-size: 13px;
  padding: var(--space-1) var(--space-3);
}
```

- [ ] **Step 6: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/pages/AdBlocker/
git commit -m "feat(adblock): AdBlocker 页面组件（状态条/规则组/编辑器/备份列表）"
```

---

### Task 8: 导航接入 + App 挂载

**Files:**
- Modify: `src/renderer/src/components/layout/SideNav.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `AdBlockerPage`（Task 7）、`ToastHost`（Task 5）。

- [ ] **Step 1: `SideNav.tsx` 的 `PageId` 与 `NAV_ITEMS` 追加广告屏蔽**

```tsx
export type PageId = 'system' | 'files' | 'adblock'
...
const NAV_ITEMS: { id: PageId; label: string }[] = [
  { id: 'system', label: '系统信息' },
  { id: 'files', label: '大文件' },
  { id: 'adblock', label: '广告屏蔽' }
]
```

- [ ] **Step 2: 改写 `App.tsx`**

```tsx
import { useState } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import type { PageId } from './components/layout/SideNav'
import { ToastHost } from './components/Toast'
import { AdBlockerPage } from './pages/AdBlocker/AdBlockerPage'
import { FileManagerPage } from './pages/FileManager/FileManagerPage'
import { SystemOverviewPage } from './pages/SystemMonitor/SystemOverviewPage'

export function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('system')

  return (
    <>
      <AppLayout active={page} onNavigate={setPage}>
        {page === 'system' ? (
          <SystemOverviewPage />
        ) : page === 'files' ? (
          <FileManagerPage />
        ) : (
          <AdBlockerPage />
        )}
      </AppLayout>
      <ToastHost />
    </>
  )
}
```

> `ToastHost` 挂在最外层，供页面内 `useToast()` 渲染消息。

- [ ] **Step 3: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/SideNav.tsx src/renderer/src/App.tsx
git commit -m "feat(adblock): 侧边导航接入广告屏蔽页 + App 挂载 ToastHost"
```

---

### Task 9: 文档同步 + 端到端手动验收

**Files:**
- Modify: `docs/API_SPEC.md`（§5 广告屏蔽域）
- Modify: `docs/COMPONENT_LIBRARY.md`（§1 通用组件 + §3.3 AdBlocker 落地）
- Modify: `docs/DATABASE.md`（§4 repository 行）
- Modify: `docs/modules/ad-blocker.md`（§7 验收勾选）

**Interfaces:**
- 无代码接口；产出更新后的文档与验收结论。

- [ ] **Step 1: 更新 `docs/API_SPEC.md` §5**

- `AdblockRule` 的 `category` 类型改为 `'ad' | 'recommend'`；`AdblockStatus` 追加 `elevated: boolean`。
- 新增通道 `adblock:relaunchElevated`（无参，void，触发以管理员身份重启）。
- `AdblockRule` 注释注明「字面域名，不支持通配符」。
- §8 错误码表 `NOT_FOUND` 触发场景追加「restore 无可用备份」。

- [ ] **Step 2: 更新 `docs/COMPONENT_LIBRARY.md`**

- §1 通用组件表新增：`Switch`、`Modal`、`ConfirmDialog`、`Toast`。
- §3.3 广告屏蔽标注「阶段 3 已落地」，新增 `BackupList` 组件行。

- [ ] **Step 3: 更新 `docs/DATABASE.md`**

- §4 repository 表 `adblock.repository` 方法补全：`list, add, update, remove, saveBackup, listBackups, pruneBackups, isSeeded, markSeeded`。

- [ ] **Step 4: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS（确保文档改动不影响编译）。

- [ ] **Step 5: 端到端手动验收**

Run: `npm run dev`

逐项核对（对应 `docs/modules/ad-blocker.md` §7）：
1. 侧边导航可切换「系统信息 / 大文件 / 广告屏蔽」。
2. 广告屏蔽页显示种子规则（按软件分组），组级开关与单条开关可用，可新增 / 编辑 / 删除规则。
3. 点击「应用屏蔽」→ 成功后 `ping <目标域名>` 返回 `0.0.0.0`（真实机器验证）；应用后 `C:\Windows\System32\drivers\etc\hosts` 中出现托管段，其余内容不变。
4. 再次扫描 hosts：`# >>> my-pc 广告拦截 · 开始` 与 `结束` 之间仅含启用规则；手动在 hosts 其它位置加一行注释，应用后该行保留。
5. 「恢复」→ 托管段回到应用前内容，hosts 其余部分不变。
6. 非管理员运行时（正常启动不提权）：页面顶部显示管理员横幅；点击应用 → 弹「以管理员身份重启」对话框。
7. 重启应用 → 规则与备份仍在（SQLite 持久化生效）。

> 若机器无法真实提权验证，第 6 项至少确认横幅 + 错误提示出现；提权重启需实际以管理员运行后核对。

- [ ] **Step 6: 更新 `docs/modules/ad-blocker.md` §7 验收勾选**

将 §7 各条 `- [ ]` 改为 `- [x]`（验收通过后勾选）。

- [ ] **Step 7: Commit**

```bash
git add docs/API_SPEC.md docs/COMPONENT_LIBRARY.md docs/DATABASE.md docs/modules/ad-blocker.md
git commit -m "docs(adblock): 同步阶段 3 广告屏蔽模块文档"
```

---

## Self-Review 记录

- **Spec coverage**：映射 `docs/modules/ad-blocker.md` 全部验收项 → Task 7 组件（分组开关/规则编辑/应用/恢复）+ Task 8 导航 + Task 9 手动验收逐条覆盖；托管段 / 提权 / 种子清单 → Task 3；`adblock_rules`/`adblock_backups`/`settings.adblock_seeded` → Task 2；`API_SPEC §5` → Task 1/4；`COMPONENT_LIBRARY` → Task 5/7。
- **Placeholder scan**：无 TBD/TODO；每任务含完整代码与验证命令。
- **Type consistency**：`AdblockRule`/`AdblockStatus`/`ApplyResult`/`Backup`/`AdblockApi` 在 Task 1/2/3/4/6/7 签名一致；`adblockRepository` 各方法名与 Task 3 调用一致；`adblock.service` 导出名与 Task 4 import 一致；`window.api.adblock` 在 Task 4 接入、Task 6/7 消费。
- **已知有意偏离**：`WindowApi.adblock` 在 Task 4 追加（而非 Task 1），以保证每任务独立 typecheck；`relaunchElevated` 为新增通道（API_SPEC §5 同步补入）；`AdblockStatus.elevated` 为设计补充（区分 EACCES 与其它写入错误，因 error.code 跨 IPC 不可靠）。
