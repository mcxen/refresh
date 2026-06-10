# Refresh

个人信息雷达：用你自己的登录态，把知乎 / 推特 / B站推给你的内容聚合成结构化数据——一个 k8s 风格的"我的账号能力" API，配一个聚合阅读网页和标准 RSS 输出。

## 它做什么

- **采集**：直连 CDP 操控一个独立 profile 的 Chrome（登录态持久化），拦截/调用平台自己的接口拿原始数据——推特 GraphQL 时间线、知乎 topstory/moments、B站 polymer 动态流；
- **结构化**：每条内容是一个 `Message` 资源（原始 payload 永久保真 + normalized 字段），每次抓取是一个 `RefreshWindow`（"这一刻平台推了我什么"）；
- **登录闭环**：检测到掉登录 → 网页上弹二维码（镜像登录页）扫码恢复，登录态异常的账号调度器自动跳过；
- **消费**：网页（已读追踪、未读优先排序、列表/网格布局、移动端适配）+ RSS（`/rss/<source>.xml`，图片本地化，外部阅读器可直接订阅）+ 纯 JSON API（给脚本/agent 用）；
- **低频**：默认 30 分钟自动抓一轮（管理页可开关/调间隔），所有 GET 走缓存，不会高频打扰平台。

## 跑起来

```bash
pnpm install
pnpm start            # 后端 :3001 + 前端 :5173（监听 0.0.0.0，局域网可访问）
./verify.sh           # 回归测试（74 断言，全 mock，不依赖真实登录）
```

首次使用：打开 http://localhost:5173 → 未登录的平台会出横幅 → 点"去登录"扫码。数据、媒体、日志都在 `data/`（不入 git）。

## 文档

| 文件 | 内容 |
|------|------|
| [AGENTS.md](AGENTS.md) | 架构地图、核心约定、API 速查、常见任务操作手册（在此 repo 开发先读这个） |
| [docs/design.md](docs/design.md) | 原始设计蓝图：资源模型、登录机制、存储分层的完整推导 |
| [docs/progress.md](docs/progress.md) | 实施日志：每轮迭代做了什么、踩了什么坑 |

## 技术栈

Bun + Hono（REST API）· 直连 Chrome DevTools Protocol（采集与登录）· React + TanStack Query + zustand + Tailwind（前端）· 文件存储（不可变档案 + 可变 overlay 两层）
