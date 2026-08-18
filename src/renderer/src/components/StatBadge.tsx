import styles from './StatBadge.module.css'

type Tone = 'default' | 'primary' | 'success' | 'warning'

interface StatBadgeProps {
  label: string
  value: string
  sub?: string
  tone?: Tone
}

export function StatBadge({ label, value, sub, tone = 'default' }: StatBadgeProps): JSX.Element {
  return (
    <div className={`${styles.badge} ${styles[tone]}`}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </div>
  )
}
