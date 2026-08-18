import { create } from 'zustand'
import type { SystemOverview } from '@shared/types'

interface SystemState {
  overview: SystemOverview | null
  error: string | null
  loadOverview: () => Promise<void>
  startPolling: (intervalMs?: number) => () => void
}

export const useSystemStore = create<SystemState>((set, get) => ({
  overview: null,
  error: null,
  loadOverview: async () => {
    const r = await window.api.system.getOverview()
    if (r.ok) {
      set({ overview: r.data, error: null })
    } else {
      set({ error: r.error.message })
    }
  },
  startPolling: (intervalMs = 2000) => {
    void get().loadOverview()
    const timer = window.setInterval(() => void get().loadOverview(), intervalMs)
    return () => window.clearInterval(timer)
  }
}))
