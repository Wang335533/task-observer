import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Snapshot } from './types'
export const REFRESH_MS = 300_000
export const isDesktop = '__TAURI_INTERNALS__' in window
// Results from a scheduled scan arrive immediately, without starting another scan.
export async function subscribeSnapshot(update: (snapshot: Snapshot) => void, refresh: () => void) {
  if (isDesktop) {
    const stopSnapshot = await listen<Snapshot>('observer-snapshot', event => update(event.payload))
    const stopVisible = await listen('observer-visible', refresh)
    return () => { stopSnapshot(); stopVisible() }
  }
  const handler = (snapshot: Snapshot) => update(snapshot)
  import.meta.hot?.on('observer:snapshot', handler)
  return () => { import.meta.hot?.off('observer:snapshot', handler) }
}
export async function rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (isDesktop) return invoke<T>('collector_request', { method, params })
  const response = await fetch('/__observer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params }) })
  const data = await response.json()
  if (data.error) throw new Error(data.error)
  return data.result as T
}
export async function autostart(enabled?: boolean) {
  if (!isDesktop) return false
  const plugin = await import('@tauri-apps/plugin-autostart')
  if (enabled === true) await plugin.enable()
  if (enabled === false) await plugin.disable()
  return plugin.isEnabled()
}
