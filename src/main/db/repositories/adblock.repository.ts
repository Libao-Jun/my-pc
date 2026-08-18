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
