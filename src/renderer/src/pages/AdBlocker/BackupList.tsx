import { Modal } from '@renderer/components/Modal'
import { useToast } from '@renderer/components/Toast'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import styles from './BackupList.module.css'

interface BackupListProps {
  open: boolean
  onClose: () => void
}

export function BackupList({ open, onClose }: BackupListProps): JSX.Element {
  const backups = useAdblockStore((s) => s.backups)
  const restore = useAdblockStore((s) => s.restore)
  const toast = useToast()

  const onRestore = async (id: string): Promise<void> => {
    const ok = await restore(id)
    if (ok) {
      toast('已恢复', 'success')
      onClose()
    } else {
      toast('恢复失败', 'error')
    }
  }

  return (
    <Modal open={open} title="hosts 备份记录" onClose={onClose}>
      {backups.length === 0 ? (
        <div className={styles.empty}>暂无备份。应用屏蔽时会自动生成备份（保留最近 10 份）。</div>
      ) : (
        <ul className={styles.list}>
          {backups.map((b) => (
            <li key={b.id} className={styles.item}>
              <div className={styles.meta}>
                <span>{new Date(b.createdAt).toLocaleString()}</span>
                <span className={styles.count}>{b.ruleCount} 条规则</span>
              </div>
              <button type="button" className={styles.restoreBtn} onClick={() => void onRestore(b.id)}>
                恢复
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
