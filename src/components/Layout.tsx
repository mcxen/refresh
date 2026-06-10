import { ReactNode, useState } from 'react'
import { Menu } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { LoginBanner } from './LoginBanner'
import { useUnreadCounts } from '@/api/radar'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const unread = useUnreadCounts()

  return (
    <div className="h-screen flex flex-col md:flex-row">
      {/* 移动端顶栏（md 以上隐藏） */}
      <header className="md:hidden flex items-center gap-3 px-4 py-2.5 border-b bg-background shrink-0">
        <button onClick={() => setDrawerOpen(true)} aria-label="菜单">
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="font-semibold">Radar</h1>
        {(unread.data?.total ?? 0) > 0 && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">{unread.data!.total} 未读</span>
        )}
      </header>

      {/* 桌面侧栏 */}
      <div className="hidden md:flex h-full">
        <Sidebar />
      </div>

      {/* 移动端抽屉 */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute left-0 top-0 h-full shadow-xl" onClick={e => e.stopPropagation()}>
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <LoginBanner />
        <div className="flex-1 overflow-hidden">{children}</div>
      </main>
    </div>
  )
}
