import { useEffect, useState } from 'react'
import type { CpuInfo } from '@shared/types'
import { InfoCard } from '@renderer/components/InfoCard'
import { InfoRow } from '@renderer/components/InfoRow'
import { ProgressBar } from '@renderer/components/ProgressBar'
import styles from './CpuPanel.module.css'

export function CpuPanel(): JSX.Element {
  const [cpu, setCpu] = useState<CpuInfo | null>(null)

  useEffect(() => {
    let active = true
    const load = async (): Promise<void> => {
      const r = await window.api.system.getCpu()
      if (active && r.ok) setCpu(r.data)
    }
    void load()
    const timer = window.setInterval(() => void load(), 2000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [])

  return (
    <InfoCard title="CPU 详情">
      {cpu ? (
        <>
          <InfoRow label="型号" value={cpu.model} />
          <InfoRow label="核心数" value={`${cpu.cores} 核`} />
          <InfoRow label="主频" value={`${cpu.speedGHz.toFixed(2)} GHz`} />
          <div className={styles.cores}>
            {cpu.perCore.map((load, i) => (
              <ProgressBar key={i} percent={load} label={`#${i}`} />
            ))}
          </div>
        </>
      ) : (
        <span className={styles.muted}>加载中…</span>
      )}
    </InfoCard>
  )
}
