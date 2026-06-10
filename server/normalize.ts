// raw payload → Message spec / Author spec 的规范化。
// 原则（docs/design.md §2）：spec.raw 永远保留原样，normalized 字段全部由 raw 派生，
// 字段缺失要容忍（旧档案 schema 不全）。

export interface MediaRef {
  type: 'image' | 'video'
  originUrl: string
  /** 本地化后的服务地址 /api/v1/media/<hash>；媒体管道(M2.4)落地前为 null */
  url: string | null
  width?: number
  height?: number
}

export interface AuthorSnapshot {
  ref: string | null
  name?: string
  handle?: string
  avatar?: string | null
  url?: string
}

export interface MessageSpec {
  raw: unknown
  title?: string
  text?: string
  url?: string
  author?: AuthorSnapshot
  media: MediaRef[]
  stats?: Record<string, number>
  refs?: { quoted?: string | null; replyTo?: string | null }
  /** hydrate 后的全文（知乎正文等），默认 null */
  content: string | null
}

export interface NormalizedMessage {
  name: string
  creationTimestamp: string | null
  spec: MessageSpec
}

export interface NormalizedAuthor {
  name: string
  spec: {
    authorId?: string
    handle?: string
    displayName?: string
    avatar?: string | null
    url?: string
  }
}

export interface NormalizedItem {
  message: NormalizedMessage
  author: NormalizedAuthor | null
}

type Raw = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)

function normalizeTwitter(raw: Raw): NormalizedItem | null {
  const id = str(raw.id)
  if (!id) return null
  const handle = str(raw.author)
  const authorName = handle ? `twitter-${handle}` : null
  const created = str(raw.created_at)
  return {
    message: {
      name: `twitter-${id}`,
      creationTimestamp: created ? new Date(created).toISOString() : null,
      spec: {
        raw,
        text: str(raw.text),
        url: str(raw.url),
        author: { ref: authorName, handle, name: handle },
        media: [],
        stats: {
          likes: num(raw.likes) ?? 0,
          retweets: num(raw.retweets) ?? 0,
          replies: num(raw.replies) ?? 0,
          views: num(raw.views) ?? 0,
        },
        refs: { quoted: null, replyTo: null },
        content: null,
      },
    },
    author: authorName
      ? {
          name: authorName,
          spec: { handle, displayName: handle, url: `https://x.com/${handle}` },
        }
      : null,
  }
}

function zhihuAuthorToken(url: string | undefined): string | undefined {
  const m = url?.match(/\/people\/([^/?#]+)/)
  return m?.[1]
}

function normalizeZhihu(raw: Raw): NormalizedItem | null {
  const id = str(raw.id) ?? (num(raw.id) !== undefined ? String(raw.id) : undefined)
  if (!id) return null
  const rawAuthor = (raw.author ?? {}) as Raw
  const authorUrl = str(rawAuthor.url)
  const token = zhihuAuthorToken(authorUrl)
  const authorName = token ? `zhihu-${token}` : null
  const createdTime = num(raw.created_time)
  return {
    message: {
      name: `zhihu-${id}`,
      creationTimestamp: createdTime ? new Date(createdTime * 1000).toISOString() : null,
      spec: {
        raw,
        title: str(raw.title),
        text: str(raw.excerpt) ?? str(raw.content),
        url: str(raw.url),
        author: { ref: authorName, name: str(rawAuthor.name), url: authorUrl, avatar: str(rawAuthor.avatar) ?? null },
        media: [],
        stats: {
          voteup: num(raw.voteup_count) ?? 0,
          comments: num(raw.comment_count) ?? 0,
        },
        content: null,
      },
    },
    author: authorName
      ? {
          name: authorName,
          spec: {
            authorId: token,
            displayName: str(rawAuthor.name),
            avatar: str(rawAuthor.avatar) ?? null,
            url: authorUrl,
          },
        }
      : null,
  }
}

const NORMALIZERS: Record<string, (raw: Raw) => NormalizedItem | null> = {
  twitter: normalizeTwitter,
  zhihu: normalizeZhihu,
}

/** 规范化一条 raw item；未知平台或缺 id 返回 null（跳过但不致命） */
export function normalizeItem(platform: string, raw: unknown): NormalizedItem | null {
  const fn = NORMALIZERS[platform]
  if (!fn || typeof raw !== 'object' || raw === null) return null
  return fn(raw as Raw)
}
