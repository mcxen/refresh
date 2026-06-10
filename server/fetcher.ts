// Fetcher 抽象（docs/design.md §5）。
// BbBrowserFetcher 是当前默认；CdpFetcher 在 M2 落地；MockFetcher 供 verify.sh 确定性测试。

import { spawn } from 'child_process'
import type { SourceConfig } from './config'

export interface FetchResult {
  rawItems: unknown[]
  fetchedAt: number
}

export interface Fetcher {
  fetch(source: SourceConfig, count: number, log: (line: string) => void): Promise<FetchResult>
}

export class BbBrowserFetcher implements Fetcher {
  async fetch(source: SourceConfig, count: number, log: (line: string) => void): Promise<FetchResult> {
    const args = ['site', source.adapter, String(count), '--jq', '.']
    log(`bb-browser ${args.join(' ')}`)
    const stdout = await new Promise<string>((resolve, reject) => {
      const proc = spawn('bb-browser', args)
      let out = ''
      let err = ''
      proc.stdout.on('data', d => { out += d.toString() })
      proc.stderr.on('data', d => {
        err += d.toString()
        for (const line of d.toString().split('\n')) if (line.trim()) log(`[stderr] ${line.trim()}`)
      })
      proc.on('close', code => {
        if (code === 0) resolve(out)
        else reject(new Error(`bb-browser exit ${code}: ${err.slice(-500)}`))
      })
      proc.on('error', reject)
    })
    const data = JSON.parse(stdout) as { items?: unknown[]; fetchedAt?: number }
    return {
      rawItems: data.items ?? [],
      fetchedAt: data.fetchedAt ?? Math.floor(Date.now() / 1000),
    }
  }
}

/** 确定性假数据，verify.sh 用（RADAR_FETCHER=mock 启用） */
export class MockFetcher implements Fetcher {
  async fetch(source: SourceConfig, count: number, log: (line: string) => void): Promise<FetchResult> {
    log(`mock fetch ${source.name} count=${count}`)
    const items =
      source.platform === 'twitter'
        ? [
            { type: 'tweet', id: '9001', author: 'mockuser', url: 'https://x.com/mockuser/status/9001', text: 'mock tweet one', likes: 5, retweets: 1, replies: 0, views: 100, created_at: '2026-06-10T01:00:00.000Z' },
            { type: 'tweet', id: '9002', author: 'mockuser', url: 'https://x.com/mockuser/status/9002', text: 'mock tweet two', likes: 2, retweets: 0, replies: 1, views: 50, created_at: '2026-06-10T02:00:00.000Z' },
          ]
        : [
            { id: '8001', title: 'mock zhihu answer', excerpt: 'mock excerpt one', created_time: 1781100000, url: 'https://www.zhihu.com/question/1/answer/8001', author: { name: '测试作者', url: 'https://www.zhihu.com/people/mock-author' } },
            { id: '8002', title: 'mock zhihu answer 2', excerpt: 'mock excerpt two', created_time: 1781103600, url: 'https://www.zhihu.com/question/1/answer/8002', author: { name: '测试作者', url: 'https://www.zhihu.com/people/mock-author' } },
          ]
    return { rawItems: items.slice(0, count), fetchedAt: 1781110000 }
  }
}

export function defaultFetcher(): Fetcher {
  return process.env.RADAR_FETCHER === 'mock' ? new MockFetcher() : new BbBrowserFetcher()
}
