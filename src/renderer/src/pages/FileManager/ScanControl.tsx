import { useEffect, useState } from 'react'
import { useFileStore } from '@renderer/stores/fileStore'
import styles from './ScanControl.module.css'

export function ScanControl(): JSX.Element {
  const scanning = useFileStore((s) => s.scanning)
  const progress = useFileStore((s) => s.progress)
  const startScan = useFileStore((s) => s.startScan)
  const cancelScan = useFileStore((s) => s.cancelScan)

  const [roots, setRoots] = useState<string[]>([])
  const [thresholdMB, setThresholdMB] = useState(100)
  const [presets, setPresets] = useState<{ home: string; drives: string[] }>({
    home: '',
    drives: []
  })

  useEffect(() => {
    void (async () => {
      const [s, p] = await Promise.all([
        window.api.settings.get(),
        window.api.file.getScanPresets()
      ])
      if (s.ok) setThresholdMB(s.data.largeFileThresholdMB)
      if (p.ok) setPresets(p.data)
    })()
  }, [])

  const addRoot = (dir: string): void => {
    setRoots((prev) => (prev.includes(dir) ? prev : [...prev, dir]))
  }

  const removeRoot = (dir: string): void => {
    setRoots((prev) => prev.filter((d) => d !== dir))
  }

  const pickDir = async (): Promise<void> => {
    const r = await window.api.file.pickDirectory()
    if (r.ok && r.data) addRoot(r.data)
  }

  const onStart = (): void => {
    if (roots.length > 0) void startScan(roots, thresholdMB)
  }

  return (
    <section className={styles.card}>
      <div className={styles.row}>
        <span className={styles.label}>扫描目录：</span>
        {roots.length === 0 ? (
          <span className={styles.muted}>未选择，请添加目录</span>
        ) : (
          <div className={styles.roots}>
            {roots.map((r) => (
              <span key={r} className={styles.chip}>
                {r}
                <button type="button" className={styles.chipX} onClick={() => removeRoot(r)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={styles.row}>
        <span className={styles.label}>快捷：</span>
        {presets.home && (
          <button type="button" className={styles.preset} onClick={() => addRoot(presets.home)}>
            用户目录
          </button>
        )}
        {presets.drives.map((d) => (
          <button type="button" key={d} className={styles.preset} onClick={() => addRoot(d)}>
            {d}
          </button>
        ))}
        <button type="button" className={styles.preset} onClick={() => void pickDir()}>
          浏览…
        </button>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>阈值：</span>
        <input
          type="number"
          min={1}
          className={styles.threshold}
          value={thresholdMB}
          onChange={(e) => setThresholdMB(Number(e.target.value) || 1)}
        />
        <span className={styles.muted}>MB（大于等于该值的文件才会被索引）</span>
      </div>

      {scanning ? (
        <div className={styles.row}>
          <button type="button" className={styles.cancel} onClick={cancelScan}>
            取消扫描
          </button>
          <span className={styles.muted}>
            {progress
              ? `已扫描 ${progress.current} 个文件 · ${progress.currentPath}`
              : '扫描中…'}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className={styles.primary}
          onClick={onStart}
          disabled={roots.length === 0}
        >
          开始扫描
        </button>
      )}
    </section>
  )
}
