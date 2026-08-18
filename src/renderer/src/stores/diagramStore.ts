import { create } from 'zustand'
import type { DiagramResult, DiagramType, IpcResult } from '@shared/types'

interface DiagramState {
  result: DiagramResult | null
  loading: boolean
  error: string | null
  generate: (source: string, type?: DiagramType) => Promise<IpcResult<DiagramResult>>
  clearError: () => void
}

export const useDiagramStore = create<DiagramState>((set) => ({
  result: null,
  loading: false,
  error: null,

  generate: async (source, type) => {
    set({ loading: true, error: null })
    const r = await window.api.diagram.generate({ source, type })
    set({ loading: false })
    if (r.ok) set({ result: r.data })
    else set({ error: r.error.message })
    return r
  },

  clearError: () => set({ error: null })
}))
