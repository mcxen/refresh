// 保存/导出功能：Markdown 导出、配置管理、保存记录

import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DATA_DIR, type Resource } from './store'
import { getMessage } from './resources'
import { rlog } from './logger'
import type { MessageSpec } from './normalize'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const SAVE_CONFIG_PATH = join(DATA_DIR, 'save-config.json')
export const SAVE_HISTORY_PATH = join(DATA_DIR, 'save-history.json')
const DEFAULT_SAVE_PATH = join(DATA_DIR, 'saved')

// ---------- 配置资源 ----------

export type SaveMode = 'keyword' | 'timerange' | 'full'

export interface SaveConfigSpec {
  enabled: boolean
  mode: SaveMode
  keywords: string[]
  timerange: { start: string; end: string }
  format: 'markdown' | 'singlefile'
  savePath: string
  sourceFilter: string[]
}

export interface SaveConfig extends Resource<SaveConfigSpec, Record<string, never>> {
  kind: 'SaveConfig'
}

const defaultConfig: SaveConfig = {
  apiVersion: 'radar/v1',
  kind: 'SaveConfig',
  metadata: { name: 'default' },
  spec: {
    enabled: true,
    mode: 'full',
    keywords: [],
    timerange: { start: '', end: '' },
    format: 'markdown',
    savePath: DEFAULT_SAVE_PATH,
    sourceFilter: [],
  },
  status: {},
}

export async function readSaveConfig(): Promise<SaveConfig> {
  try {
    return JSON.parse(await readFile(SAVE_CONFIG_PATH, 'utf-8')) as SaveConfig
  } catch {
    return defaultConfig
  }
}

export async function writeSaveConfig(config: SaveConfig): Promise<void> {
  await mkdir(dirname(SAVE_CONFIG_PATH), { recursive: true })
  await writeFile(SAVE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

// ---------- 保存记录 ----------

export interface SaveRecordSpec {
  messageNames: string[]
  format: 'markdown' | 'singlefile'
  trigger: 'manual'
}

export interface SaveRecordStatus {
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed'
  savedCount: number
  outputPath: string | null
  error: string | null
}

export interface SaveRecord extends Resource<SaveRecordSpec, SaveRecordStatus> {
  kind: 'SaveRecord'
}

export async function readSaveHistory(): Promise<SaveRecord[]> {
  try {
    return JSON.parse(await readFile(SAVE_HISTORY_PATH, 'utf-8')) as SaveRecord[]
  } catch {
    return []
  }
}

async function appendSaveRecord(record: SaveRecord): Promise<void> {
  const history = await readSaveHistory()
  history.unshift(record)
  // 只保留最近 50 条
  if (history.length > 50) history.splice(50)
  await mkdir(dirname(SAVE_HISTORY_PATH), { recursive: true })
  await writeFile(SAVE_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8')
}

// ---------- Markdown 导出 ----------

function sanitizeFilename(str: string): string {
  return str.replace(/[/\\:*?"<>|]/g, '-').slice(0, 100)
}

function formatMarkdown(message: Resource<MessageSpec>): string {
  const spec = message.spec
  const meta = message.metadata
  const title = spec.title || spec.text?.slice(0, 50) || '无标题'
  const author = spec.author?.name || '未知作者'
  const source = meta.labels?.source || meta.labels?.platform || '未知来源'
  const url = spec.url || ''
  const date = meta.creationTimestamp || ''

  let md = `---
title: ${title}
author: ${author}
source: ${source}
url: ${url}
date: ${date}
---

`

  // 正文
  if (spec.content) {
    md += spec.content + '\n\n'
  } else if (spec.text) {
    md += spec.text + '\n\n'
  }

  // 媒体
  if (spec.media.length > 0) {
    md += '## 媒体\n\n'
    for (const m of spec.media) {
      if (m.type === 'image') {
        md += `![](${m.url || m.originUrl})\n`
      } else if (m.type === 'video') {
        md += `[视频](${m.playUrl || m.url || m.originUrl})\n`
      }
    }
    md += '\n'
  }

  // 引用
  if (spec.quotedSnapshot) {
    md += '## 引用\n\n'
    md += `> ${spec.quotedSnapshot.text || ''}\n`
    md += `> — ${spec.quotedSnapshot.author || ''}\n\n`
  }

  // 统计
  if (spec.stats && Object.keys(spec.stats).length > 0) {
    md += '## 统计\n\n'
    for (const [k, v] of Object.entries(spec.stats)) {
      md += `- ${k}: ${v}\n`
    }
    md += '\n'
  }

  return md
}

async function saveMarkdown(message: Resource<MessageSpec>, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true })
  const filename = sanitizeFilename(`${message.metadata.name}.md`)
  const filepath = join(outputDir, filename)
  const content = formatMarkdown(message)
  await writeFile(filepath, content, 'utf-8')
  return filepath
}

// ---------- 批量保存 ----------

export async function saveMessages(names: string[], format: 'markdown' | 'singlefile'): Promise<SaveRecord> {
  const now = new Date().toISOString()
  const timestamp = Math.floor(Date.now() / 1000)
  const record: SaveRecord = {
    apiVersion: 'radar/v1',
    kind: 'SaveRecord',
    metadata: { name: `save-${timestamp}`, creationTimestamp: now },
    spec: { messageNames: names, format, trigger: 'manual' },
    status: { phase: 'Pending', savedCount: 0, outputPath: null, error: null },
  }

  // 异步执行
  void executeSave(record)
  return record
}

async function executeSave(record: SaveRecord): Promise<void> {
  record.status.phase = 'Running'
  const config = await readSaveConfig()
  const outputDir = join(config.spec.savePath, record.metadata.name)

  try {
    const { patchOverlayMany } = await import('./store')
    let savedCount = 0

    for (const name of record.spec.messageNames) {
      const message = await getMessage(name)
      if (!message) {
        rlog('save', `message not found: ${name}`)
        continue
      }

      // 按保存规则过滤
      const spec = message.spec as MessageSpec
      const meta = message.metadata

      // 源筛选
      const source = meta.labels?.source || ''
      if (config.spec.sourceFilter.length > 0 && !config.spec.sourceFilter.some(s => source.startsWith(s))) {
        continue
      }

      // 关键词匹配（在 title/text/content 中搜索）
      if (config.spec.mode === 'keyword' && config.spec.keywords.length > 0) {
        const haystack = [spec.title || '', spec.text || '', spec.content || ''].join(' ').toLowerCase()
        if (!config.spec.keywords.some(k => haystack.includes(k.toLowerCase()))) {
          continue
        }
      }

      // 时间范围
      if (config.spec.mode === 'timerange') {
        const ts = meta.creationTimestamp
        if (ts) {
          if (config.spec.timerange.start && ts < config.spec.timerange.start) continue
          if (config.spec.timerange.end && ts > config.spec.timerange.end) continue
        }
      }

      if (record.spec.format === 'markdown') {
        await saveMarkdown(message, outputDir)
        savedCount++
      }
    }

    // 标记已保存
    await patchOverlayMany(
      'messages',
      Object.fromEntries(record.spec.messageNames.map(n => [n, { status: { saved: true } }])),
    )

    record.status.phase = 'Succeeded'
    record.status.savedCount = savedCount
    record.status.outputPath = outputDir
    rlog('save', `saved ${savedCount} messages to ${outputDir}`)
  } catch (err) {
    record.status.phase = 'Failed'
    record.status.error = err instanceof Error ? err.message : String(err)
    rlog('save', `failed: ${record.status.error}`)
  }

  await appendSaveRecord(record)
}
