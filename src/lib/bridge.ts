import { invoke } from '@tauri-apps/api/core'
export const isDesktop = '__TAURI_INTERNALS__' in window
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
