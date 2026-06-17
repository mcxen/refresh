// 管理页：账号状态 + 运行日志（data/logs 按天滚动文件的实时 tail）

import { useEffect, useRef, useState } from 'react'
import { checkAccount, patchScheduler, patchSaveConfig, runSaveByConfig, useAccounts, useLogs, useScheduler, useSaveConfig, useSaveHistory } from '@/api/radar'
import { cn } from '@/lib/utils'
import { Loader2, Plus, RotateCw, Save, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

const AUTH_STYLE: Record<string, string> = {
  ok: 'bg-green-500',
  logged_out: 'bg-red-500',
  browser_down: 'bg-yellow-500',
  unknown: 'bg-gray-400',
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

type RssRule = {
  suffix: string
  title: string
  whitelistKeywords: string[]
  sourceFilter: string[]
}

function splitList(value: string): string[] {
  return value.split(',').map(s => s.trim()).filter(Boolean)
}

function normalizeSuffix(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63)
}

function emptyRssRule(index: number): RssRule {
  const suffix = `custom-${index + 1}`
  return { suffix, title: suffix, whitelistKeywords: [], sourceFilter: [] }
}

export function AdminPage() {
  const accounts = useAccounts()
  const scheduler = useScheduler()
  const saveConfig = useSaveConfig()
  const saveHistory = useSaveHistory()
  const qc = useQueryClient()
  const [date, setDate] = useState<string | undefined>(undefined)
  const [follow, setFollow] = useState(true)
  const [checking, setChecking] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingRssRules, setSavingRssRules] = useState(false)
  const [rssRules, setRssRules] = useState<RssRule[]>([])
  const logs = useLogs(date)
  const logRef = useRef<HTMLPreElement>(null)

  const updateScheduler = async (spec: { enabled?: boolean; intervalMs?: number; count?: number }) => {
    await patchScheduler(spec)
    await qc.invalidateQueries({ queryKey: ['scheduler'] })
  }

  const updateSaveConfig = async (spec: {
    enabled?: boolean
    mode?: string
    keywords?: string[]
    timerange?: { start: string; end: string }
    format?: string
    savePath?: string
    sourceFilter?: string[]
    rssWhitelistKeywords?: string[]
    rssRules?: RssRule[]
    saveOnlyUnread?: boolean
    saveOnlyUnsaved?: boolean
  }) => {
    await patchSaveConfig(spec)
    await qc.invalidateQueries({ queryKey: ['save-config'] })
  }

  const triggerSave = async () => {
    setSaving(true)
    try {
      const record = await runSaveByConfig()
      if ('saved' in record) {
        alert('没有符合规则的消息可保存')
        return
      }
      await qc.invalidateQueries({ queryKey: ['save-history'] })
      alert(`已开始保存 ${record.spec.messageNames.length} 条消息`)
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (follow && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs.data, follow])

  useEffect(() => {
    setRssRules(saveConfig.data?.spec.rssRules ?? [])
  }, [saveConfig.data?.spec.rssRules])

  const patchRssRule = (index: number, patch: Partial<RssRule>) => {
    setRssRules(current => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)))
  }

  const persistRssRules = async () => {
    setSavingRssRules(true)
    try {
      const normalized = rssRules
        .map(rule => ({
          ...rule,
          suffix: normalizeSuffix(rule.suffix),
          title: rule.title.trim() || normalizeSuffix(rule.suffix),
          whitelistKeywords: rule.whitelistKeywords.map(s => s.trim()).filter(Boolean),
          sourceFilter: rule.sourceFilter.map(s => s.trim()).filter(Boolean),
        }))
        .filter(rule => /^[a-z0-9][a-z0-9-]{0,62}$/.test(rule.suffix))
      await updateSaveConfig({ rssRules: normalized })
      setRssRules(normalized)
    } finally {
      setSavingRssRules(false)
    }
  }

  const recheck = async (name: string) => {
    setChecking(name)
    try {
      await checkAccount(name)
      await accounts.refetch()
    } finally {
      setChecking(null)
    }
  }

  return (
    <div className="h-full flex flex-col p-4 gap-4 max-w-5xl mx-auto w-full">
      <section>
        <h2 className="font-medium mb-2">账号</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(accounts.data ?? []).map(a => (
            <div key={a.metadata.name} className="border rounded-md px-3 py-2 flex items-center gap-3 text-sm">
              <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', AUTH_STYLE[a.status.auth ?? 'unknown'])} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {a.spec.displayName}
                  <span className="text-muted-foreground font-normal ml-2 text-xs">{a.status.auth ?? 'unknown'}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {(a.status.userInfo as { name?: string } | undefined)?.name ?? a.metadata.name}
                  {a.status.lastChecked && ` · 检测于 ${new Date(a.status.lastChecked).toLocaleTimeString('zh-CN')}`}
                </div>
              </div>
              <button
                onClick={() => void recheck(a.metadata.name)}
                disabled={checking === a.metadata.name}
                className="p-1.5 rounded hover:bg-accent disabled:opacity-50"
                title="重新检测登录态"
              >
                <RotateCw className={cn('h-3.5 w-3.5', checking === a.metadata.name && 'animate-spin')} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-2">定时刷新</h2>
        <div className="border rounded-md px-3 py-2.5 flex items-center gap-4 text-sm flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer font-medium">
            <input
              type="checkbox"
              checked={scheduler.data?.spec.enabled ?? false}
              onChange={e => void updateScheduler({ enabled: e.target.checked })}
            />
            {scheduler.data?.spec.enabled ? '已开启' : '已关闭'}
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            间隔
            <input
              type="number"
              min={1}
              className="w-16 px-1 py-0.5 border rounded bg-background text-foreground"
              defaultValue={Math.round((scheduler.data?.spec.intervalMs ?? 1800000) / 60000)}
              key={scheduler.data?.spec.intervalMs}
              onBlur={e => {
                const minutes = parseInt(e.target.value, 10)
                if (minutes >= 1 && minutes * 60000 !== scheduler.data?.spec.intervalMs) {
                  void updateScheduler({ intervalMs: minutes * 60000 })
                }
              }}
            />
            分钟
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            每源
            <input
              type="number"
              min={1}
              max={200}
              className="w-16 px-1 py-0.5 border rounded bg-background text-foreground"
              defaultValue={scheduler.data?.spec.count ?? 50}
              key={`count-${scheduler.data?.spec.count}`}
              onBlur={e => {
                const count = parseInt(e.target.value, 10)
                if (count >= 1 && count <= 200 && count !== scheduler.data?.spec.count) {
                  void updateScheduler({ count })
                }
              }}
            />
            条
          </label>
          <span className="text-xs text-muted-foreground ml-auto">
            {scheduler.data?.status.running && '⟳ 正在跑一轮 · '}
            上次 {fmtTime(scheduler.data?.status.lastRoundAt)} · 下次 {fmtTime(scheduler.data?.status.nextRoundAt)}
          </span>
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-2">保存设置</h2>
        <div className="border rounded-md px-3 py-2.5 space-y-3 text-sm">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={saveConfig.data?.spec.enabled ?? true}
                onChange={e => void updateSaveConfig({ enabled: e.target.checked })}
              />
              {saveConfig.data?.spec.enabled ? '定时保存已开启' : '定时保存已关闭'}
            </label>

            <label className="flex items-center gap-2">
              模式
              <select
                value={saveConfig.data?.spec.mode ?? 'full'}
                onChange={e => void updateSaveConfig({ mode: e.target.value })}
                className="px-2 py-1 border rounded bg-background text-foreground"
              >
                <option value="full">全量</option>
                <option value="keyword">关键字匹配</option>
                <option value="timerange">时间范围</option>
              </select>
            </label>

            <label className="flex items-center gap-2">
              格式
              <select
                value={saveConfig.data?.spec.format ?? 'markdown'}
                onChange={e => void updateSaveConfig({ format: e.target.value })}
                className="px-2 py-1 border rounded bg-background text-foreground"
              >
                <option value="markdown">Markdown</option>
                <option value="singlefile">SingleFile</option>
              </select>
            </label>
          </div>

          {saveConfig.data?.spec.mode === 'keyword' && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0">关键词</span>
              <input
                type="text"
                defaultValue={saveConfig.data?.spec.keywords?.join(', ')}
                onBlur={e => {
                  const kw = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  void updateSaveConfig({ keywords: kw })
                }}
                className="flex-1 px-2 py-1 border rounded bg-background text-foreground"
                placeholder="关键词1, 关键词2, ..."
              />
            </div>
          )}

          {saveConfig.data?.spec.mode === 'timerange' && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">时间</span>
              <input
                type="datetime-local"
                defaultValue={saveConfig.data?.spec.timerange?.start || ''}
                onBlur={e => {
                  const r = { ...saveConfig.data!.spec.timerange, start: e.target.value || '' }
                  void updateSaveConfig({ timerange: r })
                }}
                className="px-2 py-1 border rounded bg-background text-foreground text-xs"
              />
              <span className="text-muted-foreground">至</span>
              <input
                type="datetime-local"
                defaultValue={saveConfig.data?.spec.timerange?.end || ''}
                onBlur={e => {
                  const r = { ...saveConfig.data!.spec.timerange, end: e.target.value || '' }
                  void updateSaveConfig({ timerange: r })
                }}
                className="px-2 py-1 border rounded bg-background text-foreground text-xs"
              />
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-2 text-muted-foreground">
              路径
              <input
                type="text"
                defaultValue={saveConfig.data?.spec.savePath ?? ''}
                onBlur={e => void updateSaveConfig({ savePath: e.target.value })}
                className="w-64 px-2 py-1 border rounded bg-background text-foreground"
                placeholder="data/saved"
              />
            </label>
            <label className="flex items-center gap-2 text-muted-foreground">
              源筛选
              <input
                type="text"
                defaultValue={saveConfig.data?.spec.sourceFilter?.join(', ')}
                onBlur={e => {
                  const sf = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                  void updateSaveConfig({ sourceFilter: sf })
                }}
                className="w-48 px-2 py-1 border rounded bg-background text-foreground"
                placeholder="twitter, zhihu, bilibili"
              />
            </label>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
              <input
                type="checkbox"
                checked={saveConfig.data?.spec.saveOnlyUnsaved ?? true}
                onChange={e => void updateSaveConfig({ saveOnlyUnsaved: e.target.checked })}
              />
              只保存未保存过的消息
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
              <input
                type="checkbox"
                checked={saveConfig.data?.spec.saveOnlyUnread ?? false}
                onChange={e => void updateSaveConfig({ saveOnlyUnread: e.target.checked })}
              />
              只保存未读消息
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">RSS 条目规则</h3>
              <button
                type="button"
                onClick={() => setRssRules(current => [...current, emptyRssRule(current.length)])}
                className="p-1.5 rounded hover:bg-accent"
                title="新增 RSS 规则"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void persistRssRules()}
                disabled={savingRssRules}
                className="p-1.5 rounded hover:bg-accent disabled:opacity-50"
                title="保存 RSS 规则"
              >
                {savingRssRules ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              </button>
              <span className="text-xs text-muted-foreground ml-auto">抓取全量入库，仅 RSS 输出按条目过滤</span>
            </div>

            {rssRules.length === 0 && (
              <div className="border rounded-md px-3 py-2 text-xs text-muted-foreground">
                暂无自定义 RSS 条目规则
              </div>
            )}

            {rssRules.map((rule, index) => (
              <div key={`${rule.suffix}-${index}`} className="border rounded-md px-3 py-2 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-[140px_1fr_auto] gap-2 items-center">
                  <label className="flex items-center gap-2 text-muted-foreground">
                    后缀
                    <input
                      type="text"
                      value={rule.suffix}
                      onChange={e => patchRssRule(index, { suffix: normalizeSuffix(e.target.value) })}
                      className="min-w-0 flex-1 px-2 py-1 border rounded bg-background text-foreground"
                      placeholder="ai"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-muted-foreground">
                    标题
                    <input
                      type="text"
                      value={rule.title}
                      onChange={e => patchRssRule(index, { title: e.target.value })}
                      className="min-w-0 flex-1 px-2 py-1 border rounded bg-background text-foreground"
                      placeholder="AI"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setRssRules(current => current.filter((_, i) => i !== index))}
                    className="p-1.5 rounded hover:bg-accent justify-self-start md:justify-self-end"
                    title="删除 RSS 规则"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 text-muted-foreground">
                    白名单
                    <input
                      type="text"
                      value={rule.whitelistKeywords.join(', ')}
                      onChange={e => patchRssRule(index, { whitelistKeywords: splitList(e.target.value) })}
                      className="min-w-0 flex-1 px-2 py-1 border rounded bg-background text-foreground"
                      placeholder="OpenAI, 模型, Agent"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-muted-foreground">
                    指定源
                    <input
                      type="text"
                      value={rule.sourceFilter.join(', ')}
                      onChange={e => patchRssRule(index, { sourceFilter: splitList(e.target.value) })}
                      className="min-w-0 flex-1 px-2 py-1 border rounded bg-background text-foreground"
                      placeholder="twitter, zhihu, bilibili"
                    />
                  </label>
                </div>

                <div className="text-xs text-muted-foreground">
                  /rss/{rule.suffix || 'custom'}.xml
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => void triggerSave()}
            disabled={saving || !saveConfig.data?.spec.enabled}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? '保存中...' : '按规则保存'}
          </button>
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-2">保存历史</h2>
        <div className="border rounded-md divide-y max-h-48 overflow-auto">
          {(saveHistory.data ?? []).length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">暂无保存记录</div>
          )}
          {(saveHistory.data ?? []).map(r => (
            <div key={r.metadata.name} className="px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {new Date(r.metadata.creationTimestamp || '').toLocaleString('zh-CN')}
                </span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted">{r.spec.format}</span>
                <span className={cn('text-xs font-medium', r.status.phase === 'Succeeded' ? 'text-green-600' : r.status.phase === 'Failed' ? 'text-red-600' : 'text-yellow-600')}>
                  {r.status.phase}
                </span>
              </div>
              {r.status.phase === 'Succeeded' && (
                <div className="text-xs text-muted-foreground mt-1">
                  已保存 {r.status.savedCount} 条 → {r.status.outputPath}
                </div>
              )}
              {r.status.error && (
                <div className="text-xs text-red-600 mt-1">{r.status.error}</div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="font-medium">运行日志</h2>
          <select
            value={date ?? logs.data?.date ?? ''}
            onChange={e => setDate(e.target.value || undefined)}
            className="text-xs border rounded px-2 py-1 bg-background"
          >
            {(logs.data?.dates ?? []).map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {logs.data && !logs.data.dates.includes(logs.data.date) && (
              <option value={logs.data.date}>{logs.data.date}（今天）</option>
            )}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />
            跟随最新
          </label>
          {logs.isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <span className="text-xs text-muted-foreground ml-auto">每 3 秒刷新 · data/logs/radar-{logs.data?.date}.log</span>
        </div>
        <pre
          ref={logRef}
          className="flex-1 overflow-auto rounded-md bg-black/95 text-green-400 text-xs font-mono p-3 leading-5 whitespace-pre-wrap"
        >
          {(logs.data?.lines ?? []).join('\n') || '（暂无日志）'}
        </pre>
      </section>
    </div>
  )
}
