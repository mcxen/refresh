import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'
import { FEED_SOURCES, type FeedCategory, type FeedSource } from '@/types'
import { User, Sparkles, ChevronRight, Database, Clock, Files, RefreshCw, X } from 'lucide-react'
import { trpc } from '@/trpc/client'
import { useState, useRef } from 'react'

interface SidebarProps {
  onSourceChange?: (source: FeedSource) => void
}

interface LogEntry {
  id: number
  message: string
  type: 'log' | 'error'
}

export function Sidebar({ onSourceChange }: SidebarProps) {
  const activeSource = useUIStore((s) => s.activeSource)
  const setActiveCategory = useUIStore((s) => s.setActiveCategory)
  const setActiveSource = useUIStore((s) => s.setActiveSource)
  const [isFetching, setIsFetching] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const logIdRef = useRef(0)
  const logContainerRef = useRef<HTMLDivElement>(null)

  const meta = trpc.meta.useQuery()
  const utils = trpc.useUtils()

  const handleCategoryClick = (category: FeedCategory) => {
    setActiveCategory(category)
    onSourceChange?.(category)
  }

  const handleSourceChange = (source: FeedSource) => {
    setActiveSource(source)
    onSourceChange?.(source)
  }

  const addLog = (message: string, type: 'log' | 'error' = 'log') => {
    setLogs(prev => [...prev, { id: ++logIdRef.current, message, type }])
    setTimeout(() => {
      if (logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
      }
    }, 0)
  }

  const handleFetch = async () => {
    setIsFetching(true)
    setLogs([])
    setShowLogs(true)
    addLog('Starting fetch...')

    try {
      const eventSource = new EventSource('/api/fetch')

      eventSource.addEventListener('log', (e: MessageEvent) => {
        addLog(e.data)
      })

      eventSource.addEventListener('error', (e: MessageEvent) => {
        addLog(e.data, 'error')
      })

      eventSource.addEventListener('done', async () => {
        eventSource.close()
        addLog('Done!')
        setIsFetching(false)
        await utils.meta.invalidate()
        await utils.feed.invalidate()
      })

      eventSource.onerror = () => {
        eventSource.close()
        addLog('Connection error', 'error')
        setIsFetching(false)
      }
    } catch (err) {
      addLog(`Error: ${err}`, 'error')
      setIsFetching(false)
    }
  }

  const categories: { id: FeedCategory; label: string; icon: React.ReactNode }[] = [
    { id: 'follow', label: '关注的人', icon: <User className="h-4 w-4" /> },
    { id: 'recommend', label: '平台推送', icon: <Sparkles className="h-4 w-4" /> },
  ]

  const formatTime = (isoString: string | null | undefined) => {
    if (!isoString) return '-'
    const date = new Date(isoString)
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  const totalFiles = meta.data?.files?.length || 0
  const totalUniqueItems = Object.values(meta.data?.sources || {})
    .reduce((sum, s) => sum + (s?.uniqueItems || 0), 0)

  return (
    <div className="w-48 border-r bg-muted/30 flex flex-col">
      <div className="p-4 border-b">
        <h1 className="font-semibold text-lg">Radar</h1>
        <p className="text-xs text-muted-foreground">信息雷达</p>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {categories.map((category) => (
          <div key={category.id} className="space-y-1">
            <button
              onClick={() => handleCategoryClick(category.id)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
                "hover:bg-accent hover:text-accent-foreground",
                (activeSource === category.id || FEED_SOURCES[category.id].some(s => s.id === activeSource)) &&
                  "bg-accent text-accent-foreground font-medium"
              )}
            >
              {category.icon}
              {category.label}
            </button>
            <div className="ml-4 space-y-0.5">
              {FEED_SOURCES[category.id].map((source) => (
                <button
                  key={source.id}
                  onClick={() => handleSourceChange(source.id)}
                  className={cn(
                    "w-full flex items-center gap-1 px-3 py-1.5 text-sm rounded-md transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    activeSource === source.id &&
                      "bg-primary text-primary-foreground hover:bg-primary"
                  )}
                >
                  <ChevronRight className="h-3 w-3" />
                  {source.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t text-xs text-muted-foreground space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-3 w-3" />
            <span>扫描: {formatTime(meta.data?.lastScanTime)}</span>
          </div>
          <button
            onClick={handleFetch}
            disabled={isFetching}
            className="p-1 hover:bg-accent rounded transition-colors disabled:opacity-50"
            title="Fetch new data"
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Files className="h-3 w-3" />
          <span>文件: {totalFiles}</span>
        </div>
        <div className="flex items-center gap-2">
          <Database className="h-3 w-3" />
          <span>条目: {totalUniqueItems}</span>
        </div>
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
            {logs.map((log) => (
              <div key={log.id} className={cn("truncate", log.type === 'error' && "text-red-400")}>
                {log.message}
              </div>
            ))}
            {isFetching && <div className="animate-pulse">▌</div>}
          </div>
        </div>
      )}
    </div>
  )
}
