# 阶段 2 · 大文件管理模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现大文件管理模块——扫描（异步+进度+可取消）、分类、SQLite 索引持久化、搜索/统计，交付 FileManager 页面，并搭建最小侧边导航。

**Architecture:** 严格三层：renderer（FileManager 页面 + fileStore）→ preload（`window.api.file`）→ main（`file.ipc → file.service → file.repository → node:sqlite`）。扫描为长任务：`file:scan` Promise 收尾，进度经 `webContents.send('file:scan:progress')` 推送，`file:scan:cancel` 置取消标志。扫描完成按根目录清理失效索引。

**Tech Stack:** Electron 36 · React 18 · TypeScript 5 · Zustand 5 · `node:sqlite`（DatabaseSync）· CSS Modules。**不新增依赖**。

## Global Constraints

- TypeScript 严格模式；禁用 `any`（除非必要）。
- Electron 安全：`contextIsolation: true`、`nodeIntegration: false`；IPC 走 `contextBridge` + `invoke`，只传可序列化数据。
- 通道命名 `domain:action`，全部在 `src/main/ipc/index.ts` 注册。
- 数据库读写只发生在主进程，经 `db/repositories/` 暴露；`node:sqlite` 同步 API，事务用 `BEGIN/COMMIT/ROLLBACK` 手动控制，`PRAGMA` 用 `prepare().get()/exec()`。
- 大小一律存字节（整数），时间戳存毫秒（整数）。
- 渲染层拿到的是文件元数据，不做任何文件 IO。
- 不引 zod / router / 其他新依赖；参数校验用现有手写风格。
- **无测试框架**：每个任务验证 = `npm run typecheck`（node+web）通过；最终端到端手动验收在 Task 9。
- Commit 信息末尾附 `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

### Task 1: 共享契约（types.ts + FileApi + WindowApi）

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces: 类型 `FileCategory`、`FileEntry`、`ScanOptions`、`ScanProgress`、`ScanResult`、`FileStats`、`SearchQuery`、`FileSearchResult`、`ScanPresets`、`FileApi`；`WindowApi` 追加 `file: FileApi`。后续所有任务 import 这些类型。

- [ ] **Step 1: 在 `src/shared/types.ts` 追加大文件域类型**

在 `SystemOverview` 之后、`AppApi` 之前插入：

```ts
// —— 大文件域（file）——
export type FileCategory = 'video' | 'image' | 'document' | 'audio' | 'archive' | 'other'

export interface FileEntry {
  path: string // 绝对路径，唯一
  name: string
  size: number // 字节
  ext: string // 小写扩展名，不含点
  category: FileCategory
  birthtime: number // 创建时间（毫秒）
  mtime: number // 修改时间（毫秒）
}

export interface ScanOptions {
  roots: string[] // 绝对路径
  minSizeMB: number // 大文件阈值
}

export interface ScanProgress {
  current: number // 已处理文件数
  total: number // 0 = 不定进度（扫描前无法预知总数）
  currentPath: string // 当前遍历目录
}

export interface ScanResult {
  files: FileEntry[]
  totalSize: number
  skipped: number // 权限错误等跳过的目录数
  durationMs: number
}

export interface FileStats {
  byCategory: Record<FileCategory, { count: number; size: number }>
  totalFiles: number
  totalSize: number
}

export interface SearchQuery {
  keyword?: string
  category?: FileCategory
  minSizeMB?: number
  maxSizeMB?: number
  page: number
  pageSize: number
}

export interface FileSearchResult {
  items: FileEntry[]
  total: number
}

export interface ScanPresets {
  home: string // 用户主目录
  drives: string[] // 盘符挂载点，如 ['C:\\']
}
```

- [ ] **Step 2: 追加 `FileApi`**

在 `SystemApi` 之后追加：

```ts
export interface FileApi {
  scan(options: ScanOptions): Promise<IpcResult<ScanResult>>
  cancelScan(): void
  search(query: SearchQuery): Promise<IpcResult<FileSearchResult>>
  getStats(): Promise<IpcResult<FileStats>>
  getScanPresets(): Promise<IpcResult<ScanPresets>>
  pickDirectory(): Promise<IpcResult<string | null>>
  onProgress(cb: (progress: ScanProgress) => void): () => void // 订阅 'file:scan:progress'，返回退订函数
}
```

> **注意：本任务不改 `WindowApi`。** 把 `file: FileApi` 加进 `WindowApi` 会立即破坏 `src/preload/index.ts` 的 typecheck（preload 到 Task 4 才实现 `file` 域）。`WindowApi` 扩展随 Task 4 的 preload 实现一起落地。

- [ ] **Step 3: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS（两段均通过）。

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(file): 大文件域共享契约类型 + FileApi"
```

---

### Task 2: DB 迁移 v2 + file.repository

**Files:**
- Modify: `src/main/db/migrations.ts`
- Create: `src/main/db/repositories/file.repository.ts`

**Interfaces:**
- Consumes: `FileCategory`、`FileEntry`、`FileSearchResult`、`FileStats`、`SearchQuery`（Task 1）。
- Produces: `fileRepository.upsertMany(entries: FileEntry[]): void`、`fileRepository.search(query: SearchQuery): FileSearchResult`、`fileRepository.stats(): FileStats`、`fileRepository.pruneRoot(root: string, seenPaths: Set<string>): void`。Task 3 的 service 调用这四个方法。

- [ ] **Step 1: 追加迁移 v2**

在 `src/main/db/migrations.ts` 的 `migrations` 数组末尾追加：

```ts
  {
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS files (
          path       TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          size       INTEGER NOT NULL,
          ext        TEXT NOT NULL,
          category   TEXT NOT NULL,
          birthtime  INTEGER NOT NULL,
          mtime      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
        CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
        CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
        CREATE INDEX IF NOT EXISTS idx_files_birthtime ON files(birthtime);
      `)
    }
  }
