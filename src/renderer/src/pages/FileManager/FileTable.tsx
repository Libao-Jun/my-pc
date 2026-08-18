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
