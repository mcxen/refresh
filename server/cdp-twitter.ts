// 推特采集（直连 CDP）：打开 x.com/home，拦截 HomeTimeline / HomeLatestTimeline GraphQL 响应，
// 取原始 tweet result 对象作为 raw item（含 created_at、media entities、引用/转推结构）。
// docs/design.md §5：DOM 抓取拿不到的结构化数据从网络层拿。

import { closeTab, ensureBrowser, openSession, sleep, type CdpSession } from './cdp'

type Json = Record<string, unknown>

const TIMELINE_URL_MARK: Record<string, string> = {
  recommend: '/HomeTimeline',
  following: '/HomeLatestTimeline',
}

const TAB_TEXTS: Record<string, string[]> = {
  recommend: ['For you', '为你推荐', '推荐'],
  following: ['Following', '正在关注'],
}

export async function fetchTwitterTimeline(
  capability: 'recommend' | 'following',
  count: number,
  log: (s: string) => void,
): Promise<{ rawItems: unknown[]; fetchedAt: number }> {
  if (!(await ensureBrowser(log))) throw new Error('browser_down: CDP unreachable after self-heal')

  const urlMark = TIMELINE_URL_MARK[capability]
  const { tab, session } = await openSession('https://x.com/home')
  const collected = new Map<string, Json>() // rest_id → tweet result
  const pendingBodies: string[] = [] // requestIds 待取 body

  try {
    await session.send('Network.enable')
    session.on('Network.loadingFinished', params => {
      const requestId = String(params.requestId)
      if (requestWanted.has(requestId)) pendingBodies.push(requestId)
    })
    const requestWanted = new Set<string>()
    session.on('Network.responseReceived', params => {
      const url = String((params.response as Json | undefined)?.url ?? '')
      if (url.includes(urlMark)) requestWanted.add(String(params.requestId))
    })

    // 等页面就绪（tab 列表渲染出来）
    await waitFor(session, `document.querySelectorAll('[role="tab"]').length > 0`, 30_000, 'home tabs')
    log('x.com/home loaded')

    // 切到目标 tab（点击会触发对应 GraphQL 请求；当前已激活则首屏请求已被拦截）
    const texts = JSON.stringify(TAB_TEXTS[capability])
    await session.evaluate(`(() => {
      const texts = ${texts}
      const tabs = [...document.querySelectorAll('[role="tab"]')]
      const target = tabs.find(t => texts.some(x => t.textContent.trim().includes(x)))
      if (target && target.getAttribute('aria-selected') !== 'true') target.click()
      return target ? target.textContent.trim() : null
    })()`)

    const drain = async () => {
      while (pendingBodies.length > 0) {
        const requestId = pendingBodies.shift()!
        try {
          const { body, base64Encoded } = await session.send<{ body: string; base64Encoded: boolean }>(
            'Network.getResponseBody',
            { requestId },
          )
          const text = base64Encoded ? Buffer.from(body, 'base64').toString('utf-8') : body
          const before = collected.size
          extractTweets(JSON.parse(text), collected)
          if (collected.size > before) log(`+${collected.size - before} tweets (total ${collected.size})`)
        } catch {
          /* body 已被丢弃等，忽略单条失败 */
        }
      }
    }

    // 滚动加载直到够数或连续空转
    let idleRounds = 0
    for (let i = 0; i < 25 && collected.size < count; i++) {
      await sleep(2000)
      const before = collected.size
      await drain()
      if (collected.size >= count) break
      if (collected.size === before) {
        idleRounds++
        if (idleRounds >= 4) {
          log('no new tweets after 4 idle rounds, stop scrolling')
          break
        }
      } else {
        idleRounds = 0
      }
      await session.evaluate('window.scrollBy(0, document.documentElement.clientHeight * 2); true')
    }
    await sleep(1500)
    await drain()

    const rawItems = [...collected.values()].slice(0, count)
    log(`twitter/${capability}: collected ${rawItems.length} tweets via CDP`)
    if (rawItems.length === 0) {
      // 区分登录失效与页面异常：登出时 /home 会被重定向回落地页
      const url = await session.evaluate<string>('location.href')
      if (!url.includes('/home')) throw new Error(`logged_out: redirected to ${url}`)
      throw new Error('no tweets collected (page loaded but timeline empty)')
    }
    return { rawItems, fetchedAt: Math.floor(Date.now() / 1000) }
  } finally {
    session.close()
    await closeTab(tab.id)
  }
}

// ---------- GraphQL 解析 ----------

/** 从 HomeTimeline 响应中抽出全部 organic tweet result（跳过广告），按 rest_id 去重 */
function extractTweets(payload: unknown, out: Map<string, Json>): void {
  const instructions =
    (((payload as Json)?.data as Json)?.home as Json | undefined)?.home_timeline_urt as Json | undefined
  const list = (instructions?.instructions ?? []) as Json[]
  for (const ins of list) {
    if (ins.type !== 'TimelineAddEntries') continue
    for (const entry of (ins.entries ?? []) as Json[]) {
      const content = (entry.content ?? {}) as Json
      const items: Json[] = []
      if (content.entryType === 'TimelineTimelineItem') {
        items.push(content)
      } else if (content.entryType === 'TimelineTimelineModule') {
        // 会话/线程模块：内含多条
        for (const it of (content.items ?? []) as Json[]) items.push((it.item ?? {}) as Json)
      }
      for (const item of items) {
        const itemContent = (item.itemContent ?? {}) as Json
        if (itemContent.itemType !== 'TimelineTweet') continue
        if (itemContent.promotedMetadata) continue // 广告
        const result = ((itemContent.tweet_results ?? {}) as Json).result as Json | undefined
        const tweet = unwrapTweet(result)
        const restId = tweet && (tweet.rest_id as string | undefined)
        if (tweet && restId && !out.has(restId)) out.set(restId, tweet)
      }
    }
  }
}

/** TweetWithVisibilityResults 等包装层剥壳 */
function unwrapTweet(result: Json | undefined): Json | undefined {
  if (!result) return undefined
  if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) return result.tweet as Json
  return result
}

async function waitFor(session: CdpSession, expr: string, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await session.evaluate<boolean>(expr)) return
    } catch {
      /* 导航中 context 销毁，重试 */
    }
    await sleep(500)
  }
  throw new Error(`timeout waiting for ${what}`)
}
