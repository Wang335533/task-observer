import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SearchX, WifiOff } from 'lucide-react'
import { Button } from './components/ui/button'
import { Empty } from './components/common'
import { Sidebar } from './components/layout/Sidebar'
import { Topbar } from './components/layout/Topbar'
import { TaskForm } from './components/TaskForm'
import { Overview, type Filter, type View } from './pages/Overview'
import { TaskDetail } from './pages/TaskDetail'
import { HistoryPage } from './pages/HistoryPage'
import { AlertsPage } from './pages/AlertsPage'
import { SettingsPage } from './pages/SettingsPage'
import { autostart, REFRESH_MS, rpc, subscribeSnapshot } from './lib/bridge'
import type { Alert, Run, Snapshot, TaskConfig } from './lib/types'
import { snapshotGate } from './lib/snapshots'
import { useTheme } from './lib/theme'
import { usePersistentState } from './lib/persist'

const titles: Record<string, string> = { '/': '任务总览', '/history': '运行历史', '/alerts': '提醒', '/settings': '设置' }

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [route, setRoute] = useState(window.location.hash.slice(1) || '/')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = usePersistentState<View>('observer-view', 'grid', ['grid', 'list'])
  const [form, setForm] = useState<TaskConfig | 'new' | null>(null)
  const [history, setHistory] = useState<Run[]>([])
  const [auto, setAuto] = useState(false)
  const [actionError, setActionError] = useState('')
  const theme = useTheme()
  const scroll = useRef(0)
  const active = useRef(true)
  const gate = useRef(snapshotGate())
  const accept = useCallback((snapshot: Snapshot) => { if (active.current && gate.current(snapshot)) { setData(snapshot); setError('') } }, [])
  const refresh = useCallback(async () => { try { accept(await rpc<Snapshot>('snapshot')) } catch (e) { if (active.current) setError(String(e)) } }, [accept])
  useEffect(() => {
    active.current = true
    let disposed = false
    let unsubscribe: (() => void) | undefined
    // Subscribe before the initial read so startup results cannot fall between them.
    void subscribeSnapshot(snapshot => { if (!disposed) accept(snapshot) }, () => void refresh())
      .then(stop => { if (disposed) stop(); else { unsubscribe = stop; void refresh() } })
      .catch(() => { if (!disposed) void refresh() })
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, REFRESH_MS)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { disposed = true; active.current = false; unsubscribe?.(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [refresh, accept])
  useEffect(() => { const handler = () => setRoute(window.location.hash.slice(1) || '/'); window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler) }, [])
  useLayoutEffect(() => { window.scrollTo(0, route === '/' ? scroll.current : 0) }, [route])
  useEffect(() => { if (route === '/history') void rpc<Run[]>('history').then(setHistory).catch(e => setActionError(String(e))); if (route === '/settings') void autostart().then(setAuto).catch(e => setActionError(String(e))) }, [route, data?.last_scan])

  const go = (path: string) => { if (route === '/') scroll.current = window.scrollY; setActionError(''); window.location.hash = path }
  const tasks = data?.tasks || []
  const names = Object.fromEntries(tasks.map(t => [t.config.id, t.config.name]))
  const task = route.startsWith('/task/') ? tasks.find(t => t.config.id === route.split('/')[2]) : null
  const unread = (data?.alerts || []).filter(a => !a.acknowledged && !a.resolved).length
  const offline = !!(error || data?.scan_error)
  const navigateTask = (id: string) => go(`/task/${id}`)
  const ack = async (alert: Alert) => { try { await rpc('acknowledge', { id: alert.id }); await refresh() } catch (e) { setActionError(String(e)) } }

  return <div className="app-shell">
    <Sidebar route={route} go={go} tasks={tasks} unread={unread} observer={data?.observer} />
    <div className="main-shell">
      <Topbar title={task ? task.config.name : titles[route] || '任务详情'} offline={offline} lastScan={data?.last_scan} unread={unread} go={go} refresh={refresh}
        dark={theme.dark} toggleTheme={() => theme.setPreference(theme.dark ? 'light' : 'dark')} />
      <main>
        {offline && <div className="connection-error" role="alert">
          <WifiOff size={19} />
          <div><strong>暂时无法更新监控数据</strong><p>{error || data?.scan_error}</p><small>保留上次读数；这不表示业务任务已经失败。</small></div>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>重新检查</Button>
        </div>}
        {actionError && <p className="error-message" role="alert">{actionError}</p>}
        {route === '/' && <Overview data={data} error={error} tasks={tasks} names={names} filter={filter} setFilter={setFilter} search={search} setSearch={setSearch}
          view={view} setView={setView} open={navigateTask} go={go} onAdd={() => setForm('new')} />}
        {route.startsWith('/task/') && (task
          ? <TaskDetail key={task.config.id} task={task} back={() => go('/')} edit={() => setForm(task.config)} names={names} />
          : <section className="panel"><Empty icon={SearchX} title="正在查找任务" text="如果任务不存在，请返回总览检查关注清单。" /></section>)}
        {route === '/history' && <HistoryPage runs={history} names={names} />}
        {route === '/alerts' && <AlertsPage alerts={data?.alerts || []} names={names} open={navigateTask} ack={ack} />}
        {route === '/settings' && <SettingsPage data={data} auto={auto} setAuto={setAuto} theme={theme.preference} setTheme={theme.setPreference} refresh={refresh} fail={setActionError} />}
      </main>
    </div>
    {form && <TaskForm key={form === 'new' ? 'new' : form.id} initial={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await refresh() }} />}
  </div>
}
