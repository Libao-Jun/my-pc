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
