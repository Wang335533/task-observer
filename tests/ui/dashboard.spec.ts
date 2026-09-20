import { test, expect } from '@playwright/test'
import { mockCollector } from './fixtures'

test.beforeEach(async ({ page }) => { await mockCollector(page) })

test('watched tasks, separate detail page, tabs and filter preservation', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '任务总览' })).toBeVisible()
  await expect(page.getByRole('link', { name: '查看 Grok 抓取 详情' })).toBeVisible()
  await expect(page.getByRole('link', { name: '查看 贴吧抓取 详情' })).toBeVisible()
  await expect(page.locator('.task-card')).toHaveCount(2)
  await expect(page.getByText('模型训练', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '运行中', exact: true }).click()
  await page.getByRole('link', { name: '查看 Grok 抓取 详情' }).click()
  await expect(page).toHaveURL(/#\/task\/grok$/)
  await expect(page.getByRole('heading', { name: 'Grok 抓取', exact: true })).toBeVisible()
  await expect(page.locator('.task-grid')).toHaveCount(0)
  await page.getByRole('tab', { name: '运行日志' }).click()
  await expect(page.getByRole('heading', { name: '最近日志' })).toBeVisible()
  await page.getByRole('tab', { name: '资源趋势' }).click()
  await expect(page.getByRole('heading', { name: 'CPU 使用率' })).toBeVisible()
  await page.getByRole('tab', { name: '运行历史' }).click()
  await expect(page.getByRole('heading', { name: '本任务运行历史' })).toBeVisible()
  await page.getByRole('button', { name: '返回任务总览' }).click()
  await expect(page.getByRole('button', { name: '运行中', exact: true })).toHaveClass(/selected/)
  await page.getByRole('button', { name: '全部任务' }).click()
  await page.getByRole('link', { name: '查看 贴吧抓取 详情' }).click()
  await expect(page).toHaveURL(/#\/task\/tieba$/)
  await page.getByRole('button', { name: '返回任务总览' }).click()
  await expect(page.locator('.task-card')).toHaveCount(2)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.screenshot({ path: 'docs/images/overview.png', fullPage: true })
  expect(errors).toEqual([])
})

test('search, accessible configuration, settings and small window layout', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.task-card')).toHaveCount(2)
  await page.getByRole('textbox', { name: '搜索关注任务' }).fill('贴吧')
  await expect(page.locator('.task-card')).toHaveCount(1)
  await page.getByRole('textbox', { name: '搜索关注任务' }).fill('')
  await page.getByRole('button', { name: '添加关注任务' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('任务名称', { exact: true })).toBeVisible()
  await page.getByLabel('进度来源', { exact: true }).selectOption('grok')
  await expect(page.getByText('自动读取项目的只读进度模块与配置，无需另行指定 Python；不会运行抓取命令。')).toBeVisible()
  await expect(page.getByLabel('项目 Python 解释器')).toHaveCount(0)
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await expect(page.getByRole('switch', { name: '开机自动启动' })).toBeDisabled()
  await page.getByRole('link', { name: '任务总览', exact: true }).click()
  await page.setViewportSize({ width: 800, height: 850 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('link', { name: '查看 贴吧抓取 详情' }).click()
  await expect(page.getByRole('heading', { name: '贴吧抓取', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'docs/images/detail.png', fullPage: true })
})

test('fresh installation has no invented tasks', async ({ page }) => {
  await page.unroute('**/__observer')
  await mockCollector(page, true)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '任务总览' })).toBeVisible()
  await expect(page.locator('.task-card')).toHaveCount(0)
  await expect(page.getByText('没有符合条件的任务')).toBeVisible()
  await expect(page.getByRole('button', { name: '添加关注任务' })).toBeVisible()
})

test('all six adapters open independent pages and show check cadence', async ({ page }) => {
  await page.unroute('**/__observer')
  await mockCollector(page, false, true)
  await page.goto('/')
  await expect(page.locator('.task-card')).toHaveCount(6)
  await expect(page.getByText('助手在线', { exact: true })).toBeVisible()
  await expect(page.locator('.check-cadence')).toHaveCount(6)
  await expect(page.locator('.check-cadence').filter({ hasText: '每 5 分钟检查' })).toHaveCount(6)
  for (const name of ['微软 QA 抓取', '古籍 · 国书数据库', 'SSRN PDF 抓取', '知网文献元数据']) {
    await page.getByRole('link', { name: `查看 ${name} 详情` }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect(page.locator('.task-grid')).toHaveCount(0)
    await page.getByRole('button', { name: '返回任务总览' }).click()
    await expect(page.locator('.task-card')).toHaveCount(6)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.screenshot({ path: 'docs/images/overview.png', fullPage: true })
})

test('overview and log automatic reads wait five minutes', async ({ page }) => {
  await page.clock.install()
  const reads: Record<string, number> = {}
  page.on('request', request => {
    if (request.url().endsWith('/__observer')) {
      const { method } = request.postDataJSON()
      reads[method] = (reads[method] || 0) + 1
    }
  })
  await page.goto('/')
  await expect(page.locator('.task-card')).toHaveCount(2)
  await page.getByRole('link', { name: '查看 Grok 抓取 详情' }).click()
  await page.getByRole('tab', { name: '运行日志' }).click()
  await expect(page.locator('.log-content')).toBeVisible()
  const before = { ...reads }
  await page.clock.fastForward(299_000)
  expect(reads.snapshot).toBe(before.snapshot)
  expect(reads.logs).toBe(before.logs)
  await page.clock.fastForward(1_000)
  await expect.poll(() => reads.snapshot).toBe(before.snapshot + 1)
  await expect.poll(() => reads.logs).toBe(before.logs + 1)
})

test('detail reads only active tab data', async ({ page }) => {
  const sections: string[] = []
  page.on('request', request => {
    if (request.url().endsWith('/__observer')) {
      const { method, params } = request.postDataJSON()
      if (method === 'detail') sections.push(params.section)
    }
  })
  await page.goto('/')
  await page.getByRole('link', { name: '查看 Grok 抓取 详情' }).click()
  await expect(page.getByRole('heading', { name: 'Grok 抓取', exact: true })).toBeVisible()
  expect(sections).toEqual([])
  await page.getByRole('tab', { name: '资源趋势' }).click()
  await expect(page.getByRole('heading', { name: 'CPU 使用率' })).toBeVisible()
  expect(sections).toEqual(['resources'])
  await page.getByRole('tab', { name: '运行历史' }).click()
  await expect.poll(() => sections).toEqual(['resources', 'history'])
})
