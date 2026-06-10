# Radar — AGENTS 指南

**Radar 是一个"我的账号能力" API 服务**：用我自己的登录态把知乎/推特推给我的内容变成结构化资源（k8s 风格），网页和 RSS 都是这个 API 的消费者。完整设计见 **docs/design.md**（蓝图，以它为准），实施进度见 **docs/progress.md**。

## 快速上手

```bash
pnpm start        # 后端(bun, :3001) + 前端(vite, :5173)
pnpm server       # 仅后端
./verify.sh       # 验收冒烟（47 断言，改完必跑）
```

## 架构一览

```
server/
  index.ts      # Hono 入口：/api/v1 + /rss，启动时建索引、预热登录态、起调度器
  config.ts     # 账号/源注册表（account × capability，fetchVia: cdp|bb）
  store.ts      # 两层存储：data/windows 不可变档案 + data/overlay 可变用户态
  resources.ts  # 内存索引（Message/Author/Window），labelSelector 查询
  normalize.ts  # raw → spec（spec.raw 永远保留原样，两代 schema 都支持）
  refresh.ts    # RefreshWindow 执行器（统一抓取入口，Pending→Running→终态）
  fetcher.ts    # RoutingFetcher: cdp 直连 / bb-browser / mock
  cdp.ts        # CDP 客户端 + browser_down 自愈
  cdp-twitter.ts# 拦截 HomeTimeline GraphQL
  cdp-zhihu.ts  # 页面上下文调 topstory/moments API
  media.ts      # 媒体本地化（sha256 + manifest + referer/代理）
  auth.ts       # checkAuth（RADAR_AUTH_MOCK 可 mock）
  login.ts      # LoginSession（知乎扫码镜像 / 推特弹窗）
  scheduler.ts  # 30min 调度 controller（登出账号跳过）
  rss.ts        # /rss/{source}.xml
src/            # React 前端（react-query 直调 REST，tRPC 已退役）
```

## 关键约定

- **资源信封**：所有 API 对象都是 `{apiVersion: 'radar/v1', kind, metadata, spec, status}`。
- **档案不可变**：`data/windows/*.json` 只追加；用户态（labels、已读）只写 overlay，PATCH 即时生效。
- **GET 秒回缓存**：真实抓取只由 POST /refreshwindows、调度器、登录后补抓触发。
- **测试环境变量**：`RADAR_DATA_DIR`（数据目录）、`RADAR_FETCHER=mock`、`RADAR_AUTH_MOCK=ok|logged_out`、`RADAR_SCHEDULER=off`、`RADAR_SCHEDULE_INTERVAL_MS`、`RADAR_AUTH_PRECHECK=off`、`PORT`。
- **改动后必跑 `./verify.sh`**，全绿才算完。
