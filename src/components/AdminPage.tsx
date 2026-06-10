// 管理页：账号状态 + 运行日志（data/logs 按天滚动文件的实时 tail）

import { useEffect, useRef, useState } from 'react'
import { checkAccount, useAccounts, useLogs } from '@/api/radar'
import { cn } from '@/lib/utils'
import { Loader2, RotateCw } from 'lucide-react'

const AUTH_STYLE: Record<string, string> = {
  ok: 'bg-green-500',
  logged_out: 'bg-red-500',
  browser_down: 'bg-yellow-500',
  unknown: 'bg-gray-400',
}

export function AdminPage() {
  const accounts = useAccounts()
  const [date, setDate] = useState<string | undefined>(undefined)
  const [follow, setFollow] = useState(true)
  const [checking, setChecking] = useState<string | null>(null)
  const logs = useLogs(date)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (follow && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs.data, follow])

  const recheck = async (name: string) => {
    setChecking(name)
    try {
      await checkAccount(name)
      await accounts.refetch()
    } finally {
      setChecking(null)
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4 max-w-5xl mx-auto w-full">
      <section>
        <h2 className="font-medium mb-2">账号</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(accounts.data ?? []).map(a => (
            <div key={a.metadata.name} className="border rounded-md px-3 py-2 flex items-center gap-3 text-sm">
              <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', AUTH_STYLE[a.status.auth ?? 'unknown'])} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {a.spec.displayName}
                  <span className="text-muted-foreground font-normal ml-2 text-xs">{a.status.auth ?? 'unknown'}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {(a.status.userInfo as { name?: string } | undefined)?.name ?? a.metadata.name}
                  {a.status.lastChecked && ` · 检测于 ${new Date(a.status.lastChecked).toLocaleTimeString('zh-CN')}`}
                </div>
              </div>
              <button
                onClick={() => void recheck(a.metadata.name)}
                disabled={checking === a.metadata.name}
                className="p-1.5 rounded hover:bg-accent disabled:opacity-50"
                title="重新检测登录态"
              >
                <RotateCw className={cn('h-3.5 w-3.5', checking === a.metadata.name && 'animate-spin')} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="font-medium">运行日志</h2>
          <select
            value={date ?? logs.data?.date ?? ''}
            onChange={e => setDate(e.target.value || undefined)}
            className="text-xs border rounded px-2 py-1 bg-background"
          >
            {(logs.data?.dates ?? []).map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {logs.data && !logs.data.dates.includes(logs.data.date) && (
              <option value={logs.data.date}>{logs.data.date}（今天）</option>
            )}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
            跟随最新
          </label>
          {logs.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <span className="text-xs text-muted-foreground ml-auto">每 3 秒刷新 · data/logs/radar-{logs.data?.date}.log</span>
        </div>
        <pre
          ref={logRef}
          className="flex-1 overflow-auto rounded-md bg-black/95 text-green-400 text-xs font-mono p-3 leading-5 whitespace-pre-wrap"
        >
          {(logs.data?.lines ?? []).join('\n') || '（暂无日志）'}
        </pre>
      </section>
    </div>
  )
}
