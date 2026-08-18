import { useState } from 'react'
import { useToast } from '@renderer/components/Toast'
import type { DiagramType } from '@shared/types'
import { useDiagramStore } from '@renderer/stores/diagramStore'
import { MermaidCodeView } from './MermaidCodeView'
import { MermaidPreview } from './MermaidPreview'
import styles from './DiagramGeneratorPage.module.css'

const TYPE_OPTIONS: Array<{ value: DiagramType | ''; label: string }> = [
  { value: '', label: '自动判定' },
  { value: 'mindmap', label: '思维导图' },
  { value: 'flowchart', label: '流程图' },
  { value: 'approval', label: '审批流' }
]

const TYPE_NAMES: Record<DiagramType, string> = {
  mindmap: '思维导图',
  flowchart: '流程图',
  approval: '审批流程图'
}

export function DiagramGeneratorPage(): JSX.Element {
  const toast = useToast()
  const result = useDiagramStore((s) => s.result)
  const loading = useDiagramStore((s) => s.loading)
  const error = useDiagramStore((s) => s.error)
  const generate = useDiagramStore((s) => s.generate)
  const [source, setSource] = useState('')
  const [type, setType] = useState<DiagramType | ''>('')

  const onGenerate = async (): Promise<void> => {
    if (!source.trim()) {
      toast('请输入资料', 'error')
      return
    }
    const r = await generate(source.trim(), type === '' ? undefined : type)
    if (r.ok) toast(r.data.source === 'ai' ? 'AI 生成' : '本地模板生成', 'info')
    else toast(r.error.message, 'error')
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>图表生成</h1>
        <div className={styles.toolbar}>
          <select
            className={styles.select}
            value={type}
            onChange={(e) => setType(e.target.value as DiagramType | '')}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void onGenerate()}
            disabled={loading}
          >
            {loading ? '生成中…' : '生成'}
          </button>
        </div>
      </header>
      <textarea
        className={styles.source}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        rows={8}
        placeholder="粘贴资料，自动抽取结构生成图表（可用右侧下拉手动指定类型）"
      />
      {error && <div className={styles.error}>{error}</div>}
      {result && (
        <div className={styles.result}>
          <div className={styles.meta}>
            <span className={result.source === 'ai' ? styles.ai : styles.local}>
              {result.source === 'ai' ? 'AI 生成' : '本地模板'}
            </span>
            <span className={styles.typeName}>{TYPE_NAMES[result.type]}</span>
          </div>
          <MermaidPreview code={result.mermaid} />
          <MermaidCodeView code={result.mermaid} />
        </div>
      )}
    </div>
  )
}
