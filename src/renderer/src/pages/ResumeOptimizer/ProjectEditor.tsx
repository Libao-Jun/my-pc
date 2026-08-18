import { useState } from 'react'
import { useResumeStore } from '@renderer/stores/resumeStore'
import { OptimizeModal } from './OptimizeModal'
import styles from './ProjectEditor.module.css'

interface Target {
  item: number
  bullet: number
}

export function ProjectEditor(): JSX.Element {
  const projects = useResumeStore((s) => s.resume.projects)
  const addProject = useResumeStore((s) => s.addProject)
  const updateProject = useResumeStore((s) => s.updateProject)
  const removeProject = useResumeStore((s) => s.removeProject)
  const addBullet = useResumeStore((s) => s.addBullet)
  const updateBullet = useResumeStore((s) => s.updateBullet)
  const removeBullet = useResumeStore((s) => s.removeBullet)
  const addTag = useResumeStore((s) => s.addTag)
  const removeTag = useResumeStore((s) => s.removeTag)
  const [optimizing, setOptimizing] = useState<Target | null>(null)
  const [tagDraft, setTagDraft] = useState<{ item: number; value: string } | null>(null)

  return (
    <section className={styles.list}>
      {projects.map((proj, i) => (
        <div key={i} className={styles.item}>
          <div className={styles.row}>
            <input value={proj.name} onChange={(e) => updateProject(i, { name: e.target.value })} placeholder="项目名" />
            <input value={proj.role} onChange={(e) => updateProject(i, { role: e.target.value })} placeholder="角色" />
            <input value={proj.start} onChange={(e) => updateProject(i, { start: e.target.value })} placeholder="开始" />
            <input value={proj.end} onChange={(e) => updateProject(i, { end: e.target.value })} placeholder="结束" />
            <button type="button" onClick={() => removeProject(i)}>删除</button>
          </div>
          <textarea
            className={styles.description}
            value={proj.description}
            onChange={(e) => updateProject(i, { description: e.target.value })}
            rows={2}
            placeholder="一句话项目背景"
          />
          {proj.bullets.map((b, j) => (
            <div key={j} className={styles.bulletRow}>
              <input value={b} onChange={(e) => updateBullet('project', i, j, e.target.value)} placeholder="一句贡献 / 成果" />
              <button type="button" title="删除该条" onClick={() => removeBullet('project', i, j)}>×</button>
              <button type="button" onClick={() => setOptimizing({ item: i, bullet: j })}>优化</button>
            </div>
          ))}
          <button type="button" className={styles.addSmall} onClick={() => addBullet('project', i)}>+ 添加条目</button>
          <div className={styles.tags}>
            {proj.tags.map((t, j) => (
              <span key={j} className={styles.tag}>
                {t}
                <button type="button" title="移除标签" onClick={() => removeTag(i, j)}>×</button>
              </span>
            ))}
            <input
              className={styles.tagInput}
              value={tagDraft?.item === i ? tagDraft.value : ''}
              placeholder="+ 标签（回车添加）"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const v = tagDraft?.item === i ? tagDraft.value.trim() : ''
                if (v) addTag(i, v)
                setTagDraft({ item: i, value: '' })
              }}
              onChange={(e) => setTagDraft({ item: i, value: e.target.value })}
            />
          </div>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={addProject}>+ 添加项目经历</button>
      {optimizing && (
        <OptimizeModal
          section="project"
          initial={projects[optimizing.item]?.bullets[optimizing.bullet] ?? ''}
          onConfirm={(text) => {
            updateBullet('project', optimizing.item, optimizing.bullet, text)
            setOptimizing(null)
          }}
          onClose={() => setOptimizing(null)}
        />
      )}
    </section>
  )
}
