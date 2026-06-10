import { useRef, useState } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import { SOURCES, createRefreshWindow, useAccounts, useInvalidate, watchRefreshWindow } from '@/api/radar'
import { Sparkles, RefreshCw, X, Layers, Rss } from 'lucide-react'

interface LogEntry {
  id: number
  message: string
  type: 'log' | 'error'
}

const AUTH_DOT: Record<string, string> = {
  ok: 'bg-green-500',
  logged_out: 'bg-red-500',
  browser_down: 'bg-yellow-500',
  unknown: 'bg-gray-400',
}

export function Sidebar() {
  const { activeSource, setActiveSource, view, setView } = useUIStore()
  const accounts = useAccounts()
  const invalidate = useInvalidate()
  const [refreshing, setRefreshing] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const logIdRef = useRef(0)
  const logContainerRef = useRef<HTMLDivElement>(null)

  const addLog = (message: string, type: 'log' | 'error' = 'log') => {
    setLogs(prev => [...prev.slice(-200), { id: ++logIdRef.current, message, type }])
    setTimeout(() => {
      logContainerRef.current?.scrollTo({ top: logContainerRef.current.scrollHeight })
    }, 0)
  }

  const authOf = (account: string) =>
    accounts.data?.find(a => a.metadata.name === account)?.status.auth ?? 'unknown'

  const handleRefresh = async () => {
    const targets = activeSource === 'all' ? SOURCES.map(s => s.name) : [activeSource]
    setRefreshing(true)
    setLogs([])
    setShowLogs(true)
    let remaining = targets.length
    for (const source of targets) {
      try {
        const win = await createRefreshWindow(source)
        addLog(`▷ ${win.metadata.name}`)
        watchRefreshWindow(
          win.metadata.name,
          line => addLog(`  ${line}`),
          result => {
            addLog(
              `◼ ${source}: ${result.phase}${result.error ? ` (${result.error})` : ''}`,
              result.phase === 'Failed' ? 'error' : 'log',
            )
            remaining--
            if (remaining <= 0) {
              setRefreshing(false)
              invalidate()
            }
          },
        )
      } catch (err) {
        addLog(`◼ ${source}: ${err instanceof Error ? err.message : err}`, 'error')
        remaining--
        if (remaining <= 0) setRefreshing(false)
      }
    }
  }

  const platforms = [
    { platform: 'zhihu' as const, label: '知乎', account: 'zhihu-main' },
    { platform: 'twitter' as const, label: '推特', account: 'twitter-main' },
  ]

  return (
    <div className="w-52 border-r bg-muted/30 flex flex-col">
      <div className="p-4 border-b">
        <h1 className="font-semibold text-lg">Radar</h1>
        <p className="text-xs text-muted-foreground">信息雷达</p>
      </div>

      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        <button
          onClick={() => setActiveSource('all')}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors hover:bg-accent',
            view === 'feed' && activeSource === 'all' && 'bg-primary text-primary-foreground hover:bg-primary',
          )}
        >
          <Sparkles className="h-4 w-4" />
          全部
        </button>

        {platforms.map(p => (
          <div key={p.platform} className="space-y-0.5">
            <div className="flex items-center gap-2 px-3 pt-2 pb-1 text-xs text-muted-foreground">
              <span className={cn('w-2 h-2 rounded-full', AUTH_DOT[authOf(p.account)])} title={authOf(p.account)} />
              {p.label}
            </div>
            {SOURCES.filter(s => s.platform === p.platform).map(source => (
              <button
                key={source.name}
                onClick={() => setActiveSource(source.name)}
                className={cn(
                  'w-full flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors hover:bg-accent ml-2',
                  view === 'feed' && activeSource === source.name &&
                    'bg-primary text-primary-foreground hover:bg-primary',
                )}
              >
                {source.label.split(' · ')[1]}
              </button>
            ))}
          </div>
        ))}

        <div className="pt-2 border-t mt-2">
          <button
            onClick={() => setView(view === 'windows' ? 'feed' : 'windows')}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors hover:bg-accent',
              view === 'windows' && 'bg-primary text-primary-foreground hover:bg-primary',
            )}
          >
            <Layers className="h-4 w-4" />
            刷新历史
          </button>
        </div>
      </nav>

      <div className="p-3 border-t text-xs text-muted-foreground space-y-2">
        <button
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border bg-background hover:bg-accent transition-colors disabled:opacity-50 text-foreground"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          {refreshing ? '抓取中…' : `刷新${activeSource === 'all' ? '全部' : ''}`}
        </button>
        <a
          href={activeSource === 'all' ? '/rss/all.xml' : `/rss/${activeSource}.xml`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-1 hover:text-foreground"
        >
          <Rss className="h-3 w-3" />
          RSS 订阅当前源
        </a>
      </div>

      {showLogs && (
        <div className="border-t bg-black/95 text-green-400 text-xs font-mono">
          <div className="flex items-center justify-between px-2 py-1 border-b border-green-900/50">
            <span className="text-green-500">Console</span>
            <button onClick={() => setShowLogs(false)} className="hover:text-green-200">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div ref={logContainerRef} className="max-h-32 overflow-y-auto p-2 space-y-0.5">
            {logs.map(log => (
              <div key={log.id} className={cn('truncate', log.type === 'error' && 'text-red-400')}>
                {log.message}
              </div>
            ))}
            {refreshing && <div className="animate-pulse">▌</div>}
          </div>
        </div>
      )}
    </div>
  )
}
