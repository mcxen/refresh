// 一次性迁移：把旧 data/<source>-<ts>.json 包装成 RefreshWindow 档案写入 data/windows/。
// - 命名注入 account 维度：zhihu-recommend-123 → zhihu-main-recommend-123
// - 原文件保留（旧 tRPC UI 仍在读），M5 退役后可删
// - 幂等：目标已存在则跳过
// 用法：bun scripts/migrate-legacy.ts

import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { appendWindow, ensureDirs, type WindowFile } from '../server/store'
import { getSource } from '../server/config'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LEGACY_DIR = process.env.RADAR_LEGACY_DIR ?? join(__dirname, '..', 'data')

const RENAMES: Record<string, string> = {
  'zhihu-recommend': 'zhihu-main-recommend',
  'zhihu-follow': 'zhihu-main-follow',
  'twitter-recommend': 'twitter-main-recommend',
  'twitter-following': 'twitter-main-following',
}

await ensureDirs()
const files = (await readdir(LEGACY_DIR)).filter(f => /^[a-z-]+-\d{10}\.json$/.test(f))
let migrated = 0
let skipped = 0

for (const file of files.sort()) {
  const m = file.match(/^([a-z-]+)-(\d{10})\.json$/)!
  const legacySource = m[1]
  const ts = parseInt(m[2], 10)
  const sourceName = RENAMES[legacySource]
  const source = sourceName ? getSource(sourceName) : undefined
  if (!source) {
    console.log(`skip (unknown source): ${file}`)
    skipped++
    continue
  }

  let data: { items?: unknown[]; fetchedAt?: number }
  try {
    data = JSON.parse(await readFile(join(LEGACY_DIR, file), 'utf-8'))
  } catch (err) {
    console.log(`skip (unreadable): ${file}: ${err}`)
    skipped++
    continue
  }

  const iso = new Date(ts * 1000).toISOString()
  const win: WindowFile = {
    apiVersion: 'radar/v1',
    kind: 'RefreshWindow',
    metadata: {
      name: `${sourceName}-${ts}`,
      creationTimestamp: iso,
      labels: { source: sourceName, account: source.account, platform: source.platform },
      annotations: { 'radar/migratedFrom': file },
    },
    spec: { source: sourceName, account: source.account, count: data.items?.length ?? 0, trigger: 'manual' },
    status: { phase: 'Succeeded', startedAt: iso, finishedAt: iso, messageRefs: [], stats: null, error: null },
    rawItems: data.items ?? [],
  }

  try {
    await appendWindow(win)
    migrated++
    console.log(`migrated: ${file} → windows/${win.metadata.name}.json (${win.rawItems.length} items)`)
  } catch (err) {
    if (String(err).includes('immutable')) {
      skipped++ // 已迁移过，幂等跳过
    } else {
      throw err
    }
  }
}

console.log(`done: ${migrated} migrated, ${skipped} skipped, ${files.length} total`)
