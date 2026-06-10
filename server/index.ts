import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { apiV1 } from './api'
import { rssApp } from './rss'
import { ensureDirs } from './store'
import { initMedia } from './media'
import { buildIndex } from './resources'
import { startScheduler } from './scheduler'
import { rlog } from './logger'

const app = new Hono()
app.use('*', cors())

// 资源 API + RSS（docs/design.md）
await ensureDirs()
await initMedia()
await buildIndex()
app.route('/api/v1', apiV1)
app.route('/rss', rssApp)

startScheduler()

// 启动时后台预热登录态（不阻塞启动；mock/测试环境下走 mock 分支，零开销）
if (process.env.RADAR_AUTH_PRECHECK !== 'off') {
  void (async () => {
    const { ACCOUNTS } = await import('./config')
    const { checkAuth } = await import('./auth')
    for (const a of ACCOUNTS) {
      const r = await checkAuth(a.name).catch(() => null)
      rlog('auth', `${a.name}: ${r?.auth ?? 'check failed'}`)
    }
  })()
}

const port = parseInt(process.env.PORT ?? '3001', 10)
// 有意全开（局域网设备直接访问 API/RSS）；无鉴权，勿在不可信网络运行
Bun.serve({ fetch: app.fetch, port, hostname: '0.0.0.0' })
rlog('server', `running on http://0.0.0.0:${port}`)
