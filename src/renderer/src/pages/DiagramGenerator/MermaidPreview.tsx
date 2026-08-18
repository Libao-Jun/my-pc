import type { DiagramEdge, DiagramNode, MindmapTree } from '@shared/mermaid'
import { parseMermaid } from '@shared/mermaid'
import styles from './MermaidPreview.module.css'

const COLUMN_W = 240 // 层 / 深度间距
const ROW_H = 52 // 行间距
const FONT = 13

const ARROW =
  '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
  '<path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/></marker></defs>'

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function measure(text: string): { w: number; h: number } {
  const lines = text.split('\n')
  const w = Math.max(80, Math.max(...lines.map((l) => l.length * (FONT * 0.62))) + 24)
  const h = Math.max(40, lines.length * 18 + 12)
  return { w, h }
}

function nodeText(text: string, cx: number, cy: number): string {
  const lines = text.split('\n')
  const firstY = cy - ((lines.length - 1) * 14) / 2
  return lines
    .map((line, i) => `<tspan x="${cx}" y="${firstY + i * 14}">${escapeXml(line)}</tspan>`)
    .join('')
}

type Pos = { x: number; y: number; w: number; h: number }

function renderNode(node: DiagramNode, p: Pos): string {
  const cx = p.x + p.w / 2
  const cy = p.y + p.h / 2
  let shape: string
  if (node.kind === 'diamond') {
    const pts = `${cx},${p.y} ${p.x + p.w},${cy} ${cx},${p.y + p.h} ${p.x},${cy}`
    shape = `<polygon points="${pts}" fill="#fefce8" stroke="#ca8a04"/>`
  } else if (node.kind === 'circle') {
    shape = `<ellipse cx="${cx}" cy="${cy}" rx="${p.w / 2}" ry="${p.h / 2}" fill="#f0f9ff" stroke="#0284c7"/>`
  } else {
    shape = `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6" fill="#ffffff" stroke="#94a3b8"/>`
  }
  return `${shape}<text font-size="${FONT}" fill="#334155">${nodeText(node.text, cx, cy)}</text>`
}

function edgeSvg(e: DiagramEdge, pos: Map<string, Pos>, dir: 'TD' | 'LR'): string {
  const a = pos.get(e.from)
  const b = pos.get(e.to)
  if (!a || !b) return ''
  let x1: number
  let y1: number
  let x2: number
  let y2: number
  let lx: number
  let ly: number
  if (dir === 'TD') {
    x1 = a.x + a.w
    y1 = a.y + a.h / 2
    x2 = b.x
    y2 = b.y + b.h / 2
    lx = (x1 + x2) / 2
    ly = y1 - 6
  } else {
    x1 = a.x + a.w / 2
    y1 = a.y + a.h
    x2 = b.x + b.w / 2
    y2 = b.y
    lx = x1 + 6
    ly = (y1 + y2) / 2
  }
  const label = e.label
    ? `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="12" fill="#64748b">${escapeXml(e.label)}</text>`
    : ''
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" marker-end="url(#arrow)"/>${label}`
}

function layoutFlowchart(
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  dir: 'TD' | 'LR'
): { parts: string[]; width: number; height: number } {
  // 最长路径分层：循环回边容忍（最多迭代 nodes.length 次）
  const layer = new Map<string, number>()
  for (const n of nodes) layer.set(n.id, 0)
  for (let i = 0; i < nodes.length; i++) {
    for (const e of edges) {
      const from = layer.get(e.from) ?? 0
      const to = layer.get(e.to) ?? 0
      if (from + 1 > to) layer.set(e.to, from + 1)
    }
  }
  const byLayer = new Map<number, string[]>()
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0
    const arr = byLayer.get(l) ?? []
    arr.push(n.id)
    byLayer.set(l, arr)
  }
  const size = new Map<string, { w: number; h: number }>()
  for (const n of nodes) size.set(n.id, measure(n.text))
  const pos = new Map<string, Pos>()
  let maxX = 0
  let maxY = 0
  byLayer.forEach((ids, l) => {
    ids.forEach((id, i) => {
      const s = size.get(id) ?? { w: 80, h: 40 }
      const x = dir === 'TD' ? l * COLUMN_W : i * (COLUMN_W + 40)
      const y = dir === 'TD' ? i * ROW_H : l * ROW_H
      pos.set(id, { x, y, w: s.w, h: s.h })
      maxX = Math.max(maxX, x + s.w)
      maxY = Math.max(maxY, y + s.h)
    })
  })
  const parts: string[] = []
  for (const n of nodes) {
    const p = pos.get(n.id)
    if (p) parts.push(renderNode(n, p))
  }
  for (const e of edges) parts.push(edgeSvg(e, pos, dir))
  return { parts, width: maxX + 20, height: maxY + 20 }
}

type MindPos = { x: number; y: number; w: number; h: number; circle: boolean; text: string }

function layoutMindmap(root: MindmapTree): { parts: string[]; width: number; height: number } {
  let order = 0
  const positions: MindPos[] = []
  const parentLinks: Array<{ from: number; to: number }> = []
  const walk = (node: MindmapTree, depth: number, parentIndex: number | null): void => {
    const index = order++
    const s = measure(node.text)
    const w = node.circle ? 64 : s.w
    const h = node.circle ? 64 : s.h
    positions.push({ x: depth * COLUMN_W, y: index * ROW_H, w, h, circle: node.circle, text: node.text })
    if (parentIndex !== null) parentLinks.push({ from: parentIndex, to: index })
    for (const c of node.children) walk(c, depth + 1, index)
  }
  walk(root, 0, null)
  const parts: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    const cx = p.x + p.w / 2
    const cy = p.y + p.h / 2
    const shape = p.circle
      ? `<ellipse cx="${cx}" cy="${cy}" rx="${p.w / 2}" ry="${p.h / 2}" fill="#f0f9ff" stroke="#0284c7"/>`
      : `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="6" fill="#ffffff" stroke="#94a3b8"/>`
    parts.push(`${shape}<text font-size="${FONT}" fill="#334155">${nodeText(p.text, cx, cy)}</text>`)
  }
  for (const link of parentLinks) {
    const a = positions[link.from]
    const b = positions[link.to]
    if (!a || !b) continue
    const x1 = a.x + a.w
    const y1 = a.y + a.h / 2
    const x2 = b.x
    const y2 = b.y + b.h / 2
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8"/>`)
  }
  const width = positions.reduce((m, p) => Math.max(m, p.x + p.w), 0) + 20
  const height = positions.reduce((m, p) => Math.max(m, p.y + p.h), 0) + 20
  return { parts, width, height }
}

export function MermaidPreview({ code }: { code: string }): JSX.Element {
  const parsed = parseMermaid(code)
  if (!parsed.ok) {
    return <div className={styles.fallback}>暂不支持此图表语法：{parsed.reason}</div>
  }
  const { parts, width, height } =
    parsed.kind === 'mindmap' ? layoutMindmap(parsed.root) : layoutFlowchart(parsed.nodes, parsed.edges, parsed.dir)
  return (
    <div className={styles.preview}>
      <svg
        width={width}
        height={height}
        xmlns="http://www.w3.org/2000/svg"
        dangerouslySetInnerHTML={{ __html: ARROW + parts.join('') }}
      />
    </div>
  )
}
