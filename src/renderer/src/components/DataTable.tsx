import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import styles from './DataTable.module.css'

export interface Column<T> {
  key: string
  title: string
  render?: (row: T) => ReactNode
  sortable?: boolean
  sortValue?: (row: T) => number
  width?: number | string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T) => string | number
  loading?: boolean
  emptyText?: string
}

interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  loading = false,
  emptyText = '暂无数据'
}: DataTableProps<T>): JSX.Element {
  const [sort, setSort] = useState<SortState | null>(null)

  const sorted = useMemo(() => {
    if (!sort) return data
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return data
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...data].sort((a, b) => dir * (col.sortValue!(a) - col.sortValue!(b)))
  }, [data, sort, columns])

  const toggleSort = (col: Column<T>): void => {
    if (!col.sortable) return
    setSort((prev) => {
      if (prev?.key !== col.key) return { key: col.key, dir: 'asc' }
      if (prev.dir === 'asc') return { key: col.key, dir: 'desc' }
      return null
    })
  }

  if (loading) {
    return <div className={styles.empty}>加载中…</div>
  }

  if (data.length === 0) {
    return <div className={styles.empty}>{emptyText}</div>
  }

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width !== undefined ? { width: col.width } : undefined}
                className={col.sortable ? styles.sortable : undefined}
                onClick={() => toggleSort(col)}
              >
                {col.title}
                {sort?.key === col.key && <span>{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
