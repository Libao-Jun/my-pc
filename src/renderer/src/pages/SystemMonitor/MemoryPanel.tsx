import { useEffect, useState } from 'react'
import type { MemoryInfo } from '@shared/types'
import { InfoCard } from '@renderer/components/InfoCard'
import { InfoRow } from '@renderer/components/InfoRow'
import { ProgressBar } from '@renderer/components/ProgressBar'
import { formatBytes } from '@renderer/utils/format'

export function MemoryPanel(): JSX.Element {
  const [mem, setMem] = useState<MemoryInfo | null>(null)

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      const r = await window.api.system.getMemory()
      if (active && r.ok) setMem(r.data)
    }
    void load()
    const timer = window.setInterval(() => void load(), 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <InfoCard title="内存详情">
      {mem ? (
        <>
          <ProgressBar percent={mem.usedPercent} label="占用" />
          <InfoRow label="已用" value={formatBytes(mem.used)} />
          <InfoRow label="可用" value={formatBytes(mem.free)} />
          <InfoRow label="活跃" value={formatBytes(mem.active)} />
          <InfoRow label="总量" value={formatBytes(mem.total)} />
          <InfoRow label="交换分区" value={formatBytes(mem.swapTotal)} />
        </>
      ) : (
        <>加载中…</>
      )}
    </InfoCard>
  )
}
