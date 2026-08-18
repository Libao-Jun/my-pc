import { create } from 'zustand'
import type { AdblockRule, AdblockStatus, ApplyResult, Backup } from '@shared/types'

interface AdblockState {
  rules: AdblockRule[]
  status: AdblockStatus | null
  backups: Backup[]
  error: string | null
  loading: boolean
  applying: boolean
  load: () => Promise<void>
  addRule: (rule: Omit<AdblockRule, 'id'>) => Promise<boolean>
  updateRule: (id: string, patch: Partial<AdblockRule>) => Promise<boolean>
  removeRule: (id: string) => Promise<boolean>
  apply: () => Promise<ApplyResult | null>
  restore: (backupId?: string) => Promise<boolean>
  clearError: () => void
}

export const useAdblockStore = create<AdblockState>((set, get) => ({
  rules: [],
  status: null,
  backups: [],
  error: null,
  loading: false,
  applying: false,

  load: async () => {
    set({ loading: true, error: null })
    const [rulesR, statusR, backupsR] = await Promise.all([
      window.api.adblock.getRules(),
      window.api.adblock.getStatus(),
      window.api.adblock.listBackups()
    ])
    const next: Partial<AdblockState> = { loading: false }
    if (rulesR.ok) next.rules = rulesR.data
    if (statusR.ok) next.status = statusR.data
    if (backupsR.ok) next.backups = backupsR.data
    if (!rulesR.ok) next.error = rulesR.error.message
    else if (!statusR.ok) next.error = statusR.error.message
    else if (!backupsR.ok) next.error = backupsR.error.message
    set(next)
  },

  addRule: async (rule) => {
    const r = await window.api.adblock.addRule(rule)
    if (r.ok) {
      await get().load()
      return true
    }
    set({ error: r.error.message })
    return false
  },

  updateRule: async (id, patch) => {
    const r = await window.api.adblock.updateRule(id, patch)
    if (r.ok) {
      await get().load()
      return true
    }
    set({ error: r.error.message })
    return false
  },

  removeRule: async (id) => {
    const r = await window.api.adblock.removeRule(id)
    if (r.ok) {
      await get().load()
      return true
    }
    set({ error: r.error.message })
    return false
  },

  apply: async () => {
    set({ applying: true, error: null })
    const r = await window.api.adblock.apply()
    set({ applying: false })
    if (r.ok) {
      await get().load()
      return r.data
    }
    set({ error: r.error.message })
    return null
  },

  restore: async (backupId) => {
    const r = await window.api.adblock.restore(backupId)
    if (r.ok) {
      await get().load()
      return true
    }
    set({ error: r.error.message })
    return false
  },

  clearError: () => set({ error: null })
}))
