import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

const app = new Hono()
app.use('*', cors())

const DATA_DIR = join(import.meta.dir, '..', 'data')

// 扫描并读取最新的数据文件
async function loadLatestData(prefix: string): Promise<unknown> {
  const files = await readdir(DATA_DIR)
  const matched = files
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse()

  if (matched.length === 0) {
    return { count: 0, items: [], fetchedAt: null }
  }

  const content = await readFile(join(DATA_DIR, matched[0]), 'utf-8')
  return JSON.parse(content)
}

app.get('/api/zhihu/recommend', async (c) => {
  const data = await loadLatestData('zhihu-recommend-')
  return c.json(data)
})

app.get('/api/zhihu/follow', async (c) => {
  const data = await loadLatestData('zhihu-follow-')
  return c.json(data)
})

app.get('/api/twitter/recommend', async (c) => {
  const data = await loadLatestData('twitter-recommend-')
  return c.json(data)
})

app.get('/api/twitter/following', async (c) => {
  const data = await loadLatestData('twitter-following-')
  return c.json(data)
})

const port = 3001
Bun.serve({ fetch: app.fetch, port })
console.log(`Server running on http://localhost:${port}`)
