import { useToast } from '@renderer/components/Toast'
import styles from './MermaidCodeView.module.css'

export function MermaidCodeView({ code }: { code: string }): JSX.Element {
  const toast = useToast()
  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      toast('已复制 Mermaid 源码', 'success')
    } catch {
      toast('复制失败，请手动选择复制', 'error')
    }
  }
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>Mermaid 源码</span>
        <button type="button" className={styles.copy} onClick={() => void onCopy()}>
          复制
        </button>
      </div>
      <pre className={styles.code}>{code}</pre>
    </div>
  )
}
