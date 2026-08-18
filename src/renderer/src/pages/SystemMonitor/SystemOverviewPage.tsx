import { useEffect } from 'react'
import { useSystemStore } from '@renderer/stores/systemStore'
import { formatBytes } from '@renderer/utils/format'
import { InfoCard } from '@renderer/components/InfoCard'
import { InfoRow } from '@renderer/components/InfoRow'
import { ProgressBar } from '@renderer/components/ProgressBar'
import { CpuPanel } from './CpuPanel'
import { MemoryPanel } from './MemoryPanel'
import { DiskPanel } from './DiskPanel'
import { NetworkPanel } from './NetworkPanel'
import { ProcessPanel } from './ProcessPanel'
import { PortLookup } from './PortLookup'
import styles from './SystemOverviewPage.module.css'

export function SystemOverviewPage(): JSX.Element {
  const overview = useSystemStore((s) => s.overview)
  const error = useSystemStore((s) => s.error)
  const startPolling = useSystemStore((s) => s.startPolling)

  useEffect(() => startPolling(2000), [startPolling])

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>系统信息</h1>
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.summary}>
        <InfoCard title="操作系统">
          {overview ? (
            <>
              <InfoRow label="系统" value={overview.os.distro} />
              <InfoRow label="架构" value={overview.os.arch} />
              <InfoRow label="平台" value={overview.os.platform} />
              <InfoRow label="版本" value={overview.os.release} />
            </>
          ) : (
            <span className={styles.muted}>加载中…</span>
          )}
        </InfoCard>

        <InfoCard title="CPU">
          {overview ? (
            <>
              <InfoRow label="型号" value={overview.cpu.model} />
              <InfoRow label="核心数" value={`${overview.cpu.cores} 核`} />
              <ProgressBar percent={overview.cpu.loadPercent} label="负载" />
            </>
          ) : (
            <span className={styles.muted}>加载中…</span>
          )}
        </InfoCard>

        <InfoCard title="内存">
          {overview ? (
            <>
              <InfoRow label="已用" value={formatBytes(overview.memory.used)} />
              <InfoRow label="总量" value={formatBytes(overview.memory.total)} />
              <ProgressBar percent={overview.memory.usedPercent} label="占用" />
            </>
          ) : (
            <span className={styles.muted}>加载中…</span>
          )}
        </InfoCard>
      </div>

      <div className={styles.grid}>
        <CpuPanel />
        <MemoryPanel />
        <DiskPanel />
        <NetworkPanel />
        <ProcessPanel />
        <PortLookup />
      </div>
    </div>
  )
}
