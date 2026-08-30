import { useWatermarkStore } from '@renderer/stores/watermarkStore'
import type { WatermarkHAlign, WatermarkVAlign, WatermarkPageScope, WatermarkLayout } from '@shared/watermark'
import styles from './WatermarkConfigForm.module.css'

const FONTS = ['Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'Arial', 'Georgia']
const LAYOUTS: { value: WatermarkLayout; label: string }[] = [
  { value: 'single', label: '单行' },
  { value: 'multi2', label: '一页两行' },
  { value: 'multi3', label: '一页三行' },
  { value: 'multi6', label: '一页六行' },
  { value: 'multi8', label: '一页八行' }
]
const ALIGN_H: { value: WatermarkHAlign; label: string }[] = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中对齐' },
  { value: 'right', label: '右对齐' }
]
const ALIGN_V: { value: WatermarkVAlign; label: string }[] = [
  { value: 'top', label: '顶部对齐' },
  { value: 'middle', label: '居中对齐' },
  { value: 'bottom', label: '底部对齐' }
]
const SCOPES: { value: WatermarkPageScope; label: string }[] = [
  { value: 'all', label: '全部页面' },
  { value: 'odd', label: '奇数页' },
  { value: 'even', label: '偶数页' }
]

export function WatermarkConfigForm(): JSX.Element {
  const config = useWatermarkStore((s) => s.config)
  const setConfig = useWatermarkStore((s) => s.setConfig)
  const single = config.layout === 'single'

  return (
    <div className={styles.form}>
      <section className={styles.group}>
        <h4 className={styles.groupTitle}>水印文本</h4>
        <label className={styles.field}>
          <span>水印文本</span>
          <input type="text" value={config.text} maxLength={200} onChange={(e) => setConfig({ text: e.target.value })} />
        </label>
        <label className={styles.field}>
          <span>字体</span>
          <select value={config.fontFamily} onChange={(e) => setConfig({ fontFamily: e.target.value })}>
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>字号</span>
          <input type="number" min={1} max={500} value={config.fontSize}
            onChange={(e) => setConfig({ fontSize: Number(e.target.value) || 1 })} />
        </label>
      </section>

      <section className={styles.group}>
        <h4 className={styles.groupTitle}>外观</h4>
        <label className={styles.field}>
          <span>旋转角度</span>
          <input type="number" min={-90} max={90} value={config.rotation}
            onChange={(e) => setConfig({ rotation: Number(e.target.value) })} />
        </label>
        <label className={styles.field}>
          <span>不透明度</span>
          <input type="range" min={0.05} max={1} step={0.05} value={config.opacity}
            onChange={(e) => setConfig({ opacity: Number(e.target.value) })} />
          <em>{config.opacity.toFixed(2)}</em>
        </label>
        <label className={styles.field}>
          <span>布局</span>
          <select value={config.layout} onChange={(e) => setConfig({ layout: e.target.value as WatermarkLayout })}>
            {LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
      </section>

      <section className={`${styles.group}${single ? '' : ` ${styles.disabled}`}`}>
        <h4 className={styles.groupTitle}>文本位置{!single ? '（仅单行生效）' : ''}</h4>
        <label className={styles.field}>
          <span>垂直对齐</span>
          <select value={config.vAlign} disabled={!single}
            onChange={(e) => setConfig({ vAlign: e.target.value as WatermarkVAlign })}>
            {ALIGN_V.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span>水平对齐</span>
          <select value={config.hAlign} disabled={!single}
            onChange={(e) => setConfig({ hAlign: e.target.value as WatermarkHAlign })}>
            {ALIGN_H.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </label>
      </section>

      <section className={styles.group}>
        <h4 className={styles.groupTitle}>应用范围（仅 PDF 生效）</h4>
        <label className={styles.field}>
          <span>应用页面</span>
          <select value={config.pageScope}
            onChange={(e) => setConfig({ pageScope: e.target.value as WatermarkPageScope })}>
            {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </section>
    </div>
  )
}
