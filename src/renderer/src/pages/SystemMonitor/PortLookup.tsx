import { useState } from 'react'
import type { PortProcess } from '@shared/types'
import { InfoCard } from '@renderer/components/InfoCard'
import { InfoRow } from '@renderer/components/InfoRow'
import styles from './PortLookup.module.css'

export function PortLookup(): JSX.Element {
  const [port, setPort] = useState('')
  const [result, setResult] = useState<PortProcess | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (): Promise<void> => {
    const value = Number.parseInt(port, 10)
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setError('请输入 1–65535 之间的整数端口号')
      setResult(null)
      setSearched(true)
      return
    }
    setLoading(true)
    setError(null)
    const r = await window.api.system.getPortProcess(value)
    setLoading(false)
    if (r.ok) {
      setResult(r.data)
      setSearched(true)
    } else {
      setError(r.error.message)
      setResult(null)
      setSearched(true)
    }
  }

  return (
    <InfoCard title="端口反查">
      <div className={styles.form}>
        <input
          className={styles.input}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="输入端口号，如 8080"
          inputMode="numeric"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSubmit()
          }}
        />
        <button className={styles.button} onClick={() => void handleSubmit()} disabled={loading}>
          {loading ? '查询中…' : '查询'}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {result && (
        <div className={styles.result}>
          <InfoRow label="进程" value={result.name} />
          <InfoRow label="PID" value={result.pid} />
          <InfoRow label="协议" value={result.protocol.toUpperCase()} />
          <InfoRow label="端口" value={result.port} />
        </div>
      )}

      {searched && !result && !error && <div className={styles.empty}>该端口未被占用</div>}
    </InfoCard>
  )
}
