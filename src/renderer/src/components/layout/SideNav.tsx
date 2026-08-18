import styles from './SideNav.module.css'

export type PageId = 'system' | 'files'

interface SideNavProps {
  active: PageId
  onNavigate: (page: PageId) => void
}

const NAV_ITEMS: { id: PageId; label: string }[] = [
  { id: 'system', label: '系统信息' },
  { id: 'files', label: '大文件' }
]

export function SideNav({ active, onNavigate }: SideNavProps): JSX.Element {
  return (
    <nav className={styles.nav}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.item}${active === item.id ? ` ${styles.active}` : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )
}
