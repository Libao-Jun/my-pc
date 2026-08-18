import { useEffect, useState } from 'react'

export default function App(): JSX.Element {
  const [version, setVersion] = useState('')
  const [ping, setPing] = useState('')
  const [threshold, setThreshold] = useState<number | null>(null)

  useEffect(() => {
    window.api.app.getVersion().then((r) => {
      if (r.ok) setVersion(r.data)
    })
    window.api.app.ping().then((r) => {
      if (r.ok) setPing(r.data)
    })
    window.api.settings.get().then((r) => {
      if (r.ok) setThreshold(r.data.largeFileThresholdMB)
    })
  }, [])

  return (
    <main style={{ padding: 24 }}>
      <h1>my-pc</h1>
      <p>应用版本：{version || '加载中…'}</p>
      <p>主进程连通性：{ping || '加载中…'}</p>
      <p>大文件阈值：{threshold === null ? '加载中…' : `${threshold} MB`}</p>
    </main>
  )
}
