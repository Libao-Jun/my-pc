import { useState } from 'react'
import { useResumeStore } from '@renderer/stores/resumeStore'
import { OptimizeModal } from './OptimizeModal'
import styles from './SkillsEditor.module.css'

const LEVELS = ['了解', '掌握', '熟练', '精通']

export function SkillsEditor(): JSX.Element {
  const skills = useResumeStore((s) => s.resume.skills)
  const addSkill = useResumeStore((s) => s.addSkill)
  const updateSkill = useResumeStore((s) => s.updateSkill)
  const removeSkill = useResumeStore((s) => s.removeSkill)
  const [optimizing, setOptimizing] = useState<number | null>(null)

  return (
    <section className={styles.list}>
      {skills.map((skill, i) => (
        <div key={i} className={styles.item}>
          <div className={styles.row}>
            <input value={skill.name} onChange={(e) => updateSkill(i, { name: e.target.value })} placeholder="技能名（如 React）" />
            <select value={skill.level} onChange={(e) => updateSkill(i, { level: e.target.value })}>
              <option value="">熟练度</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            <input value={skill.years} onChange={(e) => updateSkill(i, { years: e.target.value })} placeholder="年限（如 3 年）" />
            <button type="button" onClick={() => removeSkill(i)}>删除</button>
          </div>
          <div className={styles.row}>
            <input value={skill.note} onChange={(e) => updateSkill(i, { note: e.target.value })} placeholder="一句可验证说明" />
            <button type="button" onClick={() => setOptimizing(i)}>优化</button>
          </div>
        </div>
      ))}
      <button type="button" className={styles.add} onClick={addSkill}>+ 添加技能</button>
      {optimizing !== null && (
        <OptimizeModal
          section="skill"
          initial={skills[optimizing]?.note ?? ''}
          onConfirm={(text) => {
            updateSkill(optimizing, { note: text })
            setOptimizing(null)
          }}
          onClose={() => setOptimizing(null)}
        />
      )}
    </section>
  )
}
