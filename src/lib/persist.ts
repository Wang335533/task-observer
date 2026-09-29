import { useEffect, useState } from 'react'

// Per-window view preferences; storage can be unavailable in restricted WebViews, so defaults always work.
export function usePersistentState<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try { const stored = localStorage.getItem(key) as T | null; return stored && allowed.includes(stored) ? stored : initial } catch { return initial }
  })
  useEffect(() => { try { localStorage.setItem(key, value) } catch { /* Not persisted. */ } }, [key, value])
  return [value, setValue] as const
}
