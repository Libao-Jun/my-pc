import { useEffect, useState } from 'react'
import styles from './Toast.module.css'

type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

// 极简全局消息队列：useToast() 触发，ToastHost 渲染
let nextId = 0
let items: ToastItem[] = []
const listeners = new Set<(items: ToastItem[]) => void>()

function emit(): void {
  for (const l of listeners) l(items)
}

export function useToast(): (message: string, tone?: ToastTone) => void {
  return (message, tone = 'info') => {
    const id = ++nextId
    items = [...items, { id, message, tone }]
    emit()
    setTimeout(() => {
      items = items.filter((t) => t.id !== id)
      emit()
    }, 3000)
  }
}

export function ToastHost(): JSX.Element {
  const [list, setList] = useState<ToastItem[]>([])
  useEffect(() => {
    listeners.add(setList)
    setList(items)
    return () => {
      listeners.delete(setList)
    }
  }, [])
  return (
    <div className={styles.host}>
      {list.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.tone]}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
