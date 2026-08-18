import { useState } from 'react'
import { useResumeStore } from '@renderer/stores/resumeStore'
import { OptimizeModal } from './OptimizeModal'
import styles from './ExperienceEditor.module.css'

interface Target {
  item: number
  bullet: number
}

export function ExperienceEditor(): JSX.Element {
  const experience = useResumeStore((s) => s.resume.experience)
  const addExperience = useResumeStore((s) => s.addExperience)
  const updateExperience = useResumeStore((s) => s.updateExperience)
  const removeExperience = useResumeStore((s) => s.removeExperience)
  const addBullet = useResumeStore((s) => s.addBullet)
  const updateBullet = useResumeStore((s) => s.updateBullet)
  const removeBullet = useResumeStore((s) => s.removeBullet)
  const [optimizing, setOptimizing] = useState<Target | null>(null)

  return (
    <section className={styles.list}>
      {experience.map((exp, i) => (
        <div key={i} className={styles.item}>
          <div className={styles.row}>
            <input value={exp.company} onChange={(e) => updateExperience(i, { company: e.target.value })} placeholder="公司" />
            <input value={exp.title} onChange={(e) => updateExperience(i, { title: e.target.value })} placeholder="职位" />
            <input value={exp.start} onChange={(e) => updateExperience(i, { start: e.target.value })} placeholder="开始（如 2020-07）" />
            <input value={exp.end} onChange={(e) => updateExperience(i, { end: e.target.value })} placeholder="结束（如 2024-06）" />
            <button type="button" onClick={() => removeExperience(i)}>删除</button>
          </div>
          {exp.bullets.map((b, j) => (
            <div key={j} className={styles.bulletRow}>
              <input value={b} onChange={(e) => updateBullet('experience', i, j, e.target.value)} placeholder="一句职责 / 成果" />
              <button type="button" title="删除该条" onClick={() => removeBullet('experience', i, j)}>×</button>
              <button type="button" onClick={() => setOptimizing({ item: i, bullet: j })}>优化</button>
            </div>
          ))}
          <button type="button" className={styles.addSmall} onClick={() => addBullet('experience', i)}>+ 添加条目</button>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={addExperience}>+ 添加工作经历</button>
      {optimizing && (
        <OptimizeModal
          section="experience"
          initial={experience[optimizing.item]?.bullets[optimizing.bullet] ?? ''}
          onConfirm={(text) => {
            updateBullet('experience', optimizing.item, optimizing.bullet, text)
            setOptimizing(null)
          }}
          onClose={() => setOptimizing(null)}
        />
      )}
    </section>
  )
}
