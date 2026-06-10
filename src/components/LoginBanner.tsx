// 未登录引导（docs/design.md §4）：横幅 + QR 弹窗（镜像登录页二维码）/ window 模式提示

import { useEffect, useRef, useState } from 'react'
import { createLoginSession, pollLoginSession, useAccounts, useInvalidate, type LoginSession } from '@/api/radar'
import { X } from 'lucide-react'

export function LoginBanner() {
  const accounts = useAccounts()
  const invalidate = useInvalidate()
  const [session, setSession] = useState<LoginSession | null>(null)
  const [phase, setPhase] = useState<string>('')
  const [qrTick, setQrTick] = useState(0)
  const timers = useRef<number[]>([])

  // unknown = 尚未检测，不打扰；只对确定的异常态报警
  const needLogin = (accounts.data ?? []).filter(a => a.status.auth === 'logged_out' || a.status.auth === 'browser_down')

  const clearTimers = () => {
    for (const t of timers.current) window.clearInterval(t)
    timers.current = []
  }

  const startLogin = async (account: string) => {
    const s = await createLoginSession(account)
    setSession(s)
    setPhase(s.status.phase)
    // QR 每 3 秒重拉（镜像登录页状态），会话每 2 秒轮询
    timers.current.push(window.setInterval(() => setQrTick(t => t + 1), 3000))
    timers.current.push(
      window.setInterval(async () => {
        const cur = await pollLoginSession(s.metadata.name).catch(() => null)
        if (!cur) return
        setPhase(cur.status.phase)
        if (['Succeeded', 'Failed', 'Expired'].includes(cur.status.phase)) {
          clearTimers()
          if (cur.status.phase === 'Succeeded') {
            window.setTimeout(() => {
              setSession(null)
              invalidate()
            }, 1200)
          }
        }
      }, 2000),
    )
  }

  useEffect(() => clearTimers, [])

  if (needLogin.length === 0 && !session) return null

  return (
    <>
      {needLogin.length > 0 && (
        <div className="bg-destructive/10 border-b border-destructive/30 px-4 py-2 flex items-center gap-3 text-sm">
          {needLogin.map(a => (
            <span key={a.metadata.name} className="flex items-center gap-2">
              <span>
                {a.spec.displayName}
                {a.status.auth === 'browser_down' ? '（浏览器未连接）' : ' 未登录'}
              </span>
              <button
                className="px-2 py-0.5 rounded bg-destructive text-destructive-foreground text-xs hover:opacity-90"
                onClick={() => void startLogin(a.metadata.name)}
              >
                去登录
              </button>
            </span>
          ))}
        </div>
      )}

      {session && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => { clearTimers(); setSession(null) }}>
          <div className="bg-background rounded-lg p-6 w-80 space-y-3 relative" onClick={e => e.stopPropagation()}>
            <button className="absolute right-3 top-3 text-muted-foreground hover:text-foreground" onClick={() => { clearTimers(); setSession(null) }}>
              <X className="h-4 w-4" />
            </button>
            <h3 className="font-medium">登录 {session.spec.account}</h3>
            {phase === 'Succeeded' ? (
              <p className="text-sm text-green-600">✓ 登录成功，正在补抓最新内容…</p>
            ) : session.spec.mode === 'qr' ? (
              <>
                <img
                  src={`/api/v1/loginsessions/${session.metadata.name}/qr?t=${qrTick}`}
                  alt="登录二维码"
                  className="w-56 h-56 mx-auto rounded-md border object-contain"
                />
                <p className="text-xs text-muted-foreground text-center">用手机 App 扫码，状态会自动同步（{phase}）</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                已在受管浏览器中打开登录页（窗口应已弹出），请在那里完成登录。完成后此处自动关闭。（{phase}）
              </p>
            )}
            {['Failed', 'Expired'].includes(phase) && (
              <p className="text-xs text-destructive">登录会话{phase === 'Expired' ? '已过期' : '失败'}，请关闭后重试。</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}
