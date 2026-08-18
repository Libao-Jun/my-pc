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
): Promise<{ files: FileEntry[]; skipped: number; rootOk: boolean }> {
  const files: FileEntry[] = []
  let batch: FileEntry[] = []
  let skipped = 0
  let rootOk = true

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
      if (dir === root) rootOk = false // 根目录不可读：调用方据此跳过 pruneRoot，避免误删整库索引
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
  return { files, skipped, rootOk }
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
  let totalSize = 0
  let skippedTotal = 0

  try {
    for (const root of options.roots) {
      if (controller.cancelled) throw new AppError('CANCELLED', '扫描已取消')
      const { files, skipped, rootOk } = await scanRoot(root, minSizeBytes, emit, controller)
      totalSize += files.reduce((acc, f) => acc + f.size, 0)
      skippedTotal += skipped
      // 仅完整扫描结束才清理失效索引（取消则跳过）；根目录读取失败则跳过清理，避免误删整库
      if (rootOk) fileRepository.pruneRoot(root, new Set(files.map((f) => f.path)))
    }
  } finally {
    activeScan = null
  }

  return { totalSize, skipped: skippedTotal, durationMs: Date.now() - started }
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
