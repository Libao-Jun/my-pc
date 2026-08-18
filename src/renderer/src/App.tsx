import { useState } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import type { PageId } from './components/layout/SideNav'
import { ToastHost } from './components/Toast'
import { AdBlockerPage } from './pages/AdBlocker/AdBlockerPage'
import { FileManagerPage } from './pages/FileManager/FileManagerPage'
import { SystemOverviewPage } from './pages/SystemMonitor/SystemOverviewPage'

export function App(): JSX.Element {
  const [page, setPage] = useState<PageId>('system')

  return (
    <>
      <AppLayout active={page} onNavigate={setPage}>
        {page === 'system' ? (
          <SystemOverviewPage />
        ) : page === 'files' ? (
          <FileManagerPage />
        ) : (
          <AdBlockerPage />
        )}
      </AppLayout>
      <ToastHost />
    </>
  )
}
