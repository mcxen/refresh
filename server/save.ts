// 保存/导出功能：Markdown 导出、配置管理、保存记录

import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { spawn } from 'child_process'
import { basename, join, dirname } from 'path'
import { DATA_DIR, type Resource } from './store'
import { getMessage, listMessages } from './resources'
import { rlog } from './logger'
import type { MessageSpec } from './normalize'
import { CDP_HOST, CDP_PORT, cdpAlive, ensureBrowser } from './cdp'
import { downloadMedia, mediaFilePath } from './media'

const SAVE_CONFIG_PATH = () => join(DATA_DIR, 'save-config.json')
const SAVE_HISTORY_PATH = () => join(DATA_DIR, 'save-history.json')
const DEFAULT_SAVE_PATH = () => join(DATA_DIR, 'saved')

// ---------- 配置资源 ----------

export type SaveMode = 'keyword' | 'timerange' | 'full'

export interface RssRule {
  suffix: string
  title: string
  whitelistKeywords: string[]
  sourceFilter: string[]
}

export interface SaveConfigSpec {
  enabled: boolean
  mode: SaveMode
  keywords: string[]
  timerange: { start: string; end: string }
  format: 'markdown' | 'singlefile'
  savePath: string
  sourceFilter: string[]
  rssWhitelistKeywords: string[]
  rssRules: RssRule[]
  saveOnlyUnread: boolean
  saveOnlyUnsaved: boolean
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
    savePath: DEFAULT_SAVE_PATH(),
    sourceFilter: [],
    rssWhitelistKeywords: [],
    rssRules: [],
    saveOnlyUnread: false,
    saveOnlyUnsaved: true,
  },
  status: {},
}

export async function readSaveConfig(): Promise<SaveConfig> {
  try {
    const saved = JSON.parse(await readFile(SAVE_CONFIG_PATH(), 'utf-8')) as Partial<SaveConfig>
    const savedSpec = (saved.spec ?? {}) as Partial<SaveConfigSpec>
    const rssRules = Array.isArray(savedSpec.rssRules)
      ? savedSpec.rssRules.map(v => normalizeRssRule(v)).filter((v): v is RssRule => !!v)
      : []
    return {
      ...defaultConfig,
      ...saved,
      metadata: { ...defaultConfig.metadata, ...saved.metadata },
      spec: { ...defaultConfig.spec, ...savedSpec, rssRules },
      status: {},
    }
  } catch {
    return defaultConfig
  }
}

export async function writeSaveConfig(config: SaveConfig): Promise<void> {
  await mkdir(dirname(SAVE_CONFIG_PATH()), { recursive: true })
  await writeFile(SAVE_CONFIG_PATH(), JSON.stringify(config, null, 2), 'utf-8')
}

// ---------- 保存记录 ----------

export interface SaveRecordSpec {
  messageNames: string[]
  format: 'markdown' | 'singlefile'
  trigger: 'manual' | 'scheduled'
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
    return JSON.parse(await readFile(SAVE_HISTORY_PATH(), 'utf-8')) as SaveRecord[]
  } catch {
    return []
  }
}

async function appendSaveRecord(record: SaveRecord): Promise<void> {
  const history = await readSaveHistory()
  history.unshift(record)
  // 只保留最近 50 条
  if (history.length > 50) history.splice(50)
  await mkdir(dirname(SAVE_HISTORY_PATH()), { recursive: true })
  await writeFile(SAVE_HISTORY_PATH(), JSON.stringify(history, null, 2), 'utf-8')
}

// ---------- Markdown 导出 ----------

function sanitizeFilename(str: string): string {
  return str.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100)
}

type MediaAssetMap = Map<string, string>

function messageTitle(message: Resource<MessageSpec>): string {
  return message.spec.title || message.spec.text?.slice(0, 50) || message.metadata.name
}

function messageSaveBaseName(message: Resource<MessageSpec>): string {
  return sanitizeFilename(messageTitle(message)) || message.metadata.name
}

function uniqueBaseName(baseName: string, used: Set<string>): string {
  let candidate = baseName
  let index = 2
  while (used.has(candidate)) {
    const suffix = `-${index}`
    candidate = `${baseName.slice(0, Math.max(1, 100 - suffix.length))}${suffix}`
    index++
  }
  used.add(candidate)
  return candidate
}

function markdownEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

