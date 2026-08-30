import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import styles from './WatermarkConfigForm.module.css'

const FONTS = ['Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'Arial', 'Georgia']
const LAYOUTS: { value: string; label: string }[] = [
  { value: 'single', label: '单行' },
  { value: 'multi2', label: '一页两行' },
  { value: 'multi3', label: '一页三行' },
  { value: 'multi6', label: '一页六行' },
  { value: 'multi8', label: '一页八行' }
]
const POSITIONS: { value: string; x: string; y: string }[] = [
  { value: 'top-left', x: '0%', y: '0%' },
  { value: 'top-center', x: '50%', y: '0%' },
  { value: 'top-right', x: '100%', y: '0%' },
  { value: 'center-left', x: '0%', y: '50%' },
  { value: 'center', x: '50%', y: '50%' },
  { value: 'center-right', x: '100%', y: '50%' },
  { value: 'bottom-left', x: '0%', y: '100%' },
  { value: 'bottom-center', x: '50%', y: '100%' },
  { value: 'bottom-right', x: '100%', y: '100%' }
]

export function WatermarkConfigForm(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const setConfig = useWatermarkStore((s) => s.setConfig)
  const single = config.layout === 'single'

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span>水印文本</span>
        <input
          type="text"
          value={config.text}
          maxLength={200}
          onChange={(e) => setConfig({ text: e.target.value })}
        />
      </label>

      <label className={styles.field}>
        <span>字体</span>
        <select value={config.fontFamily} onChange={(e) => setConfig({ fontFamily: e.target.value })}>
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.row}>
        <label className={styles.field}>
          <span>字号</span>
          <input
            type="number"
            min={1}
            max={500}
            value={config.fontSize}
            onChange={(e) => setConfig({ fontSize: Number(e.target.value) || 1 })}
          />
        </label>
        <label className={styles.field}>
          <span>不透明度</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={config.opacity}
            onChange={(e) => setConfig({ opacity: Number(e.target.value) })}
          />
          <em>{config.opacity.toFixed(2)}</em>
        </label>
        <label className={styles.field}>
          <span>旋转角度</span>
          <input
            type="number"
            min={-90}
            max={90}
            value={config.rotation}
            onChange={(e) => setConfig({ rotation: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className={styles.field}>
        <span>布局</span>
        <div className={styles.radios}>
          {LAYOUTS.map((l) => (
            <button
              key={l.value}
              type="button"
              className={`${styles.radio}${config.layout === l.value ? ` ${styles.active}` : ''}`}
              onClick={() => setConfig({ layout: l.value as never })}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`${styles.field}${single ? '' : ` ${styles.disabled}`}`}>
        <span>文本位置{!single ? '（仅单行生效）' : ''}</span>
        <div className={styles.grid9}>
          {POSITIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-label={p.value}
              disabled={!single}
              style={{ left: p.x, top: p.y }}
              className={`${styles.dot}${config.position === p.value ? ` ${styles.dotActive}` : ''}`}
              onClick={() => setConfig({ position: p.value as never })}
            />
          ))}
        </div>
      </div>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={config.applyToAllPages}
          onChange={(e) => setConfig({ applyToAllPages: e.target.checked })}
        />
        应用于全部页面（仅 PDF 生效）
      </label>
    </div>
  )
}
