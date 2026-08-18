import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { runMigrations } from './migrations'

let db: DatabaseSync | null = null

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'data.db')
  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  runMigrations(db)
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('数据库未初始化，请先调用 initDatabase()')
  return db
}
