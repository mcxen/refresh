import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { SOURCES, createRefreshWindow, useInvalidate, watchRefreshWindow } from '@/api/radar'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

interface RefreshControlProps {
  className?: string
  compact?: boolean
}

export function RefreshControl({ className, compact = false }: RefreshControlProps) {
  const activeSource = useUIStore(s => s.activeSource)
  const view = useUIStore(s => s.view)
  const [selection, setSelection] = useState('current')
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set())
  const [lastResult, setLastResult] = useState<string | null>(null)
  const invalidate = useInvalidate()

  const selectedTargets = () => {
    if (selection === 'all') return SOURCES.map(s => s.name)
    if (selection === 'current') {
      return view === 'feed' && activeSource !== 'all' ? [activeSource] : SOURCES.map(s => s.name)
    }
    return [selection]
  }

  const refreshSelected = () => {
    const targets = selectedTargets()
    if (targets.length === 0 || refreshing.size > 0) return
    setLastResult(null)
    setRefreshing(new Set(targets))
    let failed = 0
    let remaining = targets.length
    const finishOne = (source: string, ok: boolean) => {
      if (!ok) failed++
      setRefreshing(prev => {
        const next = new Set(prev)
        next.delete(source)
        return next
      })
      remaining--
      if (remaining <= 0) {
        setLastResult(failed > 0 ? `${failed} 个源失败` : '完成')
        invalidate()
      }
    }
    for (const source of targets) {
      createRefreshWindow(source)
        .then(win =>
          watchRefreshWindow(
            win.metadata.name,
            () => {},
            result => finishOne(source, result.phase !== 'Failed'),
          ),
        )
        .catch(() => finishOne(source, false))
    }
  }

  const busy = refreshing.size > 0

  return (
    <div className={cn('space-y-2', className)}>
      <div className={cn('flex items-center gap-2', compact ? 'text-xs' : 'text-sm')}>
        <select
          value={selection}
          onChange={e => setSelection(e.target.value)}
          disabled={busy}
          className={cn(
            'min-w-0 rounded-md border bg-background text-foreground disabled:opacity-50',
            compact ? 'w-24 px-1.5 py-1 text-xs' : 'flex-1 px-2 py-1.5',
          )}
          title="选择刷新范围"
        >
          <option value="current">当前源</option>
          <option value="all">全部源</option>
          {SOURCES.map(source => (
            <option key={source.name} value={source.name}>
              {source.label}
            </option>
          ))}
        </select>
        <button
          onClick={refreshSelected}
          disabled={busy}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-md border bg-background text-foreground transition-colors hover:bg-accent disabled:opacity-50',
            compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5',
          )}
          title="按选择刷新一轮"
        >
          <RefreshCw className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4', busy && 'animate-spin')} />
          {busy ? `刷新中${compact ? '' : ` (${refreshing.size})`}` : '刷新一轮'}
        </button>
      </div>
      {!compact && lastResult && <p className="px-1 text-xs text-muted-foreground">{lastResult}</p>}
    </div>
  )
}