```

- [ ] **Step 2: 创建 `file.repository.ts`**

```ts
import type { FileCategory, FileEntry, FileSearchResult, FileStats, SearchQuery } from '@shared/types'
import { getDb } from '../index'

const MB = 1024 * 1024

export const fileRepository = {
  upsertMany(entries: FileEntry[]): void {
    if (entries.length === 0) return
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO files (path, name, size, ext, category, birthtime, mtime)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        size = excluded.size,
        ext = excluded.ext,
        category = excluded.category,
        birthtime = excluded.birthtime,
        mtime = excluded.mtime
    `)
    db.exec('BEGIN')
    try {
      for (const e of entries) {
        stmt.run(e.path, e.name, e.size, e.ext, e.category, e.birthtime, e.mtime)
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  },

  search(query: SearchQuery): FileSearchResult {
    const db = getDb()
    const where: string[] = []
    const params: (string | number)[] = []

    if (query.keyword) {
      where.push('(name LIKE ? COLLATE NOCASE OR path LIKE ? COLLATE NOCASE)')
      const kw = `%${query.keyword}%`
      params.push(kw, kw)
    }
    if (query.category) {
      where.push('category = ?')
      params.push(query.category)
    }
    if (query.minSizeMB !== undefined) {
      where.push('size >= ?')
      params.push(query.minSizeMB * MB)
    }
    if (query.maxSizeMB !== undefined) {
      where.push('size <= ?')
      params.push(query.maxSizeMB * MB)
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''
    const limit = Math.max(1, query.pageSize)
    const offset = Math.max(0, (query.page - 1) * query.pageSize)

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM files ${whereSql}`)
      .get(...params) as { total: number }
    const rows = db
      .prepare(
        `SELECT path, name, size, ext, category, birthtime, mtime
         FROM files ${whereSql}
         ORDER BY size DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as FileEntry[]

    return { items: rows, total: totalRow.total }
  },

  stats(): FileStats {
    const db = getDb()
    const rows = db
      .prepare('SELECT category, COUNT(*) AS count, SUM(size) AS size FROM files GROUP BY category')
      .all() as { category: FileCategory; count: number; size: number }[]

    const byCategory: FileStats['byCategory'] = {
      video: { count: 0, size: 0 },
      image: { count: 0, size: 0 },
      document: { count: 0, size: 0 },
      audio: { count: 0, size: 0 },
      archive: { count: 0, size: 0 },
      other: { count: 0, size: 0 }
    }
    for (const r of rows) {
      if (byCategory[r.category]) {
        byCategory[r.category] = { count: r.count, size: r.size ?? 0 }
      }
    }
    const agg = db
      .prepare('SELECT COUNT(*) AS totalFiles, COALESCE(SUM(size), 0) AS totalSize FROM files')
      .get() as { totalFiles: number; totalSize: number }

    return { byCategory, totalFiles: agg.totalFiles, totalSize: agg.totalSize }
  },

  pruneRoot(root: string, seenPaths: Set<string>): void {
    const db = getDb()
    const sep = root.endsWith('\\') || root.endsWith('/') ? '' : '/'
    const prefix = `${root}${sep}`
    const existing = db
      .prepare('SELECT path FROM files WHERE path LIKE ?')
      .all(`${prefix}%`) as { path: string }[]

    const stale = existing.filter((r) => !seenPaths.has(r.path)).map((r) => r.path)
    if (stale.length === 0) return

    const del = db.prepare('DELETE FROM files WHERE path = ?')
    db.exec('BEGIN')
    try {
      for (const p of stale) del.run(p)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}
```

> 说明：`pruneRoot` 只在扫描完整结束时调用（见 Task 3），`seenPaths` 为本轮该根目录下所有命中阈值文件的路径集合；`LIKE` 中反斜杠是字面量，`%` 才是通配符，故 `root + sep + '%'` 能正确选中该根下所有已索引路径。

- [ ] **Step 3: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/main/db/migrations.ts src/main/db/repositories/file.repository.ts
git commit -m "feat(file): files 表迁移 v2 + file.repository"
```

---

### Task 3: file.service（扫描 / 分类 / 查询 / 清理）

**Files:**
- Create: `src/main/services/file.service.ts`

**Interfaces:**
- Consumes: `fileRepository`（Task 2）四个方法；类型来自 Task 1；`AppError`（来自 `@shared/errors`）。
- Produces:
  - `scan(options: ScanOptions, emit: (p: ScanProgress) => void): Promise<ScanResult>`
  - `search(query: SearchQuery): Promise<FileSearchResult>`
  - `getStats(): Promise<FileStats>`
  - `getScanPresets(): Promise<ScanPresets>`
  - `cancelScan(): void`

Task 4 的 ipc 调用这五个导出；Task 8 的 ScanControl 通过 `file:getScanPresets` 拿到快捷入口。

- [ ] **Step 1: 创建 `src/main/services/file.service.ts`**

```ts
import os from 'node:os'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { AppError } from '@shared/errors'
import type {
  FileCategory,
  FileEntry,
  FileSearchResult,
  FileStats,
  ScanOptions,
  ScanProgress,
  ScanResult,
  ScanPresets,
  SearchQuery
} from '@shared/types'
import { fileRepository } from '../db/repositories/file.repository'
import { getDisks } from './system.service'

// 扩展名 → 类别映射（小写，不含点）；未命中走 other
const CATEGORY_BY_EXT: Record<string, FileCategory> = {
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video', flv: 'video',
  webm: 'video', m4v: 'video', ts: 'video', mpg: 'video', mpeg: 'video',
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', bmp: 'image',
  svg: 'image', ico: 'image', heic: 'image', tiff: 'image', tif: 'image', psd: 'image',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  ppt: 'document', pptx: 'document', txt: 'document', md: 'document', csv: 'document',
  odt: 'document', epub: 'document',
  mp3: 'audio', wav: 'audio', flac: 'audio', aac: 'audio', ogg: 'audio', m4a: 'audio',
  wma: 'audio', mid: 'audio',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  bz2: 'archive', xz: 'archive', iso: 'archive'
}

// 跳过的系统 / 工程 / 回收站目录
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '$Recycle.Bin',
  'System Volume Information',
  '.git',
  '.svn',
  'Windows',
  'Program Files',
  'Program Files (x86)'
])

