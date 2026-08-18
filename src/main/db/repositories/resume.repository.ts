import type { Resume } from '@shared/types'
import { getDb } from '../index'

// 单行 default 存整份简历 JSON；load 无行返回 null（页面用空模板）
export const resumeRepository = {
  load(): Resume | null {
    const row = getDb()
      .prepare('SELECT data FROM resumes WHERE key = ?')
      .get('default') as { data: string } | undefined
    return row ? (JSON.parse(row.data) as Resume) : null
  },

  save(resume: Resume): Resume {
    getDb()
      .prepare('INSERT INTO resumes(key, data) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data')
      .run('default', JSON.stringify(resume))
    return resume
  }
}
