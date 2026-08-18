import { useEffect, useMemo, useState } from 'react'
import type { NetworkInterface } from '@shared/types'
import { InfoCard } from '@renderer/components/InfoCard'
import { DataTable, type Column } from '@renderer/components/DataTable'

export function NetworkPanel(): JSX.Element {
  const [ifs, setIfs] = useState<NetworkInterface[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void window.api.system.getNetwork().then((r) => {
      if (r.ok) setIfs(r.data)
      setLoading(false)
    })
  }, [])

  const columns: Column<NetworkInterface>[] = useMemo(
    () => [
      { key: 'iface', title: '接口', render: (i) => `${i.iface}${i.isDefault ? ' ⭐' : ''}` },
      { key: 'ip4', title: 'IPv4', render: (i) => i.ip4 || '—' },
      { key: 'mac', title: 'MAC', render: (i) => i.mac || '—' },
      { key: 'dhcp', title: 'DHCP', render: (i) => (i.dhcp ? '开启' : '—') },
      { key: 'subnet', title: '子网掩码', render: (i) => i.subnet || '—' },
      { key: 'dns', title: 'DNS', render: (i) => (i.dns.length ? i.dns.join(', ') : '—') }
    ],
    []
  )

  return (
    <InfoCard title="网络接口">
      <DataTable columns={columns} data={ifs} rowKey={(i) => i.iface} loading={loading} />
    </InfoCard>
  )
}
