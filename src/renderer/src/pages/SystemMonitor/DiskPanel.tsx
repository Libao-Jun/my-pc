import { useEffect, useMemo, useState } from 'react'
import type { DiskInfo } from '@shared/types'
import { InfoCard } from '@renderer/components/InfoCard'
import { DataTable, type Column } from '@renderer/components/DataTable'
import { formatBytes, formatPercent } from '@renderer/utils/format'

export function DiskPanel(): JSX.Element {
  const [disks, setDisks] = useState<DiskInfo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void window.api.system.getDisks().then((r) => {
      if (r.ok) setDisks(r.data)
      setLoading(false)
    })
  }, [])

  const columns: Column<DiskInfo>[] = useMemo(
    () => [
      { key: 'device', title: '设备', render: (d) => d.device },
      { key: 'mount', title: '挂载点', render: (d) => d.mount },
      { key: 'fsType', title: '类型', render: (d) => d.fsType },
      { key: 'total', title: '总量', render: (d) => formatBytes(d.total), sortable: true, sortValue: (d) => d.total },
      { key: 'used', title: '已用', render: (d) => formatBytes(d.used), sortable: true, sortValue: (d) => d.used },
      { key: 'usedPercent', title: '占用', render: (d) => formatPercent(d.usedPercent), sortable: true, sortValue: (d) => d.usedPercent }
    ],
    []
  )

  return (
    <InfoCard title="磁盘">
      <DataTable columns={columns} data={disks} rowKey={(d) => d.device} loading={loading} />
    </InfoCard>
  )
}
