import { AiSettings } from './AiSettings'
import styles from './SettingsPage.module.css'

export function SettingsPage(): JSX.Element {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>设置</h1>
      <AiSettings />
    </div>
  )
}
