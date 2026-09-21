import type { Page } from '@playwright/test'
import type { Snapshot, Task } from '../../src/lib/types'

// Synthetic fixtures only. Never read personal tasks or running collectors.
export async function mockCollector(page: Page, empty = false, allAdapters = false) {
  const now = Date.now() / 1000
  const tasks: Task[] = ['grok', 'tieba'].map((id, index) => ({
    config: { id, name: index ? '贴吧抓取' : 'Grok 抓取', description: '演示数据 · 非真实运行记录',
      adapter: id as 'grok' | 'tieba', project: `C:\\demo\\${id}`, match_kind: 'module',
      entry: `${id}spider`, subcommands: ['run'], snapshot: '', logs: '', python: '', interval: 300 },
    snapshot: { metrics: [
      { key: 'posts', label: '帖子', value: index ? 2400 : 1200, unit: '' },
      { key: 'comments', label: '评论', value: index ? 9600 : 4800, unit: '' },
      { key: 'users', label: '用户', value: null, unit: '' }],
      queues: [], stage: index ? '等待下次运行' : '采集会话', status: index ? 'completed' : 'running',
      run_id: `demo-${id}`, updated_at: now, statistics_at: now, started_at: now - 3600,
      finished_at: index ? now - 120 : null, issues: [], completed: null, total: null, current: '', cached: false },
    resource: { roots: index ? [] : [{ pid: 100, created_at: now - 3600, identity: '100:demo' }],
      cpu_percent: index ? null : 0.4, memory_bytes: index ? null : 128 * 1024 ** 2, process_count: index ? 0 : 1 },
    view: { run_state: index ? 'completed' : 'running', health: 'ok', issues: [], stale: false }, checking: false, last_checked_at: now,
  }))
  if (allAdapters) {
    const names = { msqa: '微软 QA 抓取', kokusho: '古籍 · 国书数据库', ssrn: 'SSRN PDF 抓取', cnki: '知网文献元数据' }
    for (const adapter of ['msqa', 'kokusho', 'ssrn', 'cnki'] as const) {
      const task = structuredClone(tasks[0])
      task.config = { ...task.config, id: adapter, name: names[adapter], adapter, interval: 300 }
      task.snapshot.stage = adapter === 'ssrn' ? '助手在线，下载活动未确认' : '读取业务进展'
      const labels = { msqa: ['完整问题', '回答'], kokusho: ['书目详情', '著作详情'], ssrn: ['已下载 PDF', '待下载'], cnki: ['已完成期刊', '本刊论文（期次汇总）'] }
      task.snapshot.metrics = labels[adapter].map((label, index) => ({ key: `metric-${index}`, label, value: index ? 240 : 120, unit: '' }))
      if (adapter === 'ssrn') task.view.run_state = 'service_online'
      task.last_checked_at = now
      tasks.push(task)
    }
  }
  const snapshot: Snapshot = { collector_generation: 1, revision: 1, tasks: empty ? [] : tasks, last_scan: now, scan_error: null,
    observer: { cpu_percent: 0.1, memory_bytes: 32 * 1024 ** 2 }, settings: { notifications: true },
    data_dir: 'C:\\demo\\observer-data', alerts: [], events: [] }
  await page.route('**/__observer', async route => {
    const { method } = route.request().postDataJSON()
    const results: Record<string, unknown> = { snapshot, detail: { samples: [], history: [] },
      history: [], logs: { lines: ['[演示] 正在读取任务进展'], path: '', message: '' } }
    if (!(method in results)) throw new Error(`Unmocked RPC: ${method}`)
    await route.fulfill({ json: { result: results[method] } })
  })
}
