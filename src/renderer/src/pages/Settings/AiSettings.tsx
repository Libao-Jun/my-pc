import { useEffect, useState } from 'react'
import type { AiBackend, Settings } from '@shared/types'
import { useToast } from '@renderer/components/Toast'
import styles from './AiSettings.module.css'

// 与主进程 DEFAULT_MODELS 保持同组默认值（Task 3），用于后端切换时的预填
const DEFAULT_MODELS: Record<Exclude<AiBackend, 'none'>, string> = {
  'openai-compatible': 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku'
}
const BASE_URL_PLACEHOLDERS: Record<Exclude<AiBackend, 'none'>, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com'
}

export function AiSettings(): JSX.Element {
  const toast = useToast()
  const [backend, setBackend] = useState<AiBackend>('none')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [hasKey, setHasKey] = useState(false) // 已配置过 key（settings.get 脱敏值非空）
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testOk, setTestOk] = useState(false)

  // 进入页面时用已存配置预填表单
  useEffect(() => {
    void (async () => {
      const r = await window.api.settings.get()
      if (!r.ok) return
      setBackend(r.data.aiBackend)
      setBaseUrl(r.data.aiBaseUrl)
      // backend=none 无默认模型；否则模型留空时预填该后端默认值
      setModel(r.data.aiBackend === 'none' ? '' : r.data.aiModel || DEFAULT_MODELS[r.data.aiBackend])
      setHasKey(r.data.aiApiKey !== '')
    })()
  }, [])

  // 切换后端：仅当 model 为空时预填新后端默认值（已有值不覆盖）
  const onBackendChange = (b: AiBackend): void => {
    setBackend(b)
    setModel((m) => (m !== '' ? m : b === 'none' ? '' : DEFAULT_MODELS[b]))
  }

  // 组装 patch：key 留空 / 未改动（空字符串）→ 不含该字段，settings:set 保留原值
  const buildPatch = (): Partial<Settings> => {
    const patch: Partial<Settings> = {
      aiBackend: backend,
      aiBaseUrl: baseUrl.trim(),
      aiModel: model.trim()
    }
    if (apiKey) patch.aiApiKey = apiKey
    return patch
  }

  const onSave = async (): Promise<void> => {
    setSaving(true)
    const r = await window.api.settings.set(buildPatch())
    setSaving(false)
    if (r.ok) {
      toast('已保存', 'success')
      setHasKey(true)
      setApiKey('') // 清空 key 输入，避免「留空=不修改」被后续操作误覆盖
    } else {
      toast(r.error.message, 'error')
    }
  }

  const onTest = async (): Promise<void> => {
    // 本地校验：未配置则直接提示，不发请求
    if (backend === 'none' || !baseUrl.trim() || (!apiKey && !hasKey)) {
      setTestOk(false)
      setTestResult('未配置 AI 服务，将使用本地模板')
      return
    }
    setTesting(true)
    setTestResult(null)
    // 先保存当前表单（含新 key），确保测试反映表单内容而非旧配置
    const saveR = await window.api.settings.set(buildPatch())
    if (!saveR.ok) {
      setTesting(false)
      setTestOk(false)
      setTestResult(saveR.error.message)
      return
    }
    const r = await window.api.ai.test()
    setTesting(false)
    if (r.ok) {
      setHasKey(true)
      setTestOk(true)
      setTestResult(`连接成功 · ${r.data.latencyMs}ms`)
    } else {
      setTestOk(false)
      setTestResult(r.error.message)
    }
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.heading}>AI 集成</h2>
      <p className={styles.hint}>为简历优化与图表生成提供 AI 能力；未配置时相关功能将使用本地模板兜底。</p>

      <label className={styles.field}>
        后端
        <select value={backend} onChange={(e) => onBackendChange(e.target.value as AiBackend)}>
          <option value="none">不使用 AI</option>
          <option value="openai-compatible">OpenAI 兼容</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>

      {backend !== 'none' && (
        <>
          <label className={styles.field}>
            API Base URL
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={BASE_URL_PLACEHOLDERS[backend]}
              spellCheck={false}
            />
          </label>
          <label className={styles.field}>
            API Key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="已配置，留空保持不变"
            />
          </label>
          <label className={styles.field}>
            模型
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULT_MODELS[backend]}
              spellCheck={false}
            />
          </label>
        </>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={saving} onClick={() => void onSave()}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button type="button" disabled={testing} onClick={() => void onTest()}>
          {testing ? '测试中…' : '测试连接'}
        </button>
      </div>

      {testResult && (
        <div className={`${styles.result} ${testOk ? styles.ok : styles.bad}`}>{testResult}</div>
      )}
    </section>
  )
}
