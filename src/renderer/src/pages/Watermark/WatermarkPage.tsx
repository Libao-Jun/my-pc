import { WatermarkConfigForm } from './WatermarkConfigForm'
import { WatermarkQueue } from './WatermarkQueue'
import styles from './WatermarkPage.module.css'

export function WatermarkPage(): JSX.Element {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>水印保护</h1>
      <div className={styles.grid}>
        <div className={styles.left}>
          <WatermarkConfigForm />
        </div>
        <div className={styles.right}>
          <WatermarkQueue />
        </div>
      </div>
    </div>
  )
}
