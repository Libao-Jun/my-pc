import type { Settings } from '@shared/types'
import { getDb } from '../index'

const DEFAULT_SETTINGS: Settings = {
  aiBackend: 'none',
  aiBaseUrl: '',
  aiApiKey: '',
  aiModel: '',
  largeFileThresholdMB: 100
}

const MASK = '***'

function readRaw(): Settings {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('settings') as { value: string } | undefined
  if (!row) return DEFAULT_SETTINGS
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<Settings>) }
}

function mask(settings: Settings): Settings {
  return { ...settings, aiApiKey: settings.aiApiKey ? MASK : '' }
}

export const settingsRepository = {
  get(): Settings {
    return mask(readRaw())
  },

  set(patch: Partial<Settings>): Settings {
    const next = { ...readRaw(), ...patch }
    getDb()
      .prepare(
        'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      )
      .run('settings', JSON.stringify(next))
    return mask(next)
  }
}
