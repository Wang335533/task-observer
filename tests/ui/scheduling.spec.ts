import { test, expect, type Route } from '@playwright/test'
import type { Snapshot } from '../../src/lib/types'
import { mockCollector } from './fixtures'

test('late old replies and old collector generations cannot overwrite fresh cards', async ({ page }) => {
  await mockCollector(page)
  await page.goto('/')
  await expect(page.locator('.task-card')).toHaveCount(2)
  const fixture: Snapshot = await page.evaluate(async () => (await (await fetch('/__observer', {
    method: 'POST', body: JSON.stringify({ method: 'snapshot', params: {} }),
  })).json()).result)
  await page.unroute('**/__observer')
  let sequence = 0
  let held: Route | undefined
  let old: Snapshot | undefined
  await page.route('**/__observer', async route => {
    const value = structuredClone(fixture)
    sequence++
    value.revision = sequence + 1
    value.tasks[0].snapshot.metrics[0].value = sequence === 1 ? 11111 : 22222
    if (sequence === 1) { held = route; old = value; return }
    if (sequence === 3) { value.collector_generation = 2; value.revision = 0; value.tasks[0].snapshot.metrics[0].value = 33333 }
    if (sequence === 4) { value.revision = 999; value.tasks[0].snapshot.metrics[0].value = 44444 }
    await route.fulfill({ json: { result: value } })
  })
  const refresh = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await refresh()
  await expect.poll(() => sequence).toBe(1)
  await refresh()
  await expect(page.locator('.task-card').first()).toContainText('22,222')
  await held!.fulfill({ json: { result: old } })
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page.locator('.task-card').first()).toContainText('22,222')
  await refresh()
  await expect(page.locator('.task-card').first()).toContainText('33,333')
  const response = page.waitForResponse('**/__observer')
  await refresh()
  await response
  await expect(page.locator('.task-card').first()).not.toContainText('44,444')
  await expect(page.locator('.task-card').first()).toContainText('33,333')
})

test('check times are absolute and native resume refreshes the active detail tab', async ({ page }) => {
  await page.clock.install()
  await mockCollector(page)
  let reads = 0
  page.on('request', request => { if (request.url().endsWith('/__observer') && request.postDataJSON().method === 'logs') reads++ })
  await page.goto('/')
  const check = page.locator('.check-cadence').first()
  await expect(check).toContainText('检查完成')
  await expect(check).not.toContainText('秒前')
  await expect(check).toContainText(/\d{4}\/\d{1,2}\/\d{1,2}/)
  await page.clock.fastForward(120000)
  await expect(check).not.toContainText('秒前')
  await page.getByRole('link', { name: '查看 Grok 抓取 详情' }).click()
  await page.getByRole('tab', { name: '运行日志' }).click()
  await expect(page.locator('.log-content')).toBeVisible()
  const before = reads
  await page.evaluate(() => window.dispatchEvent(new Event('observer-resumed')))
  await expect.poll(() => reads).toBe(before + 1)
})
