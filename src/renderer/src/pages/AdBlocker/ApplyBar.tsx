import { useState } from 'react'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { useToast } from '@renderer/components/Toast'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import { BackupList } from './BackupList'
import styles from './ApplyBar.module.css'

export function ApplyBar(): JSX.Element | null {
  const status = useAdblockStore((s) => s.status)
  const applying = useAdblockStore((s) => s.applying)
  const error = useAdblockStore((s) => s.error)
  const apply = useAdblockStore((s) => s.apply)
  const restore = useAdblockStore((s) => s.restore)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [elevOpen, setElevOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const toast = useToast()

  const onApply = async (): Promise<void> => {
    const result = await apply()
    if (result) {
      toast(result.needsFlushDns ? '已写入，请手动刷新 DNS 缓存' : '屏蔽已生效', result.needsFlushDns ? 'info' : 'success')
      return
    }
    // 写入失败：非管理员是常见原因，弹「提权重启」引导（error.code 跨 IPC 不可靠，用 status.elevated 判断）
    if (status?.elevated === false) setElevOpen(true)
    else toast('应用失败', 'error')
  }

  const onRestore = async (): Promise<void> => {
    setRestoreOpen(false)
    const ok = await restore()
    if (ok) toast('已恢复到上次应用前状态', 'success')
    else toast('恢复失败', 'error')
  }

  if (!status) return null

  return (
    <section className={styles.bar}>
      {!status.elevated && (
        <div className={styles.banner}>当前非管理员：hosts 写入需要管理员权限。</div>
      )}
      <div className={styles.status}>
        <span className={styles.item}>
          状态：{status.applied ? '已应用' : '未应用'}
        </span>
        <span className={styles.item}>
          规则 {status.ruleCount} 条 / 启用 {status.enabledCount} 条
        </span>
        {status.lastAppliedAt !== null && (
          <span className={styles.item}>
            上次应用 {new Date(status.lastAppliedAt).toLocaleString()}
          </span>
        )}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={applying} onClick={() => void onApply()}>
          {applying ? '应用中…' : '应用屏蔽'}
        </button>
        <button type="button" disabled={applying} onClick={() => setRestoreOpen(true)}>
          恢复
        </button>
        <button type="button" disabled={applying} onClick={() => setBackupOpen(true)}>
          备份记录
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}

      <ConfirmDialog
        open={restoreOpen}
        title="恢复 hosts"
        description="把 hosts 的托管段恢复到上次应用前的内容，hosts 其余部分不受影响。确定继续？"
        confirmText="恢复"
        danger
        onConfirm={() => void onRestore()}
        onCancel={() => setRestoreOpen(false)}
      />
      <ConfirmDialog
        open={elevOpen}
        title="需要管理员权限"
        description="写入 hosts 需要管理员权限。将以管理员身份重启应用，重启后请重新点击「应用屏蔽」。"
        confirmText="以管理员身份重启"
        onConfirm={() => {
          setElevOpen(false)
          window.api.adblock.relaunchElevated()
        }}
        onCancel={() => setElevOpen(false)}
      />
      <BackupList open={backupOpen} onClose={() => setBackupOpen(false)} />
    </section>
  )
}
