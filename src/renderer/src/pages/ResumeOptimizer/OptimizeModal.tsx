import { useState } from 'react'
import type { Star } from '@shared/types'
import { useToast } from '@renderer/components/Toast'
import { useResumeStore } from '@renderer/stores/resumeStore'
import styles from './OptimizeModal.module.css'

type Section = 'experience' | 'project' | 'skill'

const FIELD_LABELS: Record<keyof Star, string> = {
  situation: '情境',
  task: '任务',
  action: '行动',
  result: '结果'
}

interface OptimizeModalProps {
  section: Section
  initial: string // 预填当前条文字
  onConfirm: (text: string) => void // 确认回填：替换原条
  onClose: () => void
}

export function OptimizeModal({ section, initial, onConfirm, onClose }: OptimizeModalProps): JSX.Element {
  const toast = useToast()
  const optimize = useResumeStore((s) => s.optimize)
  const [input, setInput] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<Star | null>(null)
  const [source, setSource] = useState<'ai' | 'local' | null>(null)

  const run = async (): Promise<void> => {
    if (!input.trim()) {
      toast('请先输入要优化的描述', 'error')
      return
    }
    setLoading(true)
    const r = await optimize(section, input.trim())
    setLoading(false)
    if (r.ok) {
      setDraft(r.data.star)
      setSource(r.data.source)
    } else {
      toast(r.error.message, 'error')
    }
  }

  const confirm = (): void => {
    if (!draft) return
    // 拼接非占位段（跳过 [待补充…]），段间以「。」连接
    const text = [draft.situation, draft.task, draft.action, draft.result]
      .filter((s) => s && !s.startsWith('[待补充'))
      .join('。')
    onConfirm(text)
    onClose()
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.heading}>STAR 优化</h3>
        <textarea
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          placeholder="粘贴要优化的平淡描述"
        />
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => void run()} disabled={loading}>
            {loading ? '优化中…' : '优化'}
          </button>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        {draft && source && (
          <>
            <span className={`${styles.badge} ${source === 'ai' ? styles.ai : styles.local}`}>
              {source === 'ai' ? 'AI 优化' : '本地模板'}
            </span>
            {(Object.keys(FIELD_LABELS) as Array<keyof Star>).map((key) => (
              <label key={key} className={styles.field}>
                {FIELD_LABELS[key]}
                <textarea
                  className={styles.segment}
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                  rows={2}
                />
              </label>
            ))}
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={confirm}>确认回填</button>
              <button type="button" onClick={() => void run()}>重新优化</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
