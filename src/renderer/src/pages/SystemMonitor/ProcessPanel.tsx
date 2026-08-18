import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProcessInfo } from '@shared/types'
import { InfoCard } from '@renderer/components/InfoCard'
import { DataTable, type Column } from '@renderer/components/DataTable'
import { formatBytes } from '@renderer/utils/format'

export function ProcessPanel(): JSX.Element {
  const [procs, setProcs] = useState<ProcessInfo[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const r = await window.api.system.getProcesses()
    if (r.ok) setProcs(r.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<ProcessInfo>[] = useMemo(
    () => [
      { key: 'name', title: '进程名', render: (p) => p.name },
      { key: 'pid', title: 'PID', render: (p) => p.pid, sortable: true, sortValue: (p) => p.pid },
      { key: 'cpuPercent', title: 'CPU %', render: (p) => p.cpuPercent.toFixed(2), sortable: true, sortValue: (p) => p.cpuPercent },
      { key: 'memBytes', title: '内存', render: (p) => formatBytes(p.memBytes), sortable: true, sortValue: (p) => p.memBytes },
      { key: 'user', title: '用户', render: (p) => p.user ?? '—' }
    ],
    []
  )

  return (
    <InfoCard title="进程" footer={`共 ${procs.length} 个进程 · 点击列头排序`}>
      <DataTable columns={columns} data={procs} rowKey={(p) => p.pid} loading={loading} />
    </InfoCard>
  )
}
