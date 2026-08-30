import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import { WatermarkPreview } from './WatermarkPreview'
import styles from './WatermarkQueue.module.css'

const TYPE_LABEL: Record<string, string> = { image: '图片', pdf: 'PDF', video: '视频' }
const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  done: '完成',
  failed: '失败'
}

export function WatermarkQueue(): JSX.Element {
  const queue = useWatermarkStore((s) => s.queue)
  const processing = useWatermarkStore((s) => s.processing)
  const videoProgress = useWatermarkStore((s) => s.videoProgress)
  const error = useWatermarkStore((s) => s.error)
  const addFiles = useWatermarkStore((s) => s.addFiles)
  const removeItem = useWatermarkStore((s) => s.removeItem)
  const clearQueue = useWatermarkStore((s) => s.clearQueue)
  const run = useWatermarkStore((s) => s.run)
  const cancelVideo = useWatermarkStore((s) => s.cancelVideo)
  const previewPath = useWatermarkStore((s) => s.previewPath)
  const setPreviewPath = useWatermarkStore((s) => s.setPreviewPath)

  const done = queue.filter((q) => q.status === 'done').length
  const failed = queue.filter((q) => q.status === 'failed').length

  const activePath = queue.find((q) => q.path === previewPath)?.path ?? queue[0]?.path ?? null

  return (
    <div className={styles.queue}>
      <div className={styles.actions}>
        <button type="button" onClick={() => void addFiles('image')}>
          选择图片
        </button>
        <button type="button" onClick={() => void addFiles('pdf')}>
          选择 PDF
        </button>
        <button type="button" onClick={() => void addFiles('video')}>
          选择视频
        </button>
      </div>

      <div className={styles.previewArea}>
        <WatermarkPreview />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>文件名</th>
            <th>类型</th>
            <th>状态</th>
            <th>输出</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {queue.map((item) => (
            <tr key={item.path} className={activePath === item.path ? styles.active : undefined}>
              <td className={styles.name}>{item.name}</td>
              <td>{TYPE_LABEL[item.type]}</td>
              <td>{STATUS_LABEL[item.status]}</td>
              <td className={styles.out}>
                {item.outputPath ?? item.error ?? ''}
              </td>
              <td>
                {activePath === item.path ? (
                  <span className={styles.previewing}>预览中</span>
                ) : (
                  <button
                    type="button"
                    className={styles.previewBtn}
                    disabled={processing}
                    onClick={() => setPreviewPath(item.path)}
                  >
                    预览
                  </button>
                )}
                <button
                  type="button"
                  className={styles.remove}
                  disabled={processing}
                  onClick={() => removeItem(item.path)}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {queue.length === 0 && (
            <tr>
              <td colSpan={5} className={styles.empty}>
                尚未选择文件（图片 / PDF 可批量，视频单文件）
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className={styles.footer}>
        <span>
          共 {queue.length} 个 · 完成 {done} · 失败 {failed}
        </span>
        <button type="button" disabled={processing || queue.length === 0} onClick={() => void run()}>
          {processing ? '处理中…' : '开始处理'}
        </button>
        <button type="button" disabled={!processing} onClick={cancelVideo}>
          取消视频
        </button>
        <button type="button" disabled={processing || queue.length === 0} onClick={clearQueue}>
          清空
        </button>
      </div>

      {videoProgress !== null && (
        <div className={styles.progress}>
          <div className={styles.bar} style={{ width: `${videoProgress}%` }} />
        </div>
      )}
    </div>
  )
}
