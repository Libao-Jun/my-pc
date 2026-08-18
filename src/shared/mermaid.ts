// 受限 Mermaid 语法解析器 —— 唯一真相源（主进程校验 + 渲染层布局共用）
// 支持：
//   mindmap：缩进树，根 root((主题))，子节点缩进更深
//   flowchart TD|LR：节点声明 A[文本] / A{文本} / A((文本)) + 边 A-->B / A--标签-->B
export type DiagramNodeKind = 'rect' | 'diamond' | 'circle'

export interface DiagramNode {
  id: string
  text: string
  kind: DiagramNodeKind
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
}

export interface MindmapTree {
  id: string
  text: string
  circle: boolean
  children: MindmapTree[]
}

export type ParsedMermaid =
  | { ok: true; kind: 'mindmap'; root: MindmapTree }
  | { ok: true; kind: 'flowchart'; dir: 'TD' | 'LR'; nodes: DiagramNode[]; edges: DiagramEdge[] }
  | { ok: false; reason: string }

const NODE_RECT_RE = /^([A-Za-z0-9_]+)\s*\[([^\]]*)\]\s*$/
const NODE_DIAMOND_RE = /^([A-Za-z0-9_]+)\s*\{([^}]*)\}\s*$/
const NODE_CIRCLE_RE = /^([A-Za-z0-9_]+)\s*\(\(([^)]*)\)\)\s*$/
const EDGE_LABEL_RE = /^([A-Za-z0-9_]+)\s*--\s*(.+?)\s*-->\s*([A-Za-z0-9_]+)\s*$/
const EDGE_PLAIN_RE = /^([A-Za-z0-9_]+)\s*-->\s*([A-Za-z0-9_]+)\s*$/
const FLOWCHART_HEAD_RE = /^flowchart\s+(TD|LR)$/i

function firstNonEmpty(lines: string[]): number {
  return lines.findIndex((l) => l.trim() !== '')
}

function parseMindmap(lines: string[]): ParsedMermaid {
  let idc = 0
  let root: MindmapTree | null = null
  const stack: Array<{ indent: number; node: MindmapTree }> = []
  for (const raw of lines) {
    if (raw.trim() === '') continue
    const indent = raw.match(/^ */)?.[0].length ?? 0
    const trimmed = raw.trim()
    let text = trimmed
    let circle = false
    if (root === null) {
      const m = trimmed.match(/^(?:[A-Za-z0-9_]+)?\s*\(\(([^()]*)\)\)$/)
      if (m) {
        text = m[1]
        circle = true
      }
    }
    const node: MindmapTree = { id: `n${idc++}`, text, circle, children: [] }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (stack.length) {
      stack[stack.length - 1].node.children.push(node)
    } else if (root === null) {
      root = node
    } else {
      return { ok: false, reason: '存在多个同级根节点' }
    }
    stack.push({ indent, node })
  }
  if (!root) return { ok: false, reason: 'mindmap 缺少根节点' }
  return { ok: true, kind: 'mindmap', root }
}

function parseFlowchart(lines: string[], dir: 'TD' | 'LR'): ParsedMermaid {
  const nodes = new Map<string, DiagramNode>()
  const edges: DiagramEdge[] = []
  for (const raw of lines) {
    if (raw.trim() === '') continue
    const line = raw.trim()
    let m: RegExpMatchArray | null
    if ((m = line.match(NODE_RECT_RE))) {
      nodes.set(m[1], { id: m[1], text: m[2] || m[1], kind: 'rect' })
    } else if ((m = line.match(NODE_DIAMOND_RE))) {
      nodes.set(m[1], { id: m[1], text: m[2] || m[1], kind: 'diamond' })
    } else if ((m = line.match(NODE_CIRCLE_RE))) {
      nodes.set(m[1], { id: m[1], text: m[2] || m[1], kind: 'circle' })
    } else if ((m = line.match(EDGE_LABEL_RE))) {
      edges.push({ from: m[1], to: m[3], label: m[2].trim() })
    } else if ((m = line.match(EDGE_PLAIN_RE))) {
      edges.push({ from: m[1], to: m[2] })
    } else {
      return { ok: false, reason: `无法识别的行：${line}` }
    }
  }
  if (nodes.size === 0 && edges.length === 0) return { ok: false, reason: '没有节点或边' }
  for (const e of edges) {
    if (!nodes.has(e.from)) return { ok: false, reason: `边引用了未声明的节点 ${e.from}` }
    if (!nodes.has(e.to)) return { ok: false, reason: `边引用了未声明的节点 ${e.to}` }
  }
  return { ok: true, kind: 'flowchart', dir, nodes: [...nodes.values()], edges }
}

export function parseMermaid(code: string): ParsedMermaid {
  const lines = code.split(/\r?\n/)
  const idx = firstNonEmpty(lines)
  if (idx < 0) return { ok: false, reason: '空内容' }
  const header = lines[idx].trim()
  if (header === 'mindmap') return parseMindmap(lines.slice(idx + 1))
  const flow = header.match(FLOWCHART_HEAD_RE)
  if (flow) return parseFlowchart(lines.slice(idx + 1), flow[1].toUpperCase() as 'TD' | 'LR')
  return { ok: false, reason: '不支持的图表类型头' }
}