const BATCH_SIZE = 200

function categoryForExt(ext: string): FileCategory {
  return CATEGORY_BY_EXT[ext] ?? 'other'
}

// 当前扫描的取消标志；只允许一次扫描活跃（后发覆盖先发，v1 不做排队）
let activeScan: { cancelled: boolean } | null = null

export function cancelScan(): void {
  if (activeScan) activeScan.cancelled = true
}

async function scanRoot(
  root: string,
  minSizeBytes: number,
  emit: (p: ScanProgress) => void,
  controller: { cancelled: boolean }
): Promise<{ files: FileEntry[]; skipped: number }> {
  const files: FileEntry[] = []
  let batch: FileEntry[] = []
  let skipped = 0

  const flush = (): void => {
    if (batch.length > 0) {
      fileRepository.upsertMany(batch)
      batch = []
    }
  }

  const walk = async (dir: string): Promise<void> => {
    if (controller.cancelled) throw new AppError('CANCELLED', '扫描已取消')
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      skipped++ // EACCES / EPERM / 目录已消失
      return
    }
    emit({ current: files.length + batch.length, total: 0, currentPath: dir })

    for (const entry of entries) {
      if (controller.cancelled) throw new AppError('CANCELLED', '扫描已取消')
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue // 防循环
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const st = await stat(full)
        if (st.size < minSizeBytes) continue
        const ext = path.extname(entry.name).slice(1).toLowerCase()
        const fe: FileEntry = {
          path: full,
          name: entry.name,
          size: st.size,
          ext,
          category: categoryForExt(ext),
          birthtime: st.birthtimeMs,
          mtime: st.mtimeMs
        }
        files.push(fe)
        batch.push(fe)
        if (batch.length >= BATCH_SIZE) {
          flush()
          emit({ current: files.length, total: 0, currentPath: dir })
        }
      } catch {
        skipped++ // stat 失败（权限 / 文件已消失）
      }
    }
  }

  await walk(root)
  flush()
  return { files, skipped }
}

export async function scan(
  options: ScanOptions,
  emit: (p: ScanProgress) => void
): Promise<ScanResult> {
  if (
    !options ||
    !Array.isArray(options.roots) ||
    options.roots.length === 0 ||
    !(options.minSizeMB > 0)
  ) {
    throw new AppError('VALIDATION_ERROR', '无效的扫描参数')
  }

  const minSizeBytes = options.minSizeMB * 1024 * 1024
  const controller = { cancelled: false }
  activeScan = controller
  const started = Date.now()
  const allFiles: FileEntry[] = []
  let skippedTotal = 0

  try {
    for (const root of options.roots) {
      if (controller.cancelled) throw new AppError('CANCELLED', '扫描已取消')
      const { files, skipped } = await scanRoot(root, minSizeBytes, emit, controller)
      allFiles.push(...files)
      skippedTotal += skipped
      // 仅完整扫描结束才清理失效索引（取消则跳过）
      fileRepository.pruneRoot(root, new Set(files.map((f) => f.path)))
    }
  } finally {
    activeScan = null
  }

  const totalSize = allFiles.reduce((acc, f) => acc + f.size, 0)
  return { files: allFiles, totalSize, skipped: skippedTotal, durationMs: Date.now() - started }
}

export function search(query: SearchQuery): Promise<FileSearchResult> {
  return Promise.resolve(fileRepository.search(query))
}

export function getStats(): Promise<FileStats> {
  return Promise.resolve(fileRepository.stats())
}

export async function getScanPresets(): Promise<ScanPresets> {
  const home = os.homedir()
  const disks = await getDisks()
  const drives = [...new Set(disks.map((d) => d.mount).filter(Boolean))]
  return { home, drives }
}
```

> 关键点：异步 `readdir` / `stat` 天然让出事件循环，不阻塞主进程；每 `BATCH_SIZE` 批量落库并推一次进度；`pruneRoot` 每根扫描完成后调用一次，取消则不调用。

- [ ] **Step 2: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/main/services/file.service.ts
git commit -m "feat(file): file.service 扫描/分类/查询/失效清理"
```

---

### Task 4: file.ipc + preload（main 与 preload 打通）

**Files:**
- Create: `src/main/ipc/file.ipc.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `scan` / `search` / `getStats` / `getScanPresets` / `cancelScan`（Task 3）；类型来自 Task 1。
- Produces: IPC 通道 `file:scan` / `file:search` / `file:getStats` / `file:getScanPresets` / `file:pickDirectory` / 事件 `file:scan:progress` / 通知 `file:scan:cancel`；preload `window.api.file` 全量方法。Task 5 的 fileStore 消费这些方法。

- [ ] **Step 1: 创建 `src/main/ipc/file.ipc.ts`**

```ts
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
```

- [ ] **Step 2: 在 `src/main/ipc/index.ts` 注册**

改为：

```ts
import { registerAppIpc } from './app.ipc'
import { registerFileIpc } from './file.ipc'
import { registerSettingsIpc } from './settings.ipc'
import { registerSystemIpc } from './system.ipc'

