// 未登录引导（docs/design.md §4）：横幅 + 弹窗。
// qr 模式（知乎/B站）：镜像登录页二维码扫码；
// password 模式（推特）：交互式凭据中继——服务端报当前要填什么，这里渲染表单提交，支持多步（2FA）。

import { useEffect, useRef, useState } from 'react'
import {
  createLoginSession,
  pollLoginSession,
  submitLoginInput,
  useAccounts,
  useInvalidate,
  type LoginSession,
} from '@/api/radar'
import { X, Loader2 } from 'lucide-react'

export function LoginBanner() {
  const accounts = useAccounts()
  const invalidate = useInvalidate()
  const [session, setSession] = useState<LoginSession | null>(null)
  const [qrTick, setQrTick] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const timers = useRef<number[]>([])

  // unknown = 尚未检测，不打扰；只对确定的异常态报警
  const needLogin = (accounts.data ?? []).filter(a => a.status.auth === 'logged_out' || a.status.auth === 'browser_down')

  const clearTimers = () => {
    for (const t of timers.current) window.clearInterval(t)
    timers.current = []
  }

  const handleResult = (cur: LoginSession) => {
    setSession(cur)
    if (['Succeeded', 'Failed', 'Expired'].includes(cur.status.phase)) {
      clearTimers()
      if (cur.status.phase === 'Succeeded') {
        window.setTimeout(() => {
          setSession(null)
          setValues({})
          invalidate()
        }, 1200)
      }
    }
  }

  const startLogin = async (account: string) => {
    clearTimers()
    setValues({})
    const s = await createLoginSession(account)
    setSession(s)
    // 二维码每 3 秒重拉；所有模式都每 2 秒轮询会话状态
    if (s.spec.mode === 'qr') timers.current.push(window.setInterval(() => setQrTick(t => t + 1), 3000))
    timers.current.push(
      window.setInterval(async () => {
        const cur = await pollLoginSession(s.metadata.name).catch(() => null)
        if (cur) handleResult(cur)
      }, 2000),
    )
  }

  const submit = async () => {
    if (!session) return
    setSession({ ...session, status: { ...session.status, phase: 'Submitting' } })
    try {
      const cur = await submitLoginInput(session.metadata.name, values)
      setValues({})
      handleResult(cur)
    } catch (err) {
      setSession({
        ...session,
        status: { ...session.status, phase: 'WaitingInput', error: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  const close = () => {
    clearTimers()
    setSession(null)
    setValues({})
  }

  useEffect(() => clearTimers, [])

  if (needLogin.length === 0 && !session) return null

  const phase = session?.status.phase ?? ''
  const challenge = session?.status.challenge
  const challengeFields = challenge?.fields ?? []
  const canSubmit = challengeFields.length > 0 && challengeFields.every(f => values[f.name]?.trim()) && phase !== 'Submitting'

  return (
    <>
      {needLogin.length > 0 && (
        <div className="bg-destructive/10 border-b border-destructive/30 px-4 py-2 flex items-center gap-3 text-sm flex-wrap">
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
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={close}>
          <div className="bg-background rounded-lg p-6 w-80 space-y-3 relative" onClick={e => e.stopPropagation()}>
            <button className="absolute right-3 top-3 text-muted-foreground hover:text-foreground" onClick={close}>
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
                <p className="text-xs text-muted-foreground text-center">用手机 App 扫码，状态自动同步（{phase}）</p>
              </>
            ) : (
              // password 模式
              <>
                {phase === 'Submitting' || phase === 'Pending' ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {phase === 'Pending' ? '正在打开登录页…' : '提交中，等待平台响应…'}
                  </div>
                ) : challengeFields.length > 0 ? (
                  <form
                    className="space-y-2"
                    onSubmit={e => {
                      e.preventDefault()
                      if (canSubmit) void submit()
                    }}
                  >
                    {challenge?.note && <p className="text-xs text-muted-foreground">{challenge.note}</p>}
                    {challengeFields.map(f => (
                      <label key={f.name} className="block text-xs text-muted-foreground space-y-1">
                        {f.label}
                        <input
                          type={f.kind === 'password' ? 'password' : 'text'}
                          autoComplete={f.kind === 'password' ? 'current-password' : f.name.includes('verification') ? 'one-time-code' : 'username'}
                          className="w-full px-2 py-1.5 border rounded bg-background text-foreground text-sm"
                          value={values[f.name] ?? ''}
                          onChange={e => setValues(v => ({ ...v, [f.name]: e.target.value }))}
                          autoFocus={f === challengeFields[0]}
                        />
                      </label>
                    ))}
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="w-full mt-1 px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50"
                    >
                      下一步
                    </button>
                    <p className="text-[11px] text-muted-foreground">
                      凭据直接发到本机服务，由它在真实登录页代填，不经第三方。
                    </p>
                  </form>
                ) : (
                  <p className="text-sm text-muted-foreground">正在准备登录表单…（{phase}）</p>
                )}
              </>
            )}

            {session.status.error && phase !== 'Succeeded' && (
              <p className="text-xs text-destructive">{session.status.error}</p>
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
