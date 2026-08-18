import type { ReactNode } from 'react'
import styles from './InfoCard.module.css'

interface InfoCardProps {
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function InfoCard({ title, children, footer }: InfoCardProps): JSX.Element {
  return (
    <section className={styles.card}>
      <header className={styles.header}>{title}</header>
      <div className={styles.body}>{children}</div>
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  )
}
