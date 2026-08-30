import { useState } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import type { PageId } from './components/layout/SideNav'
import { ToastHost } from './components/Toast'
import { AdBlockerPage } from './pages/AdBlocker/AdBlockerPage'
import { DiagramGeneratorPage } from './pages/DiagramGenerator/DiagramGeneratorPage'
import { FileManagerPage } from './pages/FileManager/FileManagerPage'
import { ResumeOptimizerPage } from './pages/ResumeOptimizer/ResumeOptimizerPage'
import { SystemOverviewPage } from './pages/SystemMonitor/SystemOverviewPage'
import { SettingsPage } from './pages/Settings/SettingsPage'
import { WatermarkPage } from './pages/Watermark/WatermarkPage'

export function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('system')

  return (
    <>
      <AppLayout active={page} onNavigate={setPage}>
        {page === 'system' ? (
          <SystemOverviewPage />
        ) : page === 'files' ? (
          <FileManagerPage />
        ) : page === 'adblock' ? (
          <AdBlockerPage />
        ) : page === 'resume' ? (
          <ResumeOptimizerPage />
        ) : page === 'diagram' ? (
          <DiagramGeneratorPage />
        ) : page === 'watermark' ? (
          <WatermarkPage />
        ) : (
          <SettingsPage />
        )}
      </AppLayout>
      <ToastHost />
    </>
  )
}
