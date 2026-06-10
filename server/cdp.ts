// 直连 CDP 的最小客户端（docs/design.md §5）。
// 复用 bb-browser 受管 Chrome（默认 CDP 19825），不依赖其 daemon —— 不可用时自愈拉起。

import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

export const CDP_HOST = '127.0.0.1'
export const CDP_PORT = parseInt(process.env.RADAR_CDP_PORT ?? '19825', 10)
const HTTP_BASE = `http://${CDP_HOST}:${CDP_PORT}`

// ---------- 健康检查与自愈 ----------

export async function cdpAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${HTTP_BASE}/json/version`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * browser_down 自愈：经 bb-browser CLI 拉起受管 Chrome（它负责找可执行文件和 profile），
 * 不可用时先重启它的 daemon（已知会卡在失效 CDP 连接上）。返回是否恢复。
 */
export async function ensureBrowser(log: (s: string) => void = () => {}): Promise<boolean> {
  if (await cdpAlive()) return true
  log('CDP unreachable, self-healing: restarting bb-browser daemon + managed Chrome')
  try {
    await exec('bb-browser', ['daemon', 'shutdown'], { timeout: 10_000 }).catch(() => {})
    // 任意命令都会触发 daemon 启动 + launchManagedBrowser
    await exec('bb-browser', ['status'], { timeout: 20_000 }).catch(() => {})
  } catch {
    /* CLI 不存在等场景，下面的探测会给出结论 */
  }
  for (let i = 0; i < 20; i++) {
    if (await cdpAlive()) {
      log('CDP recovered')
      return true
    }
    await sleep(500)
  }
  log('CDP self-heal failed')
  return false
}

// ---------- 标签页 ----------

export interface TabInfo {
  id: string
  url: string
  webSocketDebuggerUrl: string
}

export async function listTabs(): Promise<TabInfo[]> {
  const res = await fetch(`${HTTP_BASE}/json`)
  const all = (await res.json()) as (TabInfo & { type: string })[]
  return all.filter(t => t.type === 'page')
}

export async function newTab(url = 'about:blank'): Promise<TabInfo> {
  const res = await fetch(`${HTTP_BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!res.ok) throw new Error(`CDP /json/new failed: ${res.status}`)
  return (await res.json()) as TabInfo
}

export async function closeTab(id: string): Promise<void> {
  await fetch(`${HTTP_BASE}/json/close/${id}`).catch(() => {})
}

// ---------- WebSocket 会话 ----------

type EventHandler = (params: Record<string, unknown>) => void

export class CdpSession {
  private ws: WebSocket
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private handlers = new Map<string, Set<EventHandler>>()

  private constructor(ws: WebSocket) {
    this.ws = ws
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number
        method?: string
        params?: Record<string, unknown>
        result?: unknown
        error?: { message: string }
      }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id)
        if (p) {
          this.pending.delete(msg.id)
          if (msg.error) p.reject(new Error(msg.error.message))
          else p.resolve(msg.result)
        }
      } else if (msg.method) {
        for (const fn of this.handlers.get(msg.method) ?? []) fn(msg.params ?? {})
      }
    })
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('CDP socket closed'))
      this.pending.clear()
    })
  }

  static async connect(wsUrl: string): Promise<CdpSession> {
    const ws = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error(`CDP connect failed: ${wsUrl}`)), { once: true })
    })
    return new CdpSession(ws)
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: v => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: e => {
          clearTimeout(timer)
          reject(e)
        },
      })
    })
  }

  on(method: string, handler: EventHandler): () => void {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set())
    this.handlers.get(method)!.add(handler)
    return () => this.handlers.get(method)?.delete(handler)
  }

  /** 页面上下文执行 JS（awaitPromise），返回 JSON 序列化结果 */
  async evaluate<T = unknown>(expression: string, timeoutMs = 30_000): Promise<T> {
    const res = await this.send<{
      result: { type: string; value?: unknown; description?: string }
      exceptionDetails?: { text: string; exception?: { description?: string } }
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs)
    if (res.exceptionDetails) {
      throw new Error(`evaluate failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`)
    }
    return res.result.value as T
  }

  close(): void {
    this.ws.close()
  }
}

/** 开新 tab 并建立会话；用完记得 session.close() + closeTab(tab.id) */
export async function openSession(url: string): Promise<{ tab: TabInfo; session: CdpSession }> {
  const tab = await newTab(url)
  const session = await CdpSession.connect(tab.webSocketDebuggerUrl)
  return { tab, session }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
