import type { DatabaseSync } from 'node:sqlite'

interface Migration {
  version: number
  up: (db: DatabaseSync) => void
}

// 只追加，不修改历史迁移；用 PRAGMA user_version 记录版本
const migrations: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
    }
  },
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
]

export function runMigrations(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  const current = row.user_version

  for (const m of migrations) {
    if (m.version > current) {
      db.exec('BEGIN')
      try {
        m.up(db)
        db.exec(`PRAGMA user_version = ${m.version}`)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }
  }
}
