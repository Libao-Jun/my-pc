import { useEffect, useMemo, useRef, useState } from 'react'
import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import { inferPreviewType, renderOriginalPreview } from '@renderer/utils/watermarkPreview'
import type { PreviewApi } from '@renderer/utils/watermarkPreview'
import type { WatermarkFileType } from '@shared/types'
import styles from './WatermarkPreview.module.css'

interface Original {
  path: string
  name: string
  type: WatermarkFileType
}

export function WatermarkPreview(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const queue = useWatermarkStore((s) => s.queue)
  const previewPath = useWatermarkStore((s) => s.previewPath)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [original, setOriginal] = useState<Original | null>(null)
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

  // 有效预览目标：队列显式选中 → 队列首个 → 上传原件（兜底）→ null
  const queueTarget = useMemo(
    () => queue.find((q) => q.path === previewPath) ?? queue[0] ?? null,
    [queue, previewPath]
  )
  const target = queueTarget ?? original
  const isQueueMode = queueTarget !== null

  const upload = async (): Promise<void> => {
    const r = await window.api.watermark.pickOriginal()
    if (!r.ok) {
      setError(r.error.message)
      setNote('')
      return
    }
    const path = r.data
    if (!path) return
    const type = inferPreviewType(path)
    if (!type) {
      setError('不支持的文件类型')
      setNote('')
      return
    }
    setOriginal({ path, name: path.split(/[\\/]/).pop() ?? path, type })
    setNote('')
    setError(null)
  }

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

  const displayName = queueTarget ? queueTarget.name : original?.name ?? ''

  return (
    <div className={styles.preview}>
      <h3 className={styles.title}>水印效果预览</h3>
      {!target ? (
        <div className={styles.empty}>
          <p>请上传原件以预览水印效果</p>
          <button type="button" onClick={() => void upload()}>
            上传原件（图片 / PDF / 视频）
          </button>
        </div>
      ) : (
        <>
          <div className={styles.meta}>
            <span className={styles.name} title={target.path}>
              {displayName}
            </span>
            {!isQueueMode && (
              <>
                <button type="button" onClick={() => void upload()}>
                  更换原件
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOriginal(null)
                    setNote('')
                    setError(null)
                  }}
                >
                  清除
                </button>
              </>
            )}
          </div>
          <canvas ref={canvasRef} className={styles.canvas} />
          {note && <p className={styles.note}>{note}</p>}
          {error && <p className={styles.error}>{error}</p>}
        </>
      )}
    </div>
  )
}
