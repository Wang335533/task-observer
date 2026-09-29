import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
const KEY = 'observer-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

// Storage can be unavailable in private or restricted WebViews; the system theme is the fallback.
export function readTheme(): ThemePreference {
  try { const value = localStorage.getItem(KEY); return value === 'light' || value === 'dark' ? value : 'system' } catch { return 'system' }
}

export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement
  if (preference === 'system') root.removeAttribute('data-theme')
  else root.dataset.theme = preference
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readTheme)
  const [systemDark, setSystemDark] = useState(() => media().matches)
  useEffect(() => {
    const query = media()
    const change = () => setSystemDark(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    applyTheme(preference)
    try { if (preference === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, preference) } catch { /* Preference lasts for this session only. */ }
  }, [preference])
  return { preference, setPreference, dark: preference === 'dark' || (preference === 'system' && systemDark) }
}
