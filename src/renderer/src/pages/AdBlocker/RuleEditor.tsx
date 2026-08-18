import { useEffect, useState } from 'react'
import type { AdblockRule } from '@shared/types'
import { Modal } from '@renderer/components/Modal'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import styles from './RuleEditor.module.css'

const SOFTWARE_SUGGESTIONS = ['搜狗输入法', '百度输入法', '浏览器', '视频播放器', '通用广告网络']

interface RuleEditorProps {
  open: boolean
  initial: AdblockRule | null // null = 新增
  onClose: () => void
}

export function RuleEditor({ open, initial, onClose }: RuleEditorProps): JSX.Element {
  const addRule = useAdblockStore((s) => s.addRule)
  const updateRule = useAdblockStore((s) => s.updateRule)
  const [software, setSoftware] = useState('')
  const [domain, setDomain] = useState('')
  const [category, setCategory] = useState<'ad' | 'recommend'>('ad')

  useEffect(() => {
    if (open) {
      setSoftware(initial?.software ?? '')
      setDomain(initial?.domain ?? '')
      setCategory(initial?.category ?? 'ad')
    }
  }, [open, initial])

  const save = async (): Promise<void> => {
    const name = software.trim()
    const d = domain.trim().toLowerCase()
    if (!name || !d) return // 服务端会二次校验并回显错误
    const input = { software: name, domain: d, category, enabled: true }
    // 组内「+ 规则」传入 { id: '', software, ... } 表示新增，仅真 id 走 updateRule
    const ok = initial?.id ? await updateRule(initial.id, input) : await addRule(input)
    if (ok) onClose()
  }

  return (
    <Modal open={open} title={initial ? '编辑规则' : '新增规则'} onClose={onClose}>
      <div className={styles.form}>
        <label className={styles.field}>
          软件分组
          <input
            list="adblock-software"
            value={software}
            onChange={(e) => setSoftware(e.target.value)}
            placeholder="如 搜狗输入法"
          />
          <datalist id="adblock-software">
            {SOFTWARE_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className={styles.field}>
          域名（字面域名，不支持通配符）
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="ad.example.com"
            spellCheck={false}
          />
        </label>
        <label className={styles.field}>
          类别
          <select value={category} onChange={(e) => setCategory(e.target.value as 'ad' | 'recommend')}>
            <option value="ad">广告</option>
            <option value="recommend">个性化推荐</option>
          </select>
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            取消
          </button>
          <button type="button" className={styles.save} onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </Modal>
  )
}