export function registerIpcHandlers(): void {
  registerAppIpc()
  registerSettingsIpc()
  registerSystemIpc()
  registerFileIpc()
}
```

- [ ] **Step 3: 在 `src/preload/index.ts` 追加 file 域**

顶部 import 追加：

```ts
import type { IpcRendererEvent } from 'electron'
import type {
  FileSearchResult,
  FileStats,
  ScanOptions,
  ScanPresets,
  ScanProgress,
  ScanResult,
  SearchQuery
} from '@shared/types'
```

`api` 对象中 `system` 之后追加：

```ts
  file: {
    scan: (options: ScanOptions) => invoke<ScanResult>('file:scan', options),
    cancelScan: () => {
      ipcRenderer.send('file:scan:cancel')
    },
    search: (query: SearchQuery) => invoke<FileSearchResult>('file:search', query),
    getStats: () => invoke<FileStats>('file:getStats'),
    getScanPresets: () => invoke<ScanPresets>('file:getScanPresets'),
    pickDirectory: () => invoke<string | null>('file:pickDirectory'),
    onProgress: (cb) => {
      const listener = (_event: IpcRendererEvent, progress: ScanProgress): void => cb(progress)
      ipcRenderer.on('file:scan:progress', listener)
      return () => {
        ipcRenderer.removeListener('file:scan:progress', listener)
      }
    }
  }
```

- [ ] **Step 4: 扩展 `WindowApi`（在 `src/shared/types.ts`）**

把 `WindowApi` 接口改为：

```ts
export interface WindowApi {
  app: AppApi
  settings: SettingsApi
  system: SystemApi
  file: FileApi
}
```

> `file` 域必须在 preload 实现之后（本任务已加）才引入，保证本任务 typecheck 通过。

- [ ] **Step 5: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/file.ipc.ts src/main/ipc/index.ts src/preload/index.ts src/shared/types.ts
git commit -m "feat(file): file IPC 通道 + preload window.api.file"
```

---

### Task 5: fileStore（zustand）

**Files:**
- Create: `src/renderer/src/stores/fileStore.ts`

**Interfaces:**
- Consumes: `window.api.file.*`（Task 4）；类型来自 Task 1。
- Produces: `useFileStore`（zustand store）。Task 8 的 FileManager 各组件消费。

- [ ] **Step 1: 创建 `src/renderer/src/stores/fileStore.ts`**

```ts
import { create } from 'zustand'
import type { FileEntry, FileStats, ScanProgress, SearchQuery } from '@shared/types'

const PAGE_SIZE = 50
const DEFAULT_QUERY: SearchQuery = { page: 1, pageSize: PAGE_SIZE }

interface FileState {
  scanning: boolean
  progress: ScanProgress | null
  files: FileEntry[]
  total: number
  stats: FileStats | null
  error: string | null
  startScan: (roots: string[], minSizeMB: number) => Promise<void>
  cancelScan: () => void
  search: (query: SearchQuery) => Promise<void>
  loadStats: () => Promise<void>
}

export const useFileStore = create<FileState>((set, get) => ({
  scanning: false,
  progress: null,
  files: [],
  total: 0,
  stats: null,
  error: null,

  startScan: async (roots, minSizeMB) => {
    set({ scanning: true, error: null, progress: null })
    const unsub = window.api.file.onProgress((progress) => set({ progress }))
    try {
      const r = await window.api.file.scan({ roots, minSizeMB })
      if (r.ok) {
        await get().loadStats()
        await get().search({ ...DEFAULT_QUERY })
      } else if (r.error.code !== 'CANCELLED') {
        set({ error: r.error.message })
      }
    } finally {
      unsub()
      set({ scanning: false, progress: null })
    }
  },

  cancelScan: () => {
    window.api.file.cancelScan()
  },

  search: async (query) => {
    const r = await window.api.file.search(query)
    if (r.ok) {
      set({ files: r.data.items, total: r.data.total, query, error: null })
    } else {
      set({ error: r.error.message })
    }
  },

  loadStats: async () => {
    const r = await window.api.file.getStats()
    if (r.ok) set({ stats: r.data })
  }
}))
```

- [ ] **Step 2: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/stores/fileStore.ts
git commit -m "feat(file): fileStore 状态管理"
```

---

### Task 6: 共享组件（SearchInput / Spinner / EmptyState / StatBadge）

**Files:**
- Create: `src/renderer/src/components/SearchInput.tsx` + `.module.css`
- Create: `src/renderer/src/components/Spinner.tsx` + `.module.css`
- Create: `src/renderer/src/components/EmptyState.tsx` + `.module.css`
- Create: `src/renderer/src/components/StatBadge.tsx` + `.module.css`

**Interfaces:**
- Produces: `SearchInput`（`value`/`onChange`/`placeholder?`/`delay?`，防抖）、`Spinner`（`size?`）、`EmptyState`（`title?`/`description?`/`action?`）、`StatBadge`（`label`/`value`/`sub?`/`tone?`）。Task 8 使用。

- [ ] **Step 1: 创建 `SearchInput.tsx` + `.module.css`**

```tsx
import { useEffect, useRef, useState } from 'react'
import styles from './SearchInput.module.css'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  delay?: number
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  delay = 300
}: SearchInputProps): JSX.Element {
  const [text, setText] = useState(value)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setText(value)
  }, [value])

  useEffect(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (text !== value) onChange(text)
    }, delay)
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    }
  }, [text, delay, onChange, value])

  return (
    <input
      className={styles.input}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
    />
  )
}
```

```css
.input {
  flex: 1;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
  color: var(--color-text);
}

.input:focus {
  outline: none;
  border-color: var(--color-primary);
}
```

- [ ] **Step 2: 创建 `Spinner.tsx` + `.module.css`**

```tsx
import styles from './Spinner.module.css'

interface SpinnerProps {
  size?: number
}

