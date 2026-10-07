import { test, expect } from '@playwright/test'
import { mockCollector } from './fixtures'

test('Guba source exposes a progress file and isolates the output directory', async ({ page }) => {
  await mockCollector(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: '添加关注任务', exact: true }).click()
  await page.getByLabel('进度来源', { exact: true }).selectOption('guba')
  await expect(page.getByLabel('JSON 状态文件', { exact: true })).toBeVisible()
  await expect(page.getByText(/抓取命令需显式指定相同的 --output/)).toBeVisible()
})

test('Guba card and detail keep processed posts, mismatches and queues distinct', async ({ page }) => {
  const now = Date.now() / 1000
  const task = {
    config: { id: 'guba-test', name: '股吧抓取', description: '独立测试数据', adapter: 'guba',
      project: 'C:/demo/guba', match_kind: 'module', entry: 'guba', subcommands: ['crawl'],
      snapshot: 'C:/demo/guba/data/progress.json', logs: '', python: '', interval: 300 },
    snapshot: { metrics: [
      { key: 'posts_processed', label: '已处理帖', value: 64, unit: '篇' },
      { key: 'comments', label: '评论', value: 230, unit: '条' },
      { key: 'posts_count_mismatch', label: '评论数量差异', value: 4, unit: '篇' },
      { key: 'provider_balance', label: '代理余额（最近查询）', value: 388, unit: '个' }],
      queues: [{ key: 'pending', label: '待处理任务', value: 70, unit: '项' }],
      stage: '采集正文及对应评论', status: 'running', run_id: 'demo-guba',
      updated_at: now, statistics_at: now, heartbeat_at: now, completed: null, total: null,
      current: '列表 1 路 · 正文评论 3 路', issues: [], cached: false },
    resource: { roots: [{ pid: 100, created_at: now - 100, identity: '100:demo' }],
      cpu_percent: 0.1, memory_bytes: 1024, process_count: 2 },
    view: { run_state: 'running', health: 'ok', issues: [], stale: false },
    checking: false, last_checked_at: now,
  }
  await page.route('**/__observer', async route => {
    const { method } = route.request().postDataJSON()
    expect(method).toBe('snapshot')
    await route.fulfill({ json: { result: { tasks: [task], collector_generation: 1, revision: 1,
      last_scan: now, scan_error: null, observer: {}, settings: { notifications: false },
      data_dir: 'C:/demo/observer', alerts: [], events: [] } } })
  })
  await page.goto('/')
  const card = page.getByRole('link', { name: '查看 股吧抓取 详情' })
  await expect(card).toContainText('已处理帖')
  await expect(card).toContainText('230')
  await expect(card.locator('.progress-block')).toHaveCount(0)
  await card.click()
  await expect(page.getByText('股吧抓取快照', { exact: true })).toBeVisible()
  await expect(page.getByText('评论数量差异', { exact: true })).toBeVisible()
  await expect(page.getByText('代理余额（最近查询）', { exact: true })).toBeVisible()
  await expect(page.getByText('待处理任务', { exact: true })).toBeVisible()
})
