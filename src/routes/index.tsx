import { createFileRoute } from '@tanstack/react-router'
import { useUIStore } from '@/stores/uiStore'
import { MessageCard } from '@/components/MessageCard'
import { AdminPage } from '@/components/AdminPage'
import { useMessages, useMessagesByNames, useWindows, type RefreshWindow } from '@/api/radar'
import { Loader2, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  const view = useUIStore(s => s.view)
  if (view === 'admin') return <AdminPage />
  return view === 'windows' ? <WindowsPage /> : <FeedPage />
}

function FeedPage() {
  const activeSource = useUIStore(s => s.activeSource)
  const messages = useMessages(activeSource)

  if (messages.isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (messages.error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive">
        <p>加载失败: {(messages.error as Error).message}</p>
      </div>
    )
  }

  const items = messages.data ?? []
  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto">
      {items.map(m => (
        <MessageCard key={m.metadata.name} message={m} />
      ))}
      {items.length === 0 && <div className="text-center text-muted-foreground py-8">暂无内容，点左下角刷新抓一轮</div>}
    </div>
  )
}

function WindowsPage() {
  const { selectedWindow, setSelectedWindow } = useUIStore()
  const windows = useWindows()

  if (selectedWindow) {
    return <WindowDetail name={selectedWindow} onBack={() => setSelectedWindow(null)} windows={windows.data ?? []} />
  }

  const items = (windows.data ?? []).slice(0, 100)
  return (
    <div className="h-full overflow-y-auto p-4 max-w-3xl mx-auto">
      <h2 className="font-medium mb-3">刷新历史（每个 window = 平台当时推给你的一批内容）</h2>
      <div className="space-y-1">
        {items.map(w => (
          <button
            key={w.metadata.name}
            onClick={() => setSelectedWindow(w.metadata.name)}
            className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md hover:bg-accent text-left"
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full shrink-0',
                w.status.phase === 'Succeeded' ? 'bg-green-500' : w.status.phase === 'Failed' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse',
              )}
            />
            <span className="font-mono text-xs truncate flex-1">{w.metadata.name}</span>
            <span className="text-xs text-muted-foreground shrink-0">{w.spec.trigger}</span>
            <span className="text-xs text-muted-foreground shrink-0 w-32 text-right">
              {w.status.stats ? `新 ${w.status.stats.new} / 重复 ${w.status.stats.duplicate}` : w.status.error ? '失败' : '…'}
            </span>
          </button>
        ))}
        {items.length === 0 && !windows.isLoading && (
          <div className="text-center text-muted-foreground py-8">还没有刷新记录</div>
        )}
      </div>
    </div>
  )
}

function WindowDetail({ name, onBack, windows }: { name: string; onBack: () => void; windows: RefreshWindow[] }) {
  const win = windows.find(w => w.metadata.name === name)
  const refs = win?.status.messageRefs ?? []
  const messages = useMessagesByNames(refs.length > 0 ? refs : undefined)

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 text-sm">
        <button onClick={onBack} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
          返回
        </button>
        <span className="font-mono text-xs">{name}</span>
        {win?.status.stats && (
          <span className="text-xs text-muted-foreground ml-auto">
            共 {win.status.stats.fetched} · 新 {win.status.stats.new}
          </span>
        )}
      </div>
      {win?.status.error && <p className="text-destructive text-sm">{win.status.error}</p>}
      {refs.length === 0 && <p className="text-muted-foreground text-sm">该 window 没有记录 messageRefs（可能是迁移的历史档案）</p>}
      {(messages.data ?? []).map(m => (
        <MessageCard key={m.metadata.name} message={m} />
      ))}
    </div>
  )
}