export function Spinner({ size = 16 }: SpinnerProps): JSX.Element {
  return <span className={styles.spinner} style={{ width: size, height: size }} />
}
```

```css
.spinner {
  display: inline-block;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

- [ ] **Step 3: 创建 `EmptyState.tsx` + `.module.css`**

```tsx
import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

interface EmptyStateProps {
  title?: string
  description?: string
  action?: ReactNode
}

export function EmptyState({
  title = '暂无数据',
  description,
  action
}: EmptyStateProps): JSX.Element {
  return (
    <div className={styles.empty}>
      <div className={styles.title}>{title}</div>
      {description && <div className={styles.desc}>{description}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  )
}
```

```css
.empty {
  padding: var(--space-5);
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
}

.desc {
  font-size: 13px;
  color: var(--color-text-muted);
}

.action {
  margin-top: var(--space-2);
}
```

- [ ] **Step 4: 创建 `StatBadge.tsx` + `.module.css`**

```tsx
import styles from './StatBadge.module.css'

type Tone = 'default' | 'primary' | 'success' | 'warning'

interface StatBadgeProps {
  label: string
  value: string
  sub?: string
  tone?: Tone
}

export function StatBadge({ label, value, sub, tone = 'default' }: StatBadgeProps): JSX.Element {
  return (
    <div className={`${styles.badge} ${styles[tone]}`}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </div>
  )
}
```

```css
.badge {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-text-muted);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 96px;
}

.primary {
  border-left-color: var(--color-primary);
}

.success {
  border-left-color: var(--color-success);
}

.warning {
  border-left-color: var(--color-warning);
}

.label {
  font-size: 12px;
  color: var(--color-text-muted);
}

.value {
  font-size: 18px;
  font-weight: 600;
}

.sub {
  font-size: 12px;
  color: var(--color-text-muted);
}
```

- [ ] **Step 5: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SearchInput.tsx src/renderer/src/components/SearchInput.module.css src/renderer/src/components/Spinner.tsx src/renderer/src/components/Spinner.module.css src/renderer/src/components/EmptyState.tsx src/renderer/src/components/EmptyState.module.css src/renderer/src/components/StatBadge.tsx src/renderer/src/components/StatBadge.module.css
git commit -m "feat(ui): 共享组件 SearchInput/Spinner/EmptyState/StatBadge"
```

---

### Task 7: 布局与导航（AppLayout + SideNav + App.tsx）

**Files:**
- Create: `src/renderer/src/components/layout/AppLayout.tsx` + `.module.css`
- Create: `src/renderer/src/components/layout/SideNav.tsx` + `.module.css`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `SystemOverviewPage`（已有）、`FileManagerPage`（Task 8，先按路径 import，本任务末 App.tsx 引用的 FileManagerPage 会在 Task 8 创建 —— 为保持每个任务可独立 typecheck，本任务先在 App.tsx 仅挂载 SystemOverviewPage + SideNav，`PageId` 含 `'files'` 但渲染分支留待 Task 8 合入）。
- Produces: `AppLayout`（`active: PageId` / `onNavigate: (p: PageId) => void` / children）、`SideNav`（`active` / `onNavigate`）、`PageId` 类型（`'system' | 'files'`）。Task 8 的 FileManagerPage 接入导航。

> 说明：为保证 Task 7 独立可 typecheck，App.tsx 在本任务先只渲染 SystemOverviewPage；`FileManagerPage` 分支在 Task 8 引入。`PageId` 一次性定义为 `'system' | 'files'`。

- [ ] **Step 1: 创建 `AppLayout.tsx` + `.module.css`**

```tsx
import type { ReactNode } from 'react'
import { SideNav } from './SideNav'
import type { PageId } from './SideNav'
import styles from './AppLayout.module.css'

interface AppLayoutProps {
  active: PageId
  onNavigate: (page: PageId) => void
  children: ReactNode
}

export function AppLayout({ active, onNavigate, children }: AppLayoutProps): JSX.Element {
  return (
    <div className={styles.layout}>
      <SideNav active={active} onNavigate={onNavigate} />
      <main className={styles.content}>{children}</main>
    </div>
  )
}
```

```css
.layout {
  display: flex;
  height: 100vh;
}

.content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
```

- [ ] **Step 2: 创建 `SideNav.tsx` + `.module.css`**

```tsx
import styles from './SideNav.module.css'

export type PageId = 'system' | 'files'

interface SideNavProps {
  active: PageId
  onNavigate: (page: PageId) => void
}

const NAV_ITEMS: { id: PageId; label: string }[] = [
  { id: 'system', label: '系统信息' },
  { id: 'files', label: '大文件' }
]

export function SideNav({ active, onNavigate }: SideNavProps): JSX.Element {
  return (
    <nav className={styles.nav}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.item}${active === item.id ? ` ${styles.active}` : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )
}
```

```css
.nav {
  width: 160px;
  flex-shrink: 0;
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
}

.item {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--color-text-muted);
  cursor: pointer;
}

.item:hover {
  background: var(--color-bg);
}

.active,
.active:hover {
  background: var(--color-primary);
  color: #fff;
}
```

- [ ] **Step 3: 改写 `App.tsx`**

```tsx
import { useState } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import type { PageId } from './components/layout/SideNav'
import { SystemOverviewPage } from './pages/SystemMonitor/SystemOverviewPage'

export function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('system')

  return (
    <AppLayout active={page} onNavigate={setPage}>
      {page === 'system' ? <SystemOverviewPage /> : null}
    </AppLayout>
  )
}
```

> `page === 'files'` 的分支在 Task 8 换成 `<FileManagerPage />`。

- [ ] **Step 4: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/layout/AppLayout.tsx src/renderer/src/components/layout/AppLayout.module.css src/renderer/src/components/layout/SideNav.tsx src/renderer/src/components/layout/SideNav.module.css src/renderer/src/App.tsx
git commit -m "feat(ui): AppLayout + SideNav 最小侧边导航"
```

---

### Task 8: FileManager 页面（Page / ScanControl / CategoryStats / FileSearchBar / FileTable）

**Files:**
- Create: `src/renderer/src/pages/FileManager/FileManagerPage.tsx` + `.module.css`
- Create: `src/renderer/src/pages/FileManager/ScanControl.tsx` + `.module.css`
- Create: `src/renderer/src/pages/FileManager/CategoryStats.tsx` + `.module.css`
- Create: `src/renderer/src/pages/FileManager/FileSearchBar.tsx` + `.module.css`
- Create: `src/renderer/src/pages/FileManager/FileTable.tsx` + `.module.css`
- Modify: `src/renderer/src/App.tsx`（挂载 FileManagerPage 到 `'files'` 分支）

