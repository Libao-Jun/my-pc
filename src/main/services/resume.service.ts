import { AppError } from '@shared/errors'
import type { JsonSchema, OptimizeRequest, OptimizeResult, Resume, Star } from '@shared/types'
import { complete } from '../ai/adapter'

// 本地兜底：规则按信号词把输入切成 STAR 四段；缺段 / 缺量化产出占位提示，不编造数字
const SENTENCE_SPLIT = /[。；;\n，]+/
const SITUATION_RE = /背景|当时|现状|由于|因为|起初|此前|原先/
const TASK_RE = /需要|目标|要求|职责|要完成|承担|负责/
const ACTION_RE = /完成|实现|主导|重构|搭建|开发|设计|引入|推动|组织|落地|上线|统一|编写|对接|优化|梳理|沉淀/
const RESULT_RE = /带来|使得|提升|降低|缩短|减少|增加|达到|覆盖|支撑|节省|交付|服务了/
const QUANT_RE = /[0-9％%]|提升|降低|缩短|减少|增加|节省|覆盖|万|亿|倍|人|天|个月|年|个|页|接口|用户|规模|周期|响应|交付/

const STAR_SCHEMA: JsonSchema = {
  name: 'starRewrite',
  description: '把平淡的经历描述改写为 STAR 四段结构',
  properties: {
    situation: { type: 'string', description: '情境：当时的背景与问题' },
    task: { type: 'string', description: '任务：需要达成的目标或职责' },
    action: { type: 'string', description: '行动：本人具体做了什么，主动语态' },
    result: { type: 'string', description: '结果：量化成果（数字 / 百分比 / 时间 / 规模）；输入未提供则如实说明缺失，不编造' }
  }
}

function buildPrompt(section: OptimizeRequest['section'], input: string): string {
  if (section === 'skill') {
    return `把这条技能说明改写成可验证的 STAR 描述（使用场景 → 承担事项 → 具体做法 → 可验证效果）。效果缺失则如实标注，不要编造。\n原文：${input}`
  }
  return `把这条平淡的经历描述改写成 STAR 四段：情境（当时的背景与问题）、任务（目标或职责）、行动（用「我」开头的主动语态）、结果（尽量量化；输入没有量化数据就不要编造）。\n原文：${input}`
}

function parseStar(raw: string): Star {
  const data = JSON.parse(raw) as Record<string, unknown>
  const star: Star = { situation: '', task: '', action: '', result: '' }
  for (const key of Object.keys(star) as Array<keyof Star>) {
    const v = data[key]
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`STAR 字段缺失：${key}`)
    star[key] = v.trim()
  }
  return star
}

function classifySentence(sentence: string): keyof Star | null {
  if (SITUATION_RE.test(sentence)) return 'situation'
  if (RESULT_RE.test(sentence)) return 'result'
  if (TASK_RE.test(sentence)) return 'task'
  if (ACTION_RE.test(sentence)) return 'action'
  return null
}

// 方案 A：规则切分 + 待补充标注（section 仅影响结果段占位文案）
function localOptimize(section: OptimizeRequest['section'], input: string): Star {
  const resultHint = section === 'skill' ? '可验证效果（数字 / 百分比 / 时间 / 规模）' : '量化数据（数字 / 百分比 / 时间 / 规模）'
  const star: Star = { situation: '', task: '', action: '', result: '' }
  const rest: string[] = []
  for (const sentence of input.split(SENTENCE_SPLIT)) {
    const s = sentence.trim()
    if (!s) continue
    const kind = classifySentence(s)
    if (kind) star[kind] = star[kind] ? `${star[kind]}；${s}` : s
    else rest.push(s)
  }
  if (rest.length) star.action = star.action ? `${star.action}；${rest.join('；')}` : rest.join('；')
  if (!star.situation) star.situation = '[待补充：当时的背景或问题情境]'
  if (!star.task) star.task = '[待补充：需要达成的目标或职责]'
  if (!star.action) star.action = '[待补充：本人具体做了什么]'
  if (!star.result) star.result = `[待补充${resultHint}]`
  else if (!QUANT_RE.test(star.result)) star.result = `${star.result}\n[待补充${resultHint}]`
  return star
}

