import type { DiagramRequest, DiagramResult } from '@shared/types'
import type { DiagramType } from '@shared/types'
import { parseMermaid } from '@shared/mermaid'
import { complete } from '../ai/adapter'

const TYPE_LABELS: Record<DiagramType, string> = {
  mindmap: '思维导图',
  flowchart: '流程图',
  approval: '审批流程图'
}

// 受限语法示例，拼进 AI prompt 约束输出
const GRAMMAR_EXAMPLE = `mindmap:
  mindmap
    root((主题))
      分支A
        子A1

flowchart:
  flowchart TD
    A[开始] --> B{是否通过?}
    B -- 是 --> C[通过处理]
    B -- 否 --> D[驳回处理]`

// 资料 → 类型判定：层级/分类 → mindmap；顺序+判断 → flowchart；多角色签核流转 → approval
export function classifyType(source: string): DiagramType {
  const lower = source.toLowerCase()
  if (/提交.*审批|审批.*提交|会签|或签|驳回|复核|经理.*审批|hr/.test(lower)) return 'approval'
  if (/步骤|流程|如果|是否|判断|通过|失败|然后|先.*再|分支|条件/.test(lower)) return 'flowchart'
  return 'mindmap'
}

// 判定解析后的 Mermaid 是否与请求类型一致（approval 渲染为 flowchart，故接受 flowchart）
export function validateMermaid(type: DiagramType, mermaid: string): boolean {
  const parsed = parseMermaid(mermaid)
  if (!parsed.ok) return false
  return type === 'approval' ? parsed.kind === 'flowchart' : parsed.kind === type
}

// Mermaid 节点文本清洗：剥离会破坏受限语法的符号
function sanitize(text: string): string {
  return text.replace(/[[\]{}()<>]/g, ' ')
}

function buildPrompt(type: DiagramType, source: string): string {
  return (
    `把下面的资料整理成${TYPE_LABELS[type]}，只输出合法的 Mermaid 源码，不要任何额外文字或代码块标记。\n` +
    `只允许使用以下受限语法：\n${GRAMMAR_EXAMPLE}\n` +
    `规则：节点必须先声明（A[文本] / A{文本} / A((文本))），边用 A --> B 或 A -- 标签 --> B，每条边引用的节点都必须已声明；不要使用其他 Mermaid 特性。\n` +
    `资料：\n${source}`
  )
}

// 本地兜底：确定性规则抽结构 + 模板拼 Mermaid，不编造
export function localGenerate(type: DiagramType, source: string): string {
  if (type === 'mindmap') {
    const lines = source.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim())
    if (!lines.length) return 'mindmap\n  root((内容))'
    const rootText = lines[0].replace(/^[\d.、\-*>\s]+/, '').trim()
    const out: string[] = ['mindmap', `  root((${sanitize(rootText)}))`]
    for (const line of lines.slice(1)) out.push(`    ${sanitize(line.replace(/^[\d.、\-*>\s]+/, '').trim())}`)
    return out.join('\n')
  }
  const sep = type === 'approval' ? /[\n；;。]+/ : /[\n；;]+/
  const steps = source.split(sep).map((s) => s.trim()).filter(Boolean)
  if (!steps.length) return type === 'approval' ? 'flowchart LR\n  S[提交]' : 'flowchart TD\n  A[内容]'
  const head = type === 'approval' ? 'flowchart LR' : 'flowchart TD'
  const out: string[] = [head]
  for (let i = 0; i < steps.length; i++) {
    const text = sanitize(steps[i])
    if (type === 'flowchart' && /如果|是否|判断|通过|失败|条件|分支/.test(steps[i])) {
      out.push(`  N${i}{${text}}`)
    } else {
      out.push(`  N${i}[${text}]`)
    }
  }
  for (let i = 0; i < steps.length - 1; i++) out.push(`  N${i} --> N${i + 1}`)
  return out.join('\n')
}

// 主进程内部接口：AI 优先，任何失败（含语法校验失败）→ 本地兜底，永不 reject
export async function generate(source: string, type?: DiagramType): Promise<DiagramResult> {
  const t: DiagramType = type ?? classifyType(source)
  try {
    const raw = await complete(buildPrompt(t, source))
    const mermaid = raw.trim()
    if (validateMermaid(t, mermaid)) return { type: t, mermaid, source: 'ai' }
    return { type: t, mermaid: localGenerate(t, source), source: 'local' }
  } catch {
    return { type: t, mermaid: localGenerate(t, source), source: 'local' }
  }
}