**Interfaces:**
- Consumes: `useFileStore`（Task 5）、共享组件（Task 6）、`AppLayout`/`PageId`（Task 7）、`window.api.file.*` + `window.api.settings.get` + `window.api.system.getDisks`（Task 4）、`formatBytes`/`formatDate`（已有 `@renderer/utils/format`）。
- Produces: `FileManagerPage` 默认导出页面组件。

- [ ] **Step 1: 创建 `FileManagerPage.tsx` + `.module.css`**

```tsx
import { useEffect } from 'react'
import { useFileStore } from '@renderer/stores/fileStore'
import { ScanControl } from './ScanControl'
import { CategoryStats } from './CategoryStats'
import { FileSearchBar } from './FileSearchBar'
import { FileTable } from './FileTable'
import styles from './FileManagerPage.module.css'

export function FileManagerPage(): JSX.Element {
  const stats = useFileStore((s) => s.stats)
  const loadStats = useFileStore((s) => s.loadStats)

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>大文件管理</h1>
      <ScanControl />
      <CategoryStats stats={stats} />
      <FileSearchBar />
      <FileTable />
    </div>
  )
}
```

```css
.page {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 1200px;
  margin: 0 auto;
}

.title {
  margin: 0;
  font-size: 20px;
}
```

- [ ] **Step 2: 创建 `ScanControl.tsx` + `.module.css`**

```tsx
import { useEffect, useState } from 'react'
import { useFileStore } from '@renderer/stores/fileStore'
import styles from './ScanControl.module.css'

export function ScanControl(): JSX.Element {
  const scanning = useFileStore((s) => s.scanning)
  const progress = useFileStore((s) => s.progress)
  const startScan = useFileStore((s) => s.startScan)
  const cancelScan = useFileStore((s) => s.cancelScan)

  const [roots, setRoots] = useState<string[]>([])
  const [thresholdMB, setThresholdMB] = useState(100)
  const [presets, setPresets] = useState<{ home: string; drives: string[] }>({
    home: '',
    drives: []
  })

  useEffect(() => {
    void (async () => {
      const [s, p] = await Promise.all([
        window.api.settings.get(),
        window.api.file.getScanPresets()
      ])
      if (s.ok) setThresholdMB(s.data.largeFileThresholdMB)
      if (p.ok) setPresets(p.data)
    })()
  }, [])

  const addRoot = (dir: string): void => {
    setRoots((prev) => (prev.includes(dir) ? prev : [...prev, dir]))
  }

  const removeRoot = (dir: string): void => {
    setRoots((prev) => prev.filter((d) => d !== dir))
  }

  const pickDir = async (): Promise<void> => {
    const r = await window.api.file.pickDirectory()
    if (r.ok && r.data) addRoot(r.data)
  }

  const onStart = (): void => {
    if (roots.length > 0) void startScan(roots, thresholdMB)
  }

  return (
    <section className={styles.card}>
      <div className={styles.row}>
        <span className={styles.label}>扫描目录：</span>
        {roots.length === 0 ? (
          <span className={styles.muted}>未选择，请添加目录</span>
        ) : (
          <div className={styles.roots}>
            {roots.map((r) => (
              <span key={r} className={styles.chip}>
                {r}
                <button type="button" className={styles.chipX} onClick={() => removeRoot(r)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={styles.row}>
        <span className={styles.label}>快捷：</span>
        {presets.home && (
          <button type="button" className={styles.preset} onClick={() => addRoot(presets.home)}>
            用户目录
          </button>
        )}
        {presets.drives.map((d) => (
          <button type="button" key={d} className={styles.preset} onClick={() => addRoot(d)}>
            {d}
          </button>
        ))}
        <button type="button" className={styles.preset} onClick={() => void pickDir()}>
          浏览…
        </button>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>阈值：</span>
        <input
          type="number"
          min={1}
          className={styles.threshold}
          value={thresholdMB}
          onChange={(e) => setThresholdMB(Number(e.target.value) || 1)}
        />
        <span className={styles.muted}>MB（大于等于该值的文件才会被索引）</span>
      </div>

      {scanning ? (
        <div className={styles.row}>
          <button type="button" className={styles.cancel} onClick={cancelScan}>
            取消扫描
          </button>
          <span className={styles.muted}>
            {progress
              ? `已扫描 ${progress.current} 个文件 · ${progress.currentPath}`
              : '扫描中…'}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className={styles.primary}
          onClick={onStart}
          disabled={roots.length === 0}
        >
          开始扫描
        </button>
      )}
    </section>
  )
}
```

```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.label {
  font-size: 13px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.muted {
  font-size: 12px;
  color: var(--color-text-muted);
}

.roots {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.chipX {
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1;
  padding: 0;
}

.preset {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: 12px;
  cursor: pointer;
}

.preset:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.threshold {
  width: 88px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.primary {
  align-self: flex-start;
  padding: var(--space-2) var(--space-4);
  border: none;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cancel {
  padding: var(--space-2) var(--space-4);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-danger);
  font-size: 14px;
  cursor: pointer;
}
```

- [ ] **Step 3: 创建 `CategoryStats.tsx` + `.module.css`**