// 主进程内部接口：AI 优先，任何失败（含 JSON 解析失败）→ 本地兜底，永不 reject
export async function optimize(
  section: OptimizeRequest['section'],
  input: string
): Promise<OptimizeResult> {
  try {
    const raw = await complete(buildPrompt(section, input), STAR_SCHEMA)
    return { star: parseStar(raw), source: 'ai' }
  } catch {
    return { star: localOptimize(section, input), source: 'local' }
  }
}

// 导出 Markdown：整份简历 → .md 文本
export function buildMarkdown(resume: Resume): string {
  const lines: string[] = []
  const { name, title, summary } = resume.basics
  if (name || title) lines.push(`# ${name}${title ? ` · ${title}` : ''}`)
  if (summary) lines.push(summary)
  lines.push('')

  if (resume.skills.length) {
    lines.push('## 技能', '')
    for (const s of resume.skills) {
      const meta = [s.name, s.level, s.years].filter(Boolean).join(' · ')
      lines.push(`- ${meta ? `**${meta}**` : '（未命名技能）'}${s.note ? `：${s.note}` : ''}`)
    }
    lines.push('')
  }

  if (resume.experience.length) {
    lines.push('## 工作经历', '')
    for (const e of resume.experience) {
      const range = [e.start, e.end].filter(Boolean).join(' - ')
      lines.push(`### ${e.company || '（公司）'}${e.title ? ` · ${e.title}` : ''}${range ? `（${range}）` : ''}`, '')
      for (const b of e.bullets) lines.push(`- ${b}`)
      lines.push('')
    }
  }

  if (resume.projects.length) {
    lines.push('## 项目经历', '')
    for (const p of resume.projects) {
      const range = [p.start, p.end].filter(Boolean).join(' - ')
      lines.push(`### ${p.name || '（项目）'}${p.role ? ` · ${p.role}` : ''}${range ? `（${range}）` : ''}`, '')
      if (p.description) lines.push(p.description, '')
      for (const b of p.bullets) lines.push(`- ${b}`)
      if (p.tags.length) lines.push('', `标签：${p.tags.join('、')}`)
      lines.push('')
    }
  }

  return lines.join('\n').trimEnd() + '\n'
}

// 导入 / 保存校验：顶层 section 存在但类型错 → 抛 VALIDATION_ERROR；条目内字段宽松归一
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function validateResume(value: unknown): Resume {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('VALIDATION_ERROR', '简历数据不是合法的 JSON 对象')
  }
  const raw = value as Record<string, unknown>
  if (raw.skills !== undefined && !Array.isArray(raw.skills)) throw new AppError('VALIDATION_ERROR', 'skills 需为数组')
  if (raw.experience !== undefined && !Array.isArray(raw.experience)) throw new AppError('VALIDATION_ERROR', 'experience 需为数组')
  if (raw.projects !== undefined && !Array.isArray(raw.projects)) throw new AppError('VALIDATION_ERROR', 'projects 需为数组')

  const basicsRaw = (raw.basics ?? {}) as Record<string, unknown>
  const skills: Resume['skills'] = (raw.skills as unknown[] ?? []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { name: asString(o.name), level: asString(o.level), years: asString(o.years), note: asString(o.note) }
  })
  const experience: Resume['experience'] = (raw.experience as unknown[] ?? []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { company: asString(o.company), title: asString(o.title), start: asString(o.start), end: asString(o.end), bullets: asStringList(o.bullets) }
  })
  const projects: Resume['projects'] = (raw.projects as unknown[] ?? []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { name: asString(o.name), role: asString(o.role), start: asString(o.start), end: asString(o.end), description: asString(o.description), bullets: asStringList(o.bullets), tags: asStringList(o.tags) }
  })
  return {
    basics: { name: asString(basicsRaw.name), title: asString(basicsRaw.title), summary: asString(basicsRaw.summary) },
    skills,
    experience,
    projects
  }
}
