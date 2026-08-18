import { create } from 'zustand'
import type {
  ExperienceItem,
  IpcResult,
  OptimizeResult,
  ProjectItem,
  Resume,
  SkillItem
} from '@shared/types'

const EMPTY_RESUME: Resume = { basics: { name: '', title: '', summary: '' }, skills: [], experience: [], projects: [] }

type Section = 'experience' | 'project' | 'skill'
type BulletKind = 'experience' | 'project'

interface ResumeState {
  resume: Resume
  loaded: boolean // load 是否完成（首次渲染显示加载中）
  dirty: boolean // 是否有未保存修改
  loading: boolean
  saving: boolean
  error: string | null
  load: () => Promise<void>
  save: () => Promise<boolean>
  replaceAll: (resume: Resume) => void // 导入 JSON 后整体替换（置 dirty）
  updateBasics: (patch: Partial<Resume['basics']>) => void
  addSkill: () => void
  updateSkill: (index: number, patch: Partial<SkillItem>) => void
  removeSkill: (index: number) => void
  addExperience: () => void
  updateExperience: (index: number, patch: Partial<ExperienceItem>) => void
  removeExperience: (index: number) => void
  addProject: () => void
  updateProject: (index: number, patch: Partial<ProjectItem>) => void
  removeProject: (index: number) => void
  addBullet: (kind: BulletKind, index: number) => void
  updateBullet: (kind: BulletKind, index: number, bulletIndex: number, value: string) => void
  removeBullet: (kind: BulletKind, index: number, bulletIndex: number) => void
  addTag: (index: number, tag: string) => void
  removeTag: (index: number, tagIndex: number) => void
  optimize: (section: Section, input: string) => Promise<IpcResult<OptimizeResult>> // 直接透传 IPC
  clearError: () => void
}

export const useResumeStore = create<ResumeState>((set, get) => ({
  resume: EMPTY_RESUME,
  loaded: false,
  dirty: false,
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    const r = await window.api.resume.load()
    if (r.ok) set({ resume: r.data ?? EMPTY_RESUME, loaded: true, loading: false })
    else set({ error: r.error.message, loading: false })
  },

  save: async () => {
    set({ saving: true, error: null })
    const r = await window.api.resume.save(get().resume)
    set({ saving: false })
    if (r.ok) {
      set({ dirty: false })
      return true
    }
    set({ error: r.error.message })
    return false
  },

  replaceAll: (resume) => set({ resume, dirty: true }),
  updateBasics: (patch) =>
    set((s) => ({ resume: { ...s.resume, basics: { ...s.resume.basics, ...patch } }, dirty: true })),

  addSkill: () =>
    set((s) => ({ resume: { ...s.resume, skills: [...s.resume.skills, { name: '', level: '', years: '', note: '' }] }, dirty: true })),
  updateSkill: (index, patch) =>
    set((s) => ({ resume: { ...s.resume, skills: s.resume.skills.map((it, i) => (i === index ? { ...it, ...patch } : it)) }, dirty: true })),
  removeSkill: (index) =>
    set((s) => ({ resume: { ...s.resume, skills: s.resume.skills.filter((_, i) => i !== index) }, dirty: true })),

  addExperience: () =>
    set((s) => ({ resume: { ...s.resume, experience: [...s.resume.experience, { company: '', title: '', start: '', end: '', bullets: [''] }] }, dirty: true })),
  updateExperience: (index, patch) =>
    set((s) => ({ resume: { ...s.resume, experience: s.resume.experience.map((it, i) => (i === index ? { ...it, ...patch } : it)) }, dirty: true })),
  removeExperience: (index) =>
    set((s) => ({ resume: { ...s.resume, experience: s.resume.experience.filter((_, i) => i !== index) }, dirty: true })),

  addProject: () =>
    set((s) => ({ resume: { ...s.resume, projects: [...s.resume.projects, { name: '', role: '', start: '', end: '', description: '', bullets: [''], tags: [] }] }, dirty: true })),
  updateProject: (index, patch) =>
    set((s) => ({ resume: { ...s.resume, projects: s.resume.projects.map((it, i) => (i === index ? { ...it, ...patch } : it)) }, dirty: true })),
  removeProject: (index) =>
    set((s) => ({ resume: { ...s.resume, projects: s.resume.projects.filter((_, i) => i !== index) }, dirty: true })),

  addBullet: (kind, index) =>
    set((s) => {
      if (kind === 'experience') {
        const next = s.resume.experience.map((it, i) => (i === index ? { ...it, bullets: [...it.bullets, ''] } : it))
        return { resume: { ...s.resume, experience: next }, dirty: true }
      }
      const next = s.resume.projects.map((it, i) => (i === index ? { ...it, bullets: [...it.bullets, ''] } : it))
      return { resume: { ...s.resume, projects: next }, dirty: true }
    }),
  updateBullet: (kind, index, bulletIndex, value) =>
    set((s) => {
      if (kind === 'experience') {
        const next = s.resume.experience.map((it, i) =>
          i === index ? { ...it, bullets: it.bullets.map((b, j) => (j === bulletIndex ? value : b)) } : it
        )
        return { resume: { ...s.resume, experience: next }, dirty: true }
      }
      const next = s.resume.projects.map((it, i) =>
        i === index ? { ...it, bullets: it.bullets.map((b, j) => (j === bulletIndex ? value : b)) } : it
      )
      return { resume: { ...s.resume, projects: next }, dirty: true }
    }),
  removeBullet: (kind, index, bulletIndex) =>
    set((s) => {
      if (kind === 'experience') {
        const next = s.resume.experience.map((it, i) =>
          i === index ? { ...it, bullets: it.bullets.filter((_, j) => j !== bulletIndex) } : it
        )
        return { resume: { ...s.resume, experience: next }, dirty: true }
      }
      const next = s.resume.projects.map((it, i) =>
        i === index ? { ...it, bullets: it.bullets.filter((_, j) => j !== bulletIndex) } : it
      )
      return { resume: { ...s.resume, projects: next }, dirty: true }
    }),

  addTag: (index, tag) =>
    set((s) => ({ resume: { ...s.resume, projects: s.resume.projects.map((it, i) => (i === index ? { ...it, tags: [...it.tags, tag] } : it)) }, dirty: true })),
  removeTag: (index, tagIndex) =>
    set((s) => ({ resume: { ...s.resume, projects: s.resume.projects.map((it, i) => (i === index ? { ...it, tags: it.tags.filter((_, j) => j !== tagIndex) } : it)) }, dirty: true })),

  optimize: async (section, input) => window.api.resume.optimize({ section, input }),
  clearError: () => set({ error: null })
}))