```tsx
import type { FileStats } from '@shared/types'
import { StatBadge } from '@renderer/components/StatBadge'
import { formatBytes } from '@renderer/utils/format'
import styles from './CategoryStats.module.css'

const CATEGORY_LABELS: Record<string, string> = {
  video: '视频',
  image: '图片',
  document: '文档',
  audio: '音频',
  archive: '压缩包',
  other: '其他'
}

export function CategoryStats({ stats }: { stats: FileStats | null }): JSX.Element | null {
  if (!stats || stats.totalFiles === 0) return null

  return (
    <section className={styles.stats}>
      {Object.entries(stats.byCategory).map(([key, v]) => (
        <StatBadge
          key={key}
          label={CATEGORY_LABELS[key] ?? key}
          value={`${v.count}`}
          sub={formatBytes(v.size)}
        />
      ))}
      <StatBadge
        label="合计"
        value={`${stats.totalFiles}`}
        sub={formatBytes(stats.totalSize)}
        tone="primary"
      />
    </section>
  )
}
```

```css
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
```

- [ ] **Step 4: 创建 `FileSearchBar.tsx` + `.module.css`**

```tsx
import { useEffect, useState } from 'react'
import type { FileCategory, SearchQuery } from '@shared/types'
import { SearchInput } from '@renderer/components/SearchInput'
import { useFileStore } from '@renderer/stores/fileStore'
import styles from './FileSearchBar.module.css'

const PAGE_SIZE = 50

const CATEGORY_OPTIONS: { value: '' | FileCategory; label: string }[] = [
  { value: '', label: '全部分类' },
  { value: 'video', label: '视频' },
  { value: 'image', label: '图片' },
  { value: 'document', label: '文档' },
  { value: 'audio', label: '音频' },
  { value: 'archive', label: '压缩包' },
  { value: 'other', label: '其他' }
]

export function FileSearchBar(): JSX.Element {
  const search = useFileStore((s) => s.search)
  const total = useFileStore((s) => s.total)

  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<'' | FileCategory>('')
  const [minMB, setMinMB] = useState('')
  const [maxMB, setMaxMB] = useState('')
  const [page, setPage] = useState(1)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const buildQuery = (
    patch: { keyword?: string; category?: string; minSizeMB?: number; maxSizeMB?: number },
    nextPage: number
  ): SearchQuery => ({
    keyword: (patch.keyword ?? keyword).trim() || undefined,
    category: (patch.category ?? category) || undefined,
    minSizeMB: patch.minSizeMB ?? (minMB ? Number(minMB) : undefined),
    maxSizeMB: patch.maxSizeMB ?? (maxMB ? Number(maxMB) : undefined),
    page: nextPage,
    pageSize: PAGE_SIZE
  })

  useEffect(() => {
    void search(buildQuery({}, 1))
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const go = (next: number): void => {
    const clamped = Math.max(1, Math.min(totalPages, next))
    setPage(clamped)
    void search(buildQuery({}, clamped))
  }

  return (
    <section className={styles.bar}>
      <SearchInput
        value={keyword}
        onChange={(v) => {
          setKeyword(v)
          setPage(1)
          void search(buildQuery({ keyword: v }, 1))
        }}
        placeholder="按文件名 / 路径搜索"
      />
      <select
        className={styles.select}
        value={category}
        onChange={(e) => {
          const v = e.target.value as '' | FileCategory
          setCategory(v)
          setPage(1)
          void search(buildQuery({ category: v }, 1))
        }}
      >
        {CATEGORY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input
        className={styles.size}
        type="number"
        min={1}
        placeholder="最小 MB"
        value={minMB}
        onChange={(e) => {
          const v = e.target.value
          setMinMB(v)
          setPage(1)
          void search(buildQuery({ minSizeMB: v ? Number(v) : undefined }, 1))
        }}
      />
      <span className={styles.tilde}>~</span>
      <input
        className={styles.size}
        type="number"
        min={1}
        placeholder="最大 MB"
        value={maxMB}
        onChange={(e) => {
          const v = e.target.value
          setMaxMB(v)
          setPage(1)
          void search(buildQuery({ maxSizeMB: v ? Number(v) : undefined }, 1))
        }}
      />
      <div className={styles.pager}>
        <button type="button" disabled={page <= 1} onClick={() => go(page - 1)}>
          上一页
        </button>
        <span className={styles.pageInfo}>
          {page} / {totalPages}
        </span>
        <button type="button" disabled={page >= totalPages} onClick={() => go(page + 1)}>
          下一页
        </button>
      </div>
    </section>
  )
}
```

```css
.bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.select {
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--color-surface);
}

.size {
  width: 84px;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.tilde {
  color: var(--color-text-muted);
}

.pager {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.pager button {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  font-size: 12px;
  cursor: pointer;
}

.pager button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pageInfo {
  font-size: 12px;
  color: var(--color-text-muted);
}
```

- [ ] **Step 5: 创建 `FileTable.tsx` + `.module.css`**

```tsx
import type { FileEntry } from '@shared/types'
import { DataTable } from '@renderer/components/DataTable'
import { EmptyState } from '@renderer/components/EmptyState'
import { Spinner } from '@renderer/components/Spinner'
import { formatBytes, formatDate } from '@renderer/utils/format'
import { useFileStore } from '@renderer/stores/fileStore'
import styles from './FileTable.module.css'

const CATEGORY_LABELS: Record<string, string> = {
  video: '视频',
  image: '图片',
  document: '文档',
  audio: '音频',
  archive: '压缩包',
  other: '其他'
}

export function FileTable(): JSX.Element {
  const files = useFileStore((s) => s.files)
  const scanning = useFileStore((s) => s.scanning)
  const error = useFileStore((s) => s.error)
  const total = useFileStore((s) => s.total)
  const stats = useFileStore((s) => s.stats)

  if (error) return <div className={styles.error}>{error}</div>

  if (stats && stats.totalFiles === 0 && !scanning) {
    return (
      <EmptyState
        title="尚未扫描"
        description="在上方选择目录并开始扫描，大文件索引将出现在这里"
      />
    )
  }

  if (scanning && files.length === 0) {
    return (
      <div className={styles.loading}>
        <Spinner /> 扫描中…
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.meta}>共 {total} 个大文件</div>
      <DataTable<FileEntry>
        rowKey={(f) => f.path}
        data={files}
        columns={[
          { key: 'name', title: '名称', render: (f) => <span title={f.path}>{f.name}</span> },
          {
            key: 'category',
            title: '分类',
            render: (f) => <span className={styles.tag}>{CATEGORY_LABELS[f.category] ?? f.category}</span>
          },
          {
            key: 'size',
            title: '大小',
            sortable: true,
            sortValue: (f) => f.size,
            render: (f) => formatBytes(f.size)
          },
          {
            key: 'mtime',
            title: '修改时间',
            sortable: true,
            sortValue: (f) => f.mtime,
            render: (f) => formatDate(f.mtime)
          },
          { key: 'path', title: '路径', render: (f) => <span className={styles.path}>{f.path}</span> }
        ]}
      />
    </div>
  )
}
```

