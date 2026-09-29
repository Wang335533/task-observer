import type { MouseEvent } from 'react'
import { Bell, History, LayoutGrid, Settings2, ShieldCheck, TriangleAlert } from 'lucide-react'
import pkg from '../../../package.json'
import type { Snapshot, Task } from '../../lib/types'
import { bytes, percentText, states } from '../../lib/utils'
import { runTone } from '../../lib/task'

const nav = [
  { path: '/', label: '任务总览', icon: LayoutGrid },
  { path: '/history', label: '运行历史', icon: History },
  { path: '/alerts', label: '提醒', icon: Bell },
  { path: '/settings', label: '设置', icon: Settings2 },
]

export function Sidebar({ route, go, tasks, unread, observer }: { route: string; go: (path: string) => void; tasks: Task[]; unread: number; observer?: Snapshot['observer'] }) {
  const link = (path: string) => ({ href: `#${path}`, onClick: (e: MouseEvent) => { e.preventDefault(); go(path) } })
  return <aside className="sidebar">
    <a className="brand" {...link('/')}>
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span className="brand-text"><strong>任务观测台</strong><small>Local Observer</small></span>
    </a>
    <nav className="nav" aria-label="主导航">
      {nav.map(item => {
        const active = route === item.path || (item.path === '/' && route.startsWith('/task/'))
        return <a key={item.path} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} title={item.label}
          aria-label={item.path === '/alerts' && unread > 0 ? `提醒，${unread} 条未读` : item.label} {...link(item.path)}>
          <item.icon size={18} /><span className="nav-label">{item.label}</span>
          {item.path === '/alerts' && unread > 0 && <b className="nav-badge">{unread}</b>}
        </a>
      })}
    </nav>
    {tasks.length > 0 && <div className="nav-group">
      <span className="nav-caption">关注任务</span>
      <div className="nav-tasks">
        {tasks.map(t => <a key={t.config.id} className={route === `/task/${t.config.id}` ? 'active' : ''} title={`${t.config.name} · ${states[t.view.run_state] || t.view.run_state}`} {...link(`/task/${t.config.id}`)}>
          <span className={`status-dot tone-${runTone(t.view.run_state)}${t.view.run_state === 'running' ? ' live' : ''}`} />
          <span className="nav-label">{t.config.name}</span>
          {t.view.health !== 'ok' && <TriangleAlert size={13} className={`nav-warn ${t.view.health === 'error' ? 'danger' : ''}`} />}
        </a>)}
      </div>
    </div>}
    <div className="sidebar-foot">
      <div className="observer-usage" title="采集器自身的资源占用"><span>采集器</span><strong>{percentText(observer?.cpu_percent)} · {bytes(observer?.memory_bytes)}</strong></div>
      <p className="privacy"><ShieldCheck size={14} /><span>数据仅保存在本机</span></p>
      <span className="version">版本 {pkg.version}</span>
    </div>
  </aside>
}
