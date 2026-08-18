import { useMemo, useState } from 'react'
import type { AdblockRule } from '@shared/types'
import { ConfirmDialog } from '@renderer/components/ConfirmDialog'
import { Switch } from '@renderer/components/Switch'
import { useAdblockStore } from '@renderer/stores/adblockStore'
import { RuleEditor } from './RuleEditor'
import styles from './RuleGroupList.module.css'

const CATEGORY_LABELS: Record<string, string> = {
  ad: '广告',
  recommend: '个性化推荐'
}

export function RuleGroupList(): JSX.Element {
  const rules = useAdblockStore((s) => s.rules)
  const updateRule = useAdblockStore((s) => s.updateRule)
  const removeRule = useAdblockStore((s) => s.removeRule)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdblockRule | null>(null)
  const [deleting, setDeleting] = useState<AdblockRule | null>(null)

  const groups = useMemo(() => {
    const map = new Map<string, AdblockRule[]>()
    for (const r of rules) {
      const arr = map.get(r.software) ?? []
      arr.push(r)
      map.set(r.software, arr)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [rules])

  const toggleGroup = (software: string, enable: boolean): void => {
    for (const r of rules.filter((x) => x.software === software)) {
      if (r.enabled !== enable) void updateRule(r.id, { enabled: enable })
    }
  }

  return (
    <section className={styles.list}>
      <div className={styles.toolbar}>
        <span className={styles.hint}>按软件分组：组级开关批量启停，组内每条规则可单独开关。</span>
        <button
          type="button"
          className={styles.add}
          onClick={() => {
            setEditing(null)
            setEditorOpen(true)
          }}
        >
          + 新增规则
        </button>
      </div>
      {groups.length === 0 && <div className={styles.empty}>暂无规则，点右上角「新增规则」添加。</div>}
      {groups.map(([software, groupRules]) => {
        const allOn = groupRules.length > 0 && groupRules.every((r) => r.enabled)
        return (
          <div key={software} className={styles.group}>
            <div className={styles.groupHead}>
              <Switch checked={allOn} onChange={(v) => toggleGroup(software, v)} />
              <span className={styles.software}>{software}</span>
              <span className={styles.count}>{groupRules.length} 条</span>
              <button
                type="button"
                className={styles.addInGroup}
                onClick={() => {
                  setEditing({ id: '', software, domain: '', category: 'ad', enabled: true })
                  setEditorOpen(true)
                }}
              >
                + 规则
              </button>
            </div>
            <ul className={styles.rules}>
              {groupRules.map((r) => (
                <li key={r.id} className={styles.rule}>
                  <Switch checked={r.enabled} onChange={(v) => void updateRule(r.id, { enabled: v })} />
                  <code className={styles.domain}>{r.domain}</code>
                  <span className={styles.category}>{CATEGORY_LABELS[r.category]}</span>
                  <div className={styles.ops}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(r)
                        setEditorOpen(true)
                      }}
                    >
                      编辑
                    </button>
                    <button type="button" onClick={() => setDeleting(r)}>
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}

      <ConfirmDialog
        open={deleting !== null}
        title="删除规则"
        description={deleting ? `确定删除 ${deleting.domain}？` : ''}
        confirmText="删除"
        danger
        onConfirm={() => {
          if (deleting) void removeRule(deleting.id)
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />

      <RuleEditor
        open={editorOpen}
        initial={editing}
        onClose={() => {
          setEditorOpen(false)
          setEditing(null)
        }}
      />
    </section>
  )
}
