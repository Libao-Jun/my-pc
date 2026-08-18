import styles from './ProgressBar.module.css'

interface ProgressBarProps {
  percent: number
  label?: string
}

export function ProgressBar({ percent, label }: ProgressBarProps): JSX.Element {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className={styles.wrap}>
      {label !== undefined && <span className={styles.label}>{label}</span>}
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${clamped}%` }} />
      </div>
      <span className={styles.percent}>{Math.round(clamped)}%</span>
    </div>
  )
}
