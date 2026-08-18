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
