import { registerAppIpc } from './app.ipc'
import { registerSettingsIpc } from './settings.ipc'

export function registerIpcHandlers(): void {
  registerAppIpc()
  registerSettingsIpc()
}
