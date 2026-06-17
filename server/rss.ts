// RSS 输出（docs/design.md §3）：messages 的只读视图，读缓存不触发抓取。
// 媒体用本地化地址（绕开图床防盗链），需要 RADAR_BASE_URL 让外部阅读器能回源。

import { Hono } from 'hono'
import { listMessages } from './resources'
import { SOURCES } from './config'
import type { MessageSpec } from './normalize'
import type { Resource } from './store'

const BASE_URL = () => process.env.RADAR_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3001'}`

export const rssApp = new Hono()

rssApp.get('/:file', async c => {
  const file = c.req.param('file')
  if (!file.endsWith('.xml')) return c.json({ error: 'not found' }, 404)
  const name = file.slice(0, -'.xml'.length)
  const { readSaveConfig, matchesRssRule } = await import('./save')
  const config = await readSaveConfig()

  let labelSelector: string | undefined
  let title: string
  let customRule = null as (typeof config.spec.rssRules)[number] | null
  if (name === 'all') {
    title = 'Refresh — 全部源'
  } else if (SOURCES.some(s => s.name === name)) {
    labelSelector = `source=${name}`
    title = `Refresh — ${name}`
  } else if ((customRule = config.spec.rssRules.find(rule => rule.suffix === name) ?? null)) {
    title = `Refresh — ${customRule.title}`
  } else {
    return c.json({ error: `unknown feed: ${name}` }, 404)
  }

  const messages = (await listMessages({ labelSelector, limit: customRule ? 500 : 50 }))
    .filter(m => !customRule || matchesRssRule(m as unknown as Resource<MessageSpec>, customRule))
    .slice(0, 50)
  const xml = renderRss(title, `${BASE_URL()}/rss/${file}`, messages)
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } })
})

interface MsgLike {
  metadata: { name: string; creationTimestamp?: string; labels?: Record<string, string> }
  spec: Record<string, unknown>
}

function renderRss(title: string, selfUrl: string, messages: unknown[]): string {
  const items = (messages as MsgLike[]).map(renderItem).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(title)}</title>
<link>${esc(BASE_URL())}</link>
<atom:link href="${esc(selfUrl)}" rel="self" type="application/rss+xml"/>
<description>${esc(title)} — 个人信息雷达聚合流</description>
<language>zh-cn</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`
}

function renderItem(m: MsgLike): string {
  const spec = m.spec
  const author = (spec.author ?? {}) as Record<string, unknown>
  const platform = m.metadata.labels?.platform ?? ''
  const text = typeof spec.text === 'string' ? spec.text : ''
  const titleRaw =
    (typeof spec.title === 'string' && spec.title) ||
    (text ? text.slice(0, 80).replace(/\s+/g, ' ') : m.metadata.name)
  const authorName = (author.name ?? author.handle ?? '') as string
  const link = typeof spec.url === 'string' ? spec.url : ''
  const pubDate = m.metadata.creationTimestamp ? new Date(m.metadata.creationTimestamp).toUTCString() : ''

  const html: string[] = []
  if (authorName) html.push(`<p><strong>${esc(authorName)}</strong>${spec.retweetedBy ? esc(`（${spec.retweetedBy} 转推）`) : ''} · ${esc(platform)}</p>`)
  if (typeof spec.title === 'string' && text) html.push(`<p>${esc(text)}</p>`)
  else if (!spec.title && text) html.push(`<p>${esc(text).replace(/\n/g, '<br/>')}</p>`)
  for (const media of (spec.media ?? []) as { type: string; url: string | null; originUrl: string; playUrl?: string }[]) {
    const src = absolutize(media.url ?? media.originUrl)
    if (media.type === 'image') html.push(`<p><img src="${esc(src)}"/></p>`)
    else html.push(`<p><img src="${esc(src)}"/>${media.playUrl ? ` <a href="${esc(media.playUrl)}">▶ 视频</a>` : ''}</p>`)
  }
  const quoted = spec.quotedSnapshot as { author?: string; text?: string } | undefined
  if (quoted?.text) html.push(`<blockquote><strong>@${esc(quoted.author ?? '')}</strong>: ${esc(quoted.text)}</blockquote>`)
  if (typeof spec.content === 'string' && spec.content) html.push(`<hr/>${absolutizeHtml(spec.content)}`)

  return `<item>
<title>${esc(titleRaw)}</title>
<link>${esc(link)}</link>
<guid isPermaLink="false">${esc(m.metadata.name)}</guid>
${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
${authorName ? `<dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">${esc(authorName)}</dc:creator>` : ''}
<description><![CDATA[${cdata(html.join('\n'))}]]></description>
</item>`
}

function absolutize(url: string): string {
  return url.startsWith('/') ? `${BASE_URL()}${url}` : url
}

/** 把 HTML 里已本地化的 /api/v1/media/ 引用补全为绝对地址 */
function absolutizeHtml(html: string): string {
  return html.split('src="/api/v1/media/').join(`src="${BASE_URL()}/api/v1/media/`)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function cdata(s: string): string {
  return s.split(']]>').join(']]&gt;')
}
