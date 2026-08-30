import { useEffect, useMemo, useRef, useState } from 'react'
import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import { renderOriginalPreview } from '@renderer/utils/watermarkPreview'
import type { PreviewApi } from '@renderer/utils/watermarkPreview'
import styles from './WatermarkPreview.module.css'

export function WatermarkPreview(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const queue = useWatermarkStore((s) => s.queue)
  const previewPath = useWatermarkStore((s) => s.previewPath)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const api: PreviewApi = useMemo(
    () => ({
      readBinary: async (path) => window.api.watermark.readBinary(path),
      getVideoInfo: async (path) => window.api.watermark.getVideoInfo(path),
      extractVideoFrame: async (p) => window.api.watermark.extractVideoFrame(p)
    }),
    []
  )

  // 预览目标仅由队列驱动：显式选中（预览按钮）→ 队列首个 → 无
  const target = useMemo(
    () => queue.find((q) => q.path === previewPath) ?? queue[0] ?? null,
    [queue, previewPath]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !target) return
    let cancelled = false
    setError(null)
    renderOriginalPreview(canvas, target.path, target.type, config, api, () => cancelled)
      .then((n) => {
        if (!cancelled) setNote(n)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '预览失败')
      })
    return () => {
      cancelled = true
    }
  }, [target?.path, target?.type, config, api])

  return (
    <div className={styles.preview}>
      <h3 className={styles.title}>水印效果预览</h3>
      {!target ? (
        <div className={styles.empty} />
      ) : (
        <>
          <div className={styles.meta}>
            <span className={styles.name} title={target.path}>
              {target.name}
            </span>
          </div>
          <canvas ref={canvasRef} className={styles.canvas} />
          {note && <p className={styles.note}>{note}</p>}
          {error && <p className={styles.error}>{error}</p>}
        </>
      )}
    </div>
  )
}
