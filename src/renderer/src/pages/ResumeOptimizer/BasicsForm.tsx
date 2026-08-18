import { useResumeStore } from '@renderer/stores/resumeStore'
import styles from './BasicsForm.module.css'

export function BasicsForm(): JSX.Element {
  const basics = useResumeStore((s) => s.resume.basics)
  const updateBasics = useResumeStore((s) => s.updateBasics)
  return (
    <section className={styles.form}>
      <label className={styles.field}>
        姓名
        <input value={basics.name} onChange={(e) => updateBasics({ name: e.target.value })} placeholder="张三" />
      </label>
      <label className={styles.field}>
        职位
        <input value={basics.title} onChange={(e) => updateBasics({ title: e.target.value })} placeholder="前端工程师" />
      </label>
      <label className={styles.field}>
        一句话概述
        <textarea
          value={basics.summary}
          onChange={(e) => updateBasics({ summary: e.target.value })}
          rows={2}
          placeholder="3 年前端经验，专注可视化与性能优化"
        />
      </label>
    </section>
  )
}