function formatMarkdown(message: Resource<MessageSpec>, assets: MediaAssetMap = new Map()): string {
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
    md += rewriteHtmlMediaRefs(spec.content, assets) + '\n\n'
  } else if (spec.text) {
    md += spec.text + '\n\n'
  }

  // 媒体
  if (spec.media.length > 0) {
    md += '## 媒体\n\n'
    for (const m of spec.media) {
      if (m.type === 'image') {
        const src = assets.get(m.url ?? '') ?? assets.get(m.originUrl) ?? m.url ?? m.originUrl
        md += `![](${markdownEscape(src)})\n`
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

function rewriteHtmlMediaRefs(html: string, assets: MediaAssetMap): string {
  return html.replace(/(<img[^>]+src=")([^"]+)(")/g, (whole, pre, src, post) => {
    const local = assets.get(src)
    return local ? `${pre}${local}${post}` : whole
  })
}

export function messageSearchText(message: Resource<MessageSpec>): string {
  const spec = message.spec
  const author = spec.author
  return [
    spec.title || '',
    spec.text || '',
    spec.content || '',
    author?.name || '',
    author?.handle || '',
    spec.quotedSnapshot?.author || '',
    spec.quotedSnapshot?.text || '',
  ].join(' ')
}

function messageSources(message: Resource<MessageSpec>): string[] {
  return (message.metadata.annotations?.['radar/sources'] ?? message.metadata.labels?.source ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

export function matchesSourceFilter(message: Resource<MessageSpec>, sourceFilter: string[]): boolean {
  if (sourceFilter.length === 0) return true
  const sources = messageSources(message)
  return sourceFilter.some(want => sources.some(source => source === want || source.startsWith(want)))
}

export function matchesWhitelist(message: Resource<MessageSpec>, keywords: string[]): boolean {
  if (keywords.length === 0) return true
  const haystack = messageSearchText(message).toLowerCase()
  return keywords.some(k => haystack.includes(k.toLowerCase()))
}

export function matchesSaveRules(message: Resource<MessageSpec>, config: SaveConfig): boolean {
  if (!matchesSourceFilter(message, config.spec.sourceFilter)) return false

  if (config.spec.mode === 'keyword' && !matchesWhitelist(message, config.spec.keywords)) return false

  if (config.spec.mode === 'timerange') {
    const ts = message.metadata.creationTimestamp
    if (ts) {
      if (config.spec.timerange.start && ts < config.spec.timerange.start) return false
      if (config.spec.timerange.end && ts > config.spec.timerange.end) return false
    }
  }

  return true
}

export function normalizeRssRule(rule: unknown): RssRule | null {
  if (!rule || typeof rule !== 'object') return null
  const r = rule as Record<string, unknown>
  if (typeof r.suffix !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(r.suffix)) return null
  const whitelistKeywords = Array.isArray(r.whitelistKeywords)
    ? r.whitelistKeywords.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean)
    : []
  const sourceFilter = Array.isArray(r.sourceFilter)
    ? r.sourceFilter.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean)
    : []
  return {
    suffix: r.suffix,
    title: typeof r.title === 'string' && r.title.trim() ? r.title.trim() : r.suffix,
    whitelistKeywords,
    sourceFilter,
  }
}

export function matchesRssRule(message: Resource<MessageSpec>, rule: RssRule): boolean {
  return matchesSourceFilter(message, rule.sourceFilter) && matchesWhitelist(message, rule.whitelistKeywords)
}

async function saveMarkdown(message: Resource<MessageSpec>, outputDir: string, baseName: string): Promise<string> {
  await mkdir(outputDir, { recursive: true })
  const filename = sanitizeFilename(`${baseName}.md`)
  const filepath = join(outputDir, filename)
  const assets = await materializeMarkdownAssets(message, outputDir, baseName)
  const content = formatMarkdown(message, assets)
  await writeFile(filepath, content, 'utf-8')
  return filepath
}

async function materializeMarkdownAssets(message: Resource<MessageSpec>, outputDir: string, baseName: string): Promise<MediaAssetMap> {
  const assets = new Map<string, string>()
  const urls = new Set<string>()

  for (const media of message.spec.media) {
    if (media.type === 'image') {
      if (media.url) urls.add(media.url)
      urls.add(media.originUrl)
    }
  }

  if (message.spec.content) {
    for (const match of message.spec.content.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      urls.add(match[1])
    }
  }

  if (urls.size === 0) return assets
  const assetSubdir = `assets/${baseName}`
  const assetDir = join(outputDir, assetSubdir)
  await mkdir(assetDir, { recursive: true })

  for (const url of urls) {
    const file = await resolveLocalMediaFile(url)
    if (!file) continue
    const targetName = basename(file)
    await copyFile(file, join(assetDir, targetName)).catch(() => {})
    assets.set(url, `${assetSubdir}/${targetName}`)
  }

  return assets
}

async function resolveLocalMediaFile(url: string): Promise<string | null> {
  if (url.startsWith('/api/v1/media/')) {
    return mediaFilePath(url.slice('/api/v1/media/'.length))
  }
  const local = await downloadMedia(url, s => rlog('save', s))
  if (!local) return null
  return mediaFilePath(local.slice('/api/v1/media/'.length))
}

async function saveSingleFile(message: Resource<MessageSpec>, outputDir: string, baseName: string): Promise<string> {
  await mkdir(outputDir, { recursive: true })
  const url = message.spec.url
  if (!url) throw new Error(`message has no source URL: ${message.metadata.name}`)

  const filename = sanitizeFilename(`${baseName}.html`)
  const filepath = join(outputDir, filename)
  const bin = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'single-file.cmd' : 'single-file')

  const args = [
    url,
    filepath,
    '--filename-conflict-action=overwrite',
    '--browser-load-max-time=60000',
    '--browser-capture-max-time=60000',
    '--browser-wait-until=networkAlmostIdle',
    '--browser-wait-until-fallback=true',
    '--browser-wait-delay=1500',
    '--block-scripts=false',
  ]

  const browserReady = (await cdpAlive()) || (await ensureBrowser(s => rlog('singlefile', s)))
  if (browserReady) {
    args.push(`--browser-remote-debugging-URL=http://${CDP_HOST}:${CDP_PORT}`)
  }
  if (process.env.RADAR_PROXY) args.push(`--http-proxy-server=${process.env.RADAR_PROXY}`)

  await runCommand(bin, args, 120_000)
  return filepath
}

function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`single-file timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      out += String(chunk)
    })
    child.stderr.on('data', chunk => {
      err += String(chunk)
    })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error((err || out || `single-file exited with code ${code}`).trim()))
    })
  })
}

// ---------- 批量保存 ----------

export async function saveMessages(
  names: string[],
  format: 'markdown' | 'singlefile',
  trigger: 'manual' | 'scheduled' = 'manual',
): Promise<SaveRecord> {
  const now = new Date().toISOString()
  const timestamp = Math.floor(Date.now() / 1000)
  const record: SaveRecord = {
    apiVersion: 'radar/v1',
    kind: 'SaveRecord',
    metadata: { name: `save-${timestamp}`, creationTimestamp: now },
    spec: { messageNames: names, format, trigger },
    status: { phase: 'Pending', savedCount: 0, outputPath: null, error: null },
  }

  // 异步执行
  void executeSave(record)
  return record
}

async function executeSave(record: SaveRecord): Promise<void> {
  record.status.phase = 'Running'
  const config = await readSaveConfig()
  const firstMessage = record.spec.messageNames.length === 1 ? await getMessage(record.spec.messageNames[0]) : null
  const outputDirName = firstMessage
    ? messageSaveBaseName(firstMessage as unknown as Resource<MessageSpec>)
    : record.metadata.name
  const outputDir = join(config.spec.savePath, outputDirName)

  try {
    const { patchOverlayMany } = await import('./store')
    let savedCount = 0
    const savedNames: string[] = []
    const errors: string[] = []
    const usedBaseNames = new Set<string>()

    for (const name of record.spec.messageNames) {
      const message = await getMessage(name)
      if (!message) {
        rlog('save', `message not found: ${name}`)
        continue
      }

      const typedMessage = message as unknown as Resource<MessageSpec>
      if (!matchesSaveRules(typedMessage, config)) continue
      const baseName = uniqueBaseName(messageSaveBaseName(typedMessage), usedBaseNames)

      try {
        if (record.spec.format === 'markdown') {
          await saveMarkdown(typedMessage, outputDir, baseName)
        } else {
          await saveSingleFile(typedMessage, outputDir, baseName)
        }
        savedCount++
        savedNames.push(name)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`${name}: ${message}`)
        rlog('save', `${record.spec.format} failed for ${name}: ${message}`)
      }
    }

    // 标记已保存
    if (savedNames.length > 0) {
      await patchOverlayMany(
        'messages',
        Object.fromEntries(savedNames.map(n => [n, { status: { saved: true } }])),
      )
    }

    record.status.phase = 'Succeeded'
    record.status.savedCount = savedCount
    record.status.outputPath = outputDir
    if (errors.length > 0) record.status.error = errors.slice(0, 5).join('\n')
    rlog('save', `saved ${savedCount} messages to ${outputDir}`)
  } catch (err) {
    record.status.phase = 'Failed'
    record.status.error = err instanceof Error ? err.message : String(err)
    rlog('save', `failed: ${record.status.error}`)
  }

  await appendSaveRecord(record)
}

export async function saveByCurrentConfig(trigger: 'manual' | 'scheduled' = 'scheduled'): Promise<SaveRecord | null> {
  const config = await readSaveConfig()
  if (!config.spec.enabled) return null

  const messages = (await listMessages({ limit: 5000 })) as unknown as Resource<MessageSpec, Record<string, unknown>>[]
  const names = messages
    .filter(m => {
      if (config.spec.saveOnlyUnread && m.status.read) return false
      if (config.spec.saveOnlyUnsaved && m.status.saved) return false
      return matchesSaveRules(m, config)
    })
    .map(m => m.metadata.name)

  if (names.length === 0) {
    rlog('save', 'scheduled save skipped: no matching messages')
    return null
  }

  return saveMessages(names, config.spec.format, trigger)
}