```css
.wrap {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.meta {
  font-size: 13px;
  color: var(--color-text-muted);
}

.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  font-size: 12px;
  color: var(--color-text-muted);
}

.path {
  color: var(--color-text-muted);
  font-size: 12px;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.loading {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--color-text-muted);
  padding: var(--space-5);
}

.error {
  padding: var(--space-3);
  background: #fef2f2;
  color: var(--color-danger);
  border: 1px solid #fecaca;
  border-radius: var(--radius);
  font-size: 13px;
}
```

- [ ] **Step 6: 挂载 FileManagerPage 到 App.tsx**

将 `App.tsx` 改为：

```tsx
import { useState } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import type { PageId } from './components/layout/SideNav'
import { FileManagerPage } from './pages/FileManager/FileManagerPage'
import { SystemOverviewPage } from './pages/SystemMonitor/SystemOverviewPage'

export function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('system')

  return (
    <AppLayout active={page} onNavigate={setPage}>
      {page === 'system' ? <SystemOverviewPage /> : <FileManagerPage />}
    </AppLayout>
  )
}
```

- [ ] **Step 7: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/pages/FileManager src/renderer/src/App.tsx
git commit -m "feat(file): FileManager 页面（扫描/统计/搜索/列表）"
```

---

### Task 9: 文档同步 + 端到端手动验收

**Files:**
- Modify: `docs/API_SPEC.md`（§4 大文件域）
- Modify: `docs/COMPONENT_LIBRARY.md`（新增 4 个共享组件 + FileManager 落地标注）
- Modify: `docs/modules/large-file-manager.md`（标记已定决策）

**Interfaces:**
- 无代码接口；产出更新后的文档与验收结论。

- [ ] **Step 1: 更新 `docs/API_SPEC.md` §4**

- `file:search` 返回改为 `FileSearchResult { items, total }`。
- 新增 `file:getScanPresets → ScanPresets` 与 `file:pickDirectory → string | null`。
- 删除 `file:getByCategory` 通道行，并在类型块加注释：分类筛选由 `file:search` 的 `category` 覆盖，`getByCategory` 不实现。
- 补充类型定义：`ScanPresets { home: string; drives: string[] }`、`FileSearchResult { items: FileEntry[]; total: number }`。

- [ ] **Step 2: 更新 `docs/COMPONENT_LIBRARY.md`**

- 在 §1 通用组件表新增：`SearchInput`、`Spinner`、`EmptyState`、`StatBadge`。
- §3.2 FileManager 组件标注为已落地；在布局导航 §2 标注 `AppLayout`/`SideNav` 已落地。

- [ ] **Step 3: 更新 `docs/modules/large-file-manager.md`**

- §3 IPC 接口：注明 `file:search` 返回 `FileSearchResult`；移除 `file:getByCategory`；新增 `file:getScanPresets` / `file:pickDirectory`。
- §6 关键实现要点补充：重扫清理失效索引（仅完整扫描）、最小侧边导航已搭建、快捷目录入口。

- [ ] **Step 4: typecheck 验证**

Run: `npm run typecheck`
Expected: PASS（确保文档改动不影响编译）。

- [ ] **Step 5: 端到端手动验收**

Run: `npm run dev`

逐项核对：
1. 侧边导航可切换「系统信息 / 大文件」。
2. 大文件页：点「用户目录」或盘符快捷按钮（或「浏览…」选目录），设置阈值，点「开始扫描」→ 进度显示已扫描数量与当前路径。
3. 扫描中「取消扫描」可中止，无报错残留。
4. 扫描后分类统计徽标展示各分类数量 / 大小。
5. 搜索框输入关键字（文件名 / 路径）、切换分类、设置大小范围、翻页，结果符合预期。
6. 重启应用 → 大文件页统计与搜索结果仍在（SQLite 持久化生效）。
7. 手动删除某个已被索引的文件，再次扫描该目录 → 该文件从列表消失（失效清理生效）。

- [ ] **Step 6: Commit**

```bash
git add docs/API_SPEC.md docs/COMPONENT_LIBRARY.md docs/modules/large-file-manager.md
git commit -m "docs(file): 同步阶段 2 大文件模块文档"
```

---

## Self-Review 记录

- **Spec coverage**：映射 `docs/modules/large-file-manager.md` 全部验收项 → Task 8 组件（扫描/取消/分类/搜索/持久化）与 Task 9 手动验收逐条覆盖；`DATABASE.md §2.1` files 表与索引 → Task 2；`API_SPEC.md §4` → Task 1/4；`COMPONENT_LIBRARY.md` → Task 6/8。
- **Placeholder scan**：无 TBD/TODO；每任务含完整代码与验证命令。
- **Type consistency**：`FileSearchResult.items/total`、`FileApi` 六方法、`fileRepository` 四方法、`scan/search/getStats/getScanPresets/cancelScan` 导出在任务间签名一致；`ScanPresets.home/drives` 在 Task 1/3/4/8 一致。
- **已知有意偏离**（设计已确认）：`file:search` 返回 `FileSearchResult`；新增 `pickDirectory`/`getScanPresets`；不实现 `getByCategory`；扫描进度 `total: 0` 表示不定进度。
