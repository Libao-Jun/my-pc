import type { FileCategory, FileEntry, FileSearchResult, FileStats, SearchQuery } from '@shared/types'
import path from 'node:path'
import { getDb } from '../index'

const MB = 1024 * 1024

// SQLite LIKE 通配符转义：`\`、`%`、`_` 都需转义（ESCAPE '\'）
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`)
}

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

    const keyword = query.keyword?.trim() ?? ''
    if (keyword) {
      const kw = `%${escapeLike(keyword)}%`
      where.push("(name COLLATE NOCASE LIKE ? ESCAPE '\\' OR path COLLATE NOCASE LIKE ? ESCAPE '\\')")
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
    const offset = Math.max(0, (query.page - 1) * limit)

    const totalRow = db
      .prepare(`SELECT COUNT(*) AS total FROM files ${whereSql}`)
      .get(...params) as { total: number }
    const rows = db
      .prepare(
        `SELECT path, name, size, ext, category, birthtime, mtime
         FROM files ${whereSql}
         ORDER BY size DESC, path ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as unknown as FileEntry[]

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
    const sep = root.endsWith('\\') || root.endsWith('/') ? '' : path.sep
    const prefix = `${root}${sep}`
    const existing = db
      .prepare("SELECT path FROM files WHERE path LIKE ? ESCAPE '\\'")
      .all(`${escapeLike(prefix)}%`) as { path: string }[]

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
