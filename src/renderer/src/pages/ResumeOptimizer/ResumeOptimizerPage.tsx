import { useEffect, useState } from 'react'
import { useToast } from '@renderer/components/Toast'
import { useResumeStore } from '@renderer/stores/resumeStore'
import { BasicsForm } from './BasicsForm'
import { SkillsEditor } from './SkillsEditor'
import { ExperienceEditor } from './ExperienceEditor'
import { ProjectEditor } from './ProjectEditor'
import styles from './ResumeOptimizerPage.module.css'

type Tab = 'basics' | 'skills' | 'experience' | 'projects'

const TAB_LABELS: Record<Tab, string> = {
  basics: '基本信息',
  skills: '技能',
  experience: '工作经历',
  projects: '项目经历'
}

export function ResumeOptimizerPage(): JSX.Element {
  const toast = useToast()
  const loaded = useResumeStore((s) => s.loaded)
  const dirty = useResumeStore((s) => s.dirty)
  const saving = useResumeStore((s) => s.saving)
  const error = useResumeStore((s) => s.error)
  const load = useResumeStore((s) => s.load)
  const save = useResumeStore((s) => s.save)
  const replaceAll = useResumeStore((s) => s.replaceAll)
  const [tab, setTab] = useState<Tab>('basics')

  useEffect(() => {
    void load()
  }, [load])

  const onExport = async (type: 'markdown' | 'json'): Promise<void> => {
    // 导出所见即所得：传当前内存态 resume（未保存的编辑也导出）
    const resume = useResumeStore.getState().resume
    const r = await window.api.resume.export({ type, resume })
    if (r.ok) {
      if (r.data) toast(`已导出：${r.data.path}`, 'success')
      else toast('已取消导出', 'info')
    } else {
      toast(r.error.message, 'error')
    }
  }

  const onImport = async (): Promise<void> => {
    const r = await window.api.resume.import()
    if (!r.ok) {
      toast(r.error.message, 'error')
      return
    }
    if (!r.data) return // 用户取消
    if (!window.confirm('导入将覆盖当前简历（未保存修改也会被替换），确定？')) return
    replaceAll(r.data)
    toast('已导入，点击「保存」生效', 'success')
  }

  const onSave = async (): Promise<void> => {
    const ok = await save()
    toast(ok ? '已保存' : (useResumeStore.getState().error ?? '保存失败'), ok ? 'success' : 'error')
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>简历优化</h1>
        <div className={styles.toolbar}>
          <button type="button" onClick={() => void onExport('markdown')}>导出 Markdown</button>
          <button type="button" onClick={() => void onExport('json')}>导出 JSON</button>
          <button type="button" onClick={() => void onImport()}>导入 JSON</button>
          <button
            type="button"
            className={dirty ? styles.primary : undefined}
            onClick={() => void onSave()}
            disabled={saving}
          >
            {saving ? '保存中…' : dirty ? '保存（有未保存修改）' : '保存'}
          </button>
        </div>
      </header>
      <nav className={styles.tabs}>
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? styles.active : undefined}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>
      {error && <div className={styles.error}>{error}</div>}
      {!loaded && !error ? (
        <p className={styles.hint}>加载中…</p>
      ) : (
        <>
          {tab === 'basics' && <BasicsForm />}
          {tab === 'skills' && <SkillsEditor />}
          {tab === 'experience' && <ExperienceEditor />}
          {tab === 'projects' && <ProjectEditor />}
        </>
      )}
    </div>
  )
}
