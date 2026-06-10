// 统一日志：stdout + data/logs/radar-YYYY-MM-DD.log（本地时区按天滚动）。
// 单进程低频写，appendFile 串行队列即可；写失败不影响主流程。

import { appendFile, readFile, readdir } from 'fs/promises'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { DATA_DIR } from './store'

export const LOGS_DIR = join(DATA_DIR, 'logs')

function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

let dirReady = false
let queue: Promise<unknown> = Promise.resolve()

/** 记一行日志：rlog('scheduler', 'round started') */
export function rlog(scope: string, message: string): void {
  const line = `${new Date().toISOString()} [${scope}] ${message}`
  console.log(line)
  queue = queue
    .then(async () => {
      if (!dirReady) {
        await mkdir(LOGS_DIR, { recursive: true })
        dirReady = true
      }
      await appendFile(join(LOGS_DIR, `radar-${today()}.log`), line + '\n', 'utf-8')
    })
    .catch(() => {})
}

export async function listLogDates(): Promise<string[]> {
  try {
    const files = await readdir(LOGS_DIR)
    return files
      .filter(f => /^radar-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .map(f => f.slice('radar-'.length, -'.log'.length))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

export async function readLogTail(date?: string, lines = 300): Promise<{ date: string; lines: string[] }> {
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today()
  const capped = Math.min(Math.max(lines, 1), 2000)
  try {
    const content = await readFile(join(LOGS_DIR, `radar-${d}.log`), 'utf-8')
    const all = content.split('\n').filter(Boolean)
    return { date: d, lines: all.slice(-capped) }
  } catch {
    return { date: d, lines: [] }
  }
}
