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
    patch: { keyword?: string; category?: '' | FileCategory; minSizeMB?: number; maxSizeMB?: number },
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
