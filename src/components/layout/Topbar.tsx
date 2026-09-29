import { useState } from 'react'
import { Bell, ChevronRight, Moon, RefreshCw, Sun } from 'lucide-react'
import { clock, date } from '../../lib/utils'

export function Topbar({ title, offline, lastScan, unread, go, refresh, dark, toggleTheme }: {
  title: string; offline: boolean; lastScan?: number | null; unread: number; go: (path: string) => void
  refresh: () => Promise<void>; dark: boolean; toggleTheme: () => void
}) {
  const [busy, setBusy] = useState(false)
  const reload = async () => { setBusy(true); try { await refresh() } finally { setBusy(false) } }
  return <header className="topbar">
    <div className="breadcrumb"><span>工作空间</span><ChevronRight size={14} /><span className="current">{title}</span></div>
    <div className="topbar-actions">
      <span className={`connection ${offline ? 'offline' : lastScan ? 'online' : ''}`} title={lastScan ? `最近资源检查：${date(lastScan)}` : undefined}>
        <span className="status-dot" />{offline ? '采集连接异常' : lastScan ? '本地采集已连接' : '正在连接'}
        {!offline && lastScan && <time>{clock(lastScan)}</time>}
      </span>
      <span className="topbar-divider" />
      <button className="icon-button" aria-label="重新读取监控数据" title="读取采集器已有的最新结果，不会额外启动检查" disabled={busy} onClick={() => void reload()}>
        <RefreshCw size={17} className={busy ? 'spin' : ''} />
      </button>
      <button className="icon-button" aria-label={dark ? '切换到浅色主题' : '切换到深色主题'} title={dark ? '浅色主题' : '深色主题'} onClick={toggleTheme}>
        {dark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      <button className="icon-button" aria-label="查看提醒" onClick={() => go('/alerts')}><Bell size={17} />{unread > 0 && <i className="icon-dot" />}</button>
    </div>
  </header>
}
