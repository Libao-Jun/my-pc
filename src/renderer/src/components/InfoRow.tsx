import type { ReactNode } from 'react'
import styles from './InfoRow.module.css'

interface InfoRowProps {
  label: string
  value: ReactNode
}

export function InfoRow({ label, value }: InfoRowProps): JSX.Element {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  )
}
