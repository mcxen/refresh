// 知乎采集（直连 CDP）：在已登录的 www.zhihu.com 页面上下文里调 topstory API，
// 拿到含封面图、完整 excerpt、作者结构的原始 feed item（docs/design.md §5）。

import { closeTab, ensureBrowser, openSession, sleep } from './cdp'

export async function fetchZhihuFeed(
  capability: 'recommend' | 'follow',
  count: number,
  log: (s: string) => void,
): Promise<{ rawItems: unknown[]; fetchedAt: number }> {
  if (!(await ensureBrowser(log))) throw new Error('browser_down: CDP unreachable after self-heal')

  const { tab, session } = await openSession('https://www.zhihu.com/')
  try {
    // 等真正导航到知乎（about:blank 也满足 readyState，必须看 hostname）；登出时知乎会跳 /signin
    const deadline = Date.now() + 25_000
    let href = ''
    while (Date.now() < deadline) {
      try {
        href = await session.evaluate<string>('location.href')
        if (href.includes('zhihu.com') && (await session.evaluate<boolean>(`document.readyState !== 'loading'`))) break
      } catch {
        /* 导航中重试 */
      }
      await sleep(500)
    }
    if (!href.includes('zhihu.com')) throw new Error(`zhihu page did not load (stuck at ${href || 'about:blank'})`)
    if (href.includes('/signin')) throw new Error(`logged_out: redirected to ${href}`)

    const firstUrl =
      capability === 'recommend'
        ? '/api/v3/feed/topstory/recommend?desktop=true&limit=6'
        : '/api/v3/moments?limit=10&desktop=true'

    const result = await session.evaluate<{ error?: string; status?: number; items?: unknown[] }>(
      `(async () => {
        const out = []
        let url = ${JSON.stringify(firstUrl)}
        for (let page = 0; page < 30 && out.length < ${count}; page++) {
          const res = await fetch(url, { credentials: 'include' })
          if (res.status === 401 || res.status === 403) return { error: 'logged_out', status: res.status }
          if (!res.ok) return { error: 'http ' + res.status, status: res.status }
          const data = await res.json()
          // 广告直接忽略；feed_group（"多人都赞了"聚合卡）拆成内含的真实条目
          for (const it of (data.data || [])) {
            if (!it || it.type === 'feed_advert') continue
            if (it.type === 'feed_group' && Array.isArray(it.list)) { out.push(...it.list); continue }
            out.push(it)
          }
          const next = data.paging && data.paging.next
          if (!next || (data.paging && data.paging.is_end)) break
          url = next
          await new Promise(r => setTimeout(r, 800))
        }
        return { items: out }
      })()`,
      120_000,
    )

    if (result.error === 'logged_out') throw new Error(`logged_out: topstory API ${result.status}`)
    if (result.error) throw new Error(`zhihu feed API failed: ${result.error}`)

    const rawItems = (result.items ?? []).slice(0, count)
    log(`zhihu/${capability}: collected ${rawItems.length} items via CDP`)
    if (rawItems.length === 0) throw new Error('no items collected from zhihu feed API')
    return { rawItems, fetchedAt: Math.floor(Date.now() / 1000) }
  } finally {
    session.close()
    await closeTab(tab.id)
  }
}
