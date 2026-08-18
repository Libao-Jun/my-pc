import type { ReactNode } from 'react'
import { SideNav } from './SideNav'
import type { PageId } from './SideNav'
import styles from './AppLayout.module.css'

interface AppLayoutProps {
  active: PageId
  onNavigate: (page: PageId) => void
  children: ReactNode
}

export function AppLayout({ active, onNavigate, children }: AppLayoutProps): JSX.Element {
  return (
    <div className={styles.layout}>
      <SideNav active={active} onNavigate={onNavigate} />
      <main className={styles.content}>{children}</main>
    </div>
  )
}
