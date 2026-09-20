import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowLeft, ArrowRight, Bell, BookOpen, Check, ChevronRight, Clock3, Cpu, Database, FileText, Folder, History, LayoutGrid, Link2, LoaderCircle, MemoryStick, MessageSquare, Plus, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, TriangleAlert, WifiOff } from 'lucide-react'
import { Button } from './components/ui/button'
import { TaskForm } from './components/TaskForm'
import { autostart, isDesktop, REFRESH_MS, rpc, subscribeSnapshot } from './lib/bridge'
import type { Alert, Run, Sample, Snapshot, Task, TaskConfig } from './lib/types'
import { bytes, date, duration, number, relative, states } from './lib/utils'

function TaskIcon({ adapter, size = 23 }: { adapter: string; size?: number }) { return adapter === 'kokusho' ? <BookOpen size={size} /> : adapter === 'ssrn' || adapter === 'cnki' ? <FileText size={size} /> : adapter === 'msqa' ? <MessageSquare size={size} /> : adapter === 'grok' ? <Link2 size={size} /> : adapter === 'tieba' ? <MessageSquare size={size} /> : <Activity size={size} /> }
function Badge({ task }: { task: Task }) { const running = task.view.run_state === 'running'; return <span className={`badge ${running ? 'green' : task.view.run_state === 'failed' ? 'red' : 'neutral'}`}><span className="status-dot" />{states[task.view.run_state] || task.view.run_state}</span> }
function Empty({ title, text }: { title: string; text: string }) { return <div className="empty"><Database size={27} /><strong>{title}</strong><p>{text}</p></div> }
function StatusNotice({ task }: { task: Task }) {
  const issue = task.view.issues[0]
  return issue ? <div className={`task-notice ${issue.level === 'error' ? 'error' : ''}`}><TriangleAlert size={15} /><span>{issue.message}</span></div> : <div className="task-notice quiet"><ShieldCheck size={15} /><span>{task.view.run_state === 'service_online' ? '本地助手在线，下载活动见当前阶段' : task.view.cooldown ? '正在等待冷却结束' : task.view.run_state === 'running' ? '任务正在运行' : '继续按原来的方式运行任务即可'}</span></div>
}

function TaskCard({ task, open }: { task: Task; open: (id: string) => void }) {
  const metrics = task.snapshot.metrics.slice(0, 2)
  const running = task.resource.roots.length > 0
  const start = running ? Math.min(...task.resource.roots.map(r => r.created_at)) : task.snapshot.started_at
  return <a className="task-card" href={`#/task/${task.config.id}`} onClick={e => { e.preventDefault(); open(task.config.id) }} aria-label={`查看 ${task.config.name} 详情`}>
    <div className="card-heading"><div className={`task-icon ${task.config.adapter}`}><TaskIcon adapter={task.config.adapter} /></div><Badge task={task} /></div>
    <h2>{task.config.name}</h2><p className="card-description">{task.config.description || '已关注的本地任务'}</p>
    <div className="metric-pair">{(metrics.length ? metrics : [{ key: 'unavailable', label: '业务进度', value: null, unit: '' }]).map(m => <div className="metric" key={m.key}><span>{m.label}</span><strong>{number(m.value)}<small>{m.unit}</small></strong></div>)}</div>
    {task.snapshot.total != null && task.snapshot.completed != null && <div className="progress-block"><div><span>已完成 {number(task.snapshot.completed)} / {number(task.snapshot.total)}</span><strong>{Math.round(task.snapshot.completed / task.snapshot.total * 100)}%</strong></div><progress max={task.snapshot.total} value={task.snapshot.completed} /></div>}
    <div className="card-stage"><span className="eyebrow">当前阶段</span><span>{task.snapshot.stage}</span></div>
    <StatusNotice task={task} />
    <div className="freshness" title={`上次进度检查：${date(task.last_checked_at)}；检查间隔 ${task.config.interval} 秒，另加读取耗时`}><Clock3 size={13} /><span>{task.snapshot.statistics_at ? `统计 ${relative(task.snapshot.statistics_at)}更新` : '暂无业务统计'}{task.snapshot.cached ? ' · 缓存值' : ''}</span></div><div className="check-cadence">{task.checking ? '正在检查进度…' : task.last_checked_at ? `检查于 ${relative(task.last_checked_at)}` : '等待首次检查'} · 每 5 分钟检查</div>
    <div className="card-resources"><span><Cpu size={14} />{number(task.resource.cpu_percent)}%</span><span><MemoryStick size={14} />{bytes(task.resource.memory_bytes)}</span><span title="本次运行时长"><Clock3 size={14} />{duration(start, running ? undefined : task.snapshot.finished_at || undefined)}</span></div>
    <div className="card-bottom"><span>查看详情</span><ArrowRight size={17} /></div>
  </a>
}

function HistoryTable({ runs, names }: { runs: Run[]; names: Record<string, string> }) {
  if (!runs.length) return <Empty title="还没有运行记录" text="应用开始监控后，会自动记录关注任务的运行与结束。" />
  return <div className="table-wrap"><table><thead><tr><th>任务</th><th>开始时间</th><th>时长</th><th>运行结果</th></tr></thead><tbody>{runs.map(run => <tr key={run.id}><td><strong>{names[run.task_id] || run.task_id}</strong><small className="run-id">{run.id.split(':').slice(1).join(':')}</small></td><td>{date(run.started)}</td><td>{run.ended || run.status === 'running' ? duration(run.started, run.ended || undefined) : '—'}</td><td><span className={`badge ${run.status === 'running' || run.status === 'completed' ? 'green' : 'neutral'}`}>{states[run.status] || run.status}</span></td></tr>)}</tbody></table></div>
}

const Trend = lazy(() => import('./components/Trend'))

function Detail({ task, back, edit, names }: { task: Task; back: () => void; edit: () => void; names: Record<string, string> }) {
  const [tab, setTab] = useState('overview')
  const [detail, setDetail] = useState<{ samples: Sample[]; history: Run[] }>({ samples: [], history: [] })
  const [logs, setLogs] = useState<{ lines: string[]; path: string; message: string } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const requestGeneration = useRef(0)
  const refresh = useCallback(async () => {
    if (tab === 'overview') return
    const generation = ++requestGeneration.current
    setLoading(true)
    try {
      if (tab === 'logs') {
        const result = await rpc<{ lines: string[]; path: string; message: string }>('logs', { task_id: task.config.id })
        if (generation === requestGeneration.current) setLogs(result)
      } else {
        const result = await rpc<{ samples: Sample[]; history: Run[] }>('detail', { task_id: task.config.id, section: tab })
        if (generation === requestGeneration.current) setDetail(result)
      }
      if (generation === requestGeneration.current) setError('')
    } catch (e) { if (generation === requestGeneration.current) setError(String(e)) }
    finally { if (generation === requestGeneration.current) setLoading(false) }
  }, [task.config.id, tab])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, REFRESH_MS)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { ++requestGeneration.current; clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  return <>
    <button className="back-link" onClick={back}><ArrowLeft size={16} />返回任务总览</button>
    <header className="detail-heading"><div className={`task-icon large ${task.config.adapter}`}><TaskIcon adapter={task.config.adapter} size={28} /></div><div><div className="detail-title"><h1>{task.config.name}</h1><Badge task={task} /></div><p>{task.config.description || '本地业务任务'} · {task.resource.process_count || 0} 个关联进程</p></div><Button variant="outline" onClick={edit}><SlidersHorizontal size={16} />编辑关注规则</Button></header>
    <div className="detail-tabs" role="tablist" aria-label="任务详情">{[['overview', '进度概览', Activity], ['logs', '运行日志', FileText], ['resources', '资源趋势', Cpu], ['history', '运行历史', History]].map(([id, label, Icon]) => { const Glyph = Icon as typeof Activity; return <button key={id as string} role="tab" aria-selected={tab === id} onClick={() => { setError(''); setTab(id as string) }}><Glyph size={16} />{label as string}</button> })}</div>
    {error && <div role="alert" className="error-message">{error}</div>}
    <div role="tabpanel">
      {tab === 'overview' && <>
        <div className="detail-metrics">{task.snapshot.metrics.map(m => <section className="panel detail-metric" key={m.key}><span>{m.label}</span><strong>{number(m.value)}<small>{m.unit}</small></strong><span className="muted">{relative(task.snapshot.statistics_at)}更新</span></section>)}</div>
        <div className="detail-columns"><section className="panel progress-panel"><div className="panel-title"><h3>业务进展</h3><span>来源：{task.config.adapter === 'grok' ? '只读进度模块' : task.config.adapter === 'process' ? '进程信息' : task.config.adapter === 'ssrn' ? '本地助手只读接口' : task.config.adapter === 'cnki' ? '只读期次汇总' : task.config.adapter === 'kokusho' ? '清单与分片' : '状态快照'}</span></div><div className="stage-focus"><div className="stage-mark"><Activity size={21} /></div><div><span className="eyebrow">当前阶段</span><h2>{task.snapshot.stage}</h2>{task.snapshot.current && <p className="mono">{task.snapshot.current}</p>}</div></div>
          {task.snapshot.total != null && task.snapshot.completed != null && <div className="progress-block"><div><span>{number(task.snapshot.completed)} / {number(task.snapshot.total)}</span><strong>{Math.round(task.snapshot.completed / task.snapshot.total * 100)}%</strong></div><progress value={task.snapshot.completed} max={task.snapshot.total} /></div>}
          {task.snapshot.note && <p className="source-note"><BookOpen size={16} />{task.snapshot.note}</p>}
          <div className="queue-grid">{task.snapshot.queues.map(m => <div key={m.key}><span>{m.label}</span><strong>{number(m.value)}</strong></div>)}</div>
        </section><section className="panel health-panel"><div className="panel-title"><h3>运行状况</h3><ShieldCheck size={18} /></div><StatusNotice task={task} />{task.view.issues.slice(1).map(i => <p className="issue-line" key={i.code}><TriangleAlert size={14} />{i.message}</p>)}<dl><div><dt>进度检查</dt><dd>{date(task.last_checked_at)}</dd></div><div><dt>业务统计</dt><dd>{date(task.snapshot.statistics_at)}</dd></div><div><dt>任务进程</dt><dd>{task.resource.roots.length ? task.resource.roots.map(r => r.pid).join('、') : '当前未识别到'}</dd></div><div><dt>CPU</dt><dd>{number(task.resource.cpu_percent)}%</dd></div><div><dt>内存</dt><dd>{bytes(task.resource.memory_bytes)}</dd></div></dl><small className="muted">CPU 按整机总算力归一化；内存为关联进程工作集之和。</small></section></div>
        <section className="panel source-panel"><div className="panel-title"><h3>任务接入信息</h3><Folder size={18} /></div><dl><div><dt>项目位置</dt><dd>{task.config.project}</dd></div><div><dt>识别入口</dt><dd>{task.config.entry}{task.config.subcommands.length ? ` · ${task.config.subcommands.join(' / ')}` : ''}</dd></div>{task.config.snapshot && <div><dt>进度文件</dt><dd>{task.config.snapshot}</dd></div>}<div><dt>任务标识</dt><dd className="mono">{task.config.id}</dd></div></dl>
          {task.config.adapter === 'json' && <details><summary>查看通用进度文件格式</summary><p className="muted">由任务自身定期原子更新；以下仅为接入示例，不写入你的项目。</p><pre className="schema-example">{JSON.stringify({ schema_version: 1, task_id: task.config.id, run_id: '每次运行的唯一标识', status: 'running', stage: '训练中', updated_at: 'ISO 8601 时间', completed: 12, total: 40, metrics: [{ key: 'loss', label: 'Loss', value: 0.284, unit: '' }] }, null, 2)}</pre></details>}
        </section>
      </>}
      {tab === 'logs' && <section className="panel log-panel"><div className="panel-title"><div><h3>最近日志</h3><span className="log-path">{logs?.path || '按需读取，不复制完整日志'}</span></div><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>{loading && <LoaderCircle size={14} className="spin" />}刷新</Button></div>{logs?.lines.length ? <pre className="log-content">{logs.lines.join('\n')}</pre> : <Empty title={loading ? '正在读取日志' : '暂无可显示的日志'} text={logs?.message || '仅读取最近 200 行，最多 128 KB。'} />}<div className="panel-foot">每 5 分钟刷新 · 最多展示最近 200 行 · 常见凭据字段自动隐藏</div></section>}
      {tab === 'resources' && <Suspense fallback={<p className="muted">正在加载资源图表…</p>}><div className="charts"><Trend samples={detail.samples} field="cpu" title="CPU 使用率" unit="%" /><Trend samples={detail.samples} field="memory" title="内存工作集" unit="MB" /><p className="muted">仅汇总此任务及其子进程。GPU 指标可由任务的通用状态文件提供，不将整机 GPU 使用率误标成单任务使用率。</p></div></Suspense>}
      {tab === 'history' && <section className="panel"><div className="panel-title padded"><h3>本任务运行历史</h3><span>仅记录实际观察到的运行</span></div><HistoryTable runs={detail.history} names={names} /></section>}
    </div>
  </>
}

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [route, setRoute] = useState(window.location.hash.slice(1) || '/')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<TaskConfig | 'new' | null>(null)
  const [history, setHistory] = useState<Run[]>([])
  const [auto, setAuto] = useState(false)
  const [actionError, setActionError] = useState('')
  const scroll = useRef(0)
  const active = useRef(true)
  const refresh = useCallback(async () => { try { const result = await rpc<Snapshot>('snapshot'); if (active.current) { setData(result); setError('') } } catch (e) { if (active.current) setError(String(e)) } }, [])
  useEffect(() => {
    active.current = true
    let disposed = false
    let unsubscribe: (() => void) | undefined
    // Subscribe before the initial read so startup results cannot fall between them.
    void subscribeSnapshot(snapshot => { if (!disposed) { setData(snapshot); setError('') } }, () => void refresh())
      .then(stop => { if (disposed) stop(); else { unsubscribe = stop; void refresh() } })
      .catch(() => { if (!disposed) void refresh() })
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, REFRESH_MS)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { disposed = true; active.current = false; unsubscribe?.(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  useEffect(() => { const handler = () => setRoute(window.location.hash.slice(1) || '/'); window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler) }, [])
  useLayoutEffect(() => { window.scrollTo(0, route === '/' ? scroll.current : 0) }, [route])
  useEffect(() => { if (route === '/history') void rpc<Run[]>('history').then(setHistory).catch(e => setActionError(String(e))); if (route === '/settings') void autostart().then(setAuto).catch(e => setActionError(String(e))) }, [route, data?.last_scan])
  const go = (path: string) => { if (route === '/') scroll.current = window.scrollY; setActionError(''); window.location.hash = path }
  const tasks = data?.tasks || []
  const names = Object.fromEntries(tasks.map(t => [t.config.id, t.config.name]))
  const task = route.startsWith('/task/') ? tasks.find(t => t.config.id === route.split('/')[2]) : null
  const running = tasks.filter(t => t.view.run_state === 'running').length
  const attention = tasks.filter(t => t.view.health !== 'ok').length
  const unread = (data?.alerts || []).filter(a => !a.acknowledged && !a.resolved).length
  const filtered = tasks.filter(t => (filter === 'all' || (filter === 'attention' ? t.view.health !== 'ok' : t.view.run_state === filter)) && `${t.config.name} ${t.config.description}`.toLowerCase().includes(search.toLowerCase()))
  const navigateTask = (id: string) => go(`/task/${id}`)
  const ack = async (alert: Alert) => { try { await rpc('acknowledge', { id: alert.id }); await refresh() } catch (e) { setActionError(String(e)) } }
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="#/" onClick={e => { e.preventDefault(); go('/') }}><div className="brand-icon"><i /><i /><i /></div><div><strong>任务观测台</strong><span>LOCAL OBSERVER</span></div></a><div className="workspace"><span className="workspace-icon"><Folder size={16} /></span><div><strong>我的工作台</strong><small>本机 · 私有</small></div><span className="workspace-dot" /></div><span className="nav-caption">工作空间</span><nav>{[{ path: '/', label: '任务总览', icon: LayoutGrid }, { path: '/history', label: '运行历史', icon: History }, { path: '/alerts', label: '提醒', icon: Bell }, { path: '/settings', label: '设置', icon: Settings2 }].map(item => <a key={item.path} href={`#${item.path}`} className={(route === item.path || item.path === '/' && route.startsWith('/task/')) ? 'active' : ''} onClick={e => { e.preventDefault(); go(item.path) }}><item.icon size={18} /><span>{item.label}</span>{item.path === '/alerts' && unread > 0 && <b>{unread}</b>}</a>)}</nav><div className="sidebar-bottom"><ShieldCheck size={19} /><strong>数据留在本机</strong><p>只关注你指定的业务任务</p><span>版本 0.1.5</span></div></aside>
    <div className="main-shell"><div className="topbar"><div className="breadcrumb">工作空间<ChevronRight size={13} /><span>{task ? task.config.name : route === '/history' ? '运行历史' : route === '/alerts' ? '提醒' : route === '/settings' ? '设置' : '任务总览'}</span></div><div className="topbar-right"><span className={`connection ${error || data?.scan_error ? 'offline' : ''}`}><span className="status-dot" />{error || data?.scan_error ? '采集连接异常' : data?.last_scan ? '本地采集已连接' : '正在连接'}</span><button className="icon-button" aria-label="查看提醒" onClick={() => go('/alerts')}><Bell size={18} />{unread > 0 && <i />}</button></div></div>
    <main>
      {(error || data?.scan_error) && <div className="connection-error" role="alert"><WifiOff size={19} /><div><strong>暂时无法更新监控数据</strong><p>{error || data?.scan_error}</p><small>保留上次读数；这不表示业务任务已经失败。</small></div><Button variant="outline" size="sm" onClick={() => void refresh()}>重新检查</Button></div>}
      {actionError && <p className="error-message" role="alert">{actionError}</p>}
      {route === '/' && <>
        <header className="page-heading"><div><div className="eyebrow"><span className="tiny-line" />你的任务，一目了然</div><h1>任务总览<span className="title-count">{tasks.length}</span></h1><p>关注业务进展，让每一项运行都有迹可循。</p></div><Button onClick={() => setForm('new')}><Plus size={18} />添加关注任务</Button></header>
        <div className="summary-row"><div className="summary-box"><span className="summary-icon teal"><LayoutGrid size={20} /></span><div><span>关注任务</span><strong>{tasks.length}<small>个</small></strong></div></div><div className="summary-box"><span className="summary-icon mint"><Activity size={20} /></span><div><span>正在运行</span><strong>{running}<small>个</small></strong></div><span className="summary-trail"><span className="status-dot" />每 5 分钟检查</span></div><div className="summary-box"><span className="summary-icon amber"><TriangleAlert size={20} /></span><div><span>需要关注</span><strong>{attention}<small>个</small></strong></div><button className="text-button" onClick={() => setFilter('attention')}>查看<ArrowRight size={14} /></button></div></div>
        <div className="section-toolbar"><div className="filter-tabs" aria-label="任务筛选">{[['all', '全部任务'], ['running', '运行中'], ['attention', '需关注']].map(([id, label]) => <button key={id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}{id === 'all' && <span>{tasks.length}</span>}</button>)}</div><div className="toolbar-controls"><label className="search"><Search size={16} /><input aria-label="搜索关注任务" placeholder="搜索任务…" value={search} onChange={e => setSearch(e.target.value)} /></label><span className="view-indicator" title="卡片视图"><LayoutGrid size={17} /></span></div></div>
        {!data && !error ? <div className="loading"><LoaderCircle className="spin" />正在连接本地采集器…</div> : filtered.length ? <div className="task-grid">{filtered.map(t => <TaskCard key={t.config.id} task={t} open={navigateTask} />)}</div> : <section className="panel"><Empty title="没有符合条件的任务" text="调整筛选条件，或添加你希望关注的任务。" /></section>}
        <section className="panel activity-panel"><div className="panel-title"><div className="title-with-icon"><ArrowDownLeft size={18} /><h3>最近动态</h3></div><span>来自已关注任务</span></div>{data?.events.length ? <div className="activity-list">{data.events.slice(0, 6).map(event => <button key={event.id} onClick={() => navigateTask(event.task_id)}><span className="event-dot" /><span className="event-task">{names[event.task_id] || event.task_id}</span><span className="event-message">{event.message}</span><time title={date(event.at)}>{relative(event.at)}</time><ChevronRight size={14} /></button>)}</div> : <div className="activity-empty"><Sparkles size={18} /><span>新的运行与业务进展会出现在这里。</span></div>}</section>
        <div className="page-foot"><span><ShieldCheck size={13} />仅监控已指定的任务</span><span>最近检查：{relative(data?.last_scan)}</span></div>
      </>}
      {route.startsWith('/task/') && (task ? <Detail key={task.config.id} task={task} back={() => go('/')} edit={() => setForm(task.config)} names={names} /> : <Empty title="正在查找任务" text="如果任务不存在，请返回总览检查关注清单。" />)}
      {route === '/history' && <><header className="page-heading"><div><div className="eyebrow">每次运行，都有记录</div><h1>运行历史</h1><p>记录应用观察到的启动与结束；监控中断期间的结果保持未知。</p></div><History size={27} className="muted" /></header><section className="panel"><HistoryTable runs={history} names={names} /></section></>}
      {route === '/alerts' && <><header className="page-heading"><div><div className="eyebrow">把注意力留给重要的事</div><h1>提醒<span className="title-count">{unread}</span></h1><p>同一问题持续期间只提醒一次，恢复后再次发生才重新提醒。</p></div></header><section className="panel alerts-panel">{data?.alerts.length ? data.alerts.map(alert => <div className={`alert-row ${alert.resolved ? 'resolved' : ''}`} key={alert.id}><span className={`alert-icon ${alert.level}`}><TriangleAlert size={19} /></span><div><button className="alert-task" onClick={() => navigateTask(alert.task_id)}>{names[alert.task_id]}<ChevronRight size={13} /></button><p>{alert.message}</p><small>{date(alert.created)} · {alert.resolved ? '已恢复' : alert.acknowledged ? '已读 · 问题仍存在' : '待关注'}</small></div>{!alert.acknowledged && <Button variant="ghost" size="sm" onClick={() => void ack(alert)}><Check size={15} />标记已读</Button>}</div>) : <Empty title="目前没有提醒" text="任务异常、需要核查或采集信息过期时，会在这里显示。" />}</section></>}
      {route === '/settings' && <><header className="page-heading"><div><div className="eyebrow">按你的习惯工作</div><h1>设置</h1><p>轻量运行，专注于本地任务。</p></div></header><section className="panel settings-panel"><h3>运行与通知</h3><div className="setting-row"><div><strong>桌面异常提醒</strong><p>使用 Windows 通知；关闭后仍保留应用内提醒。</p></div><button className={`switch ${data?.settings.notifications ? 'on' : ''}`} role="switch" aria-label="桌面异常提醒" aria-checked={!!data?.settings.notifications} onClick={async () => { try { await rpc('set_notifications', { enabled: !data?.settings.notifications }); await refresh() } catch (e) { setActionError(String(e)) } }}><span /></button></div><div className="setting-row"><div><strong>开机自动启动</strong><p>{isDesktop ? '登录 Windows 后自动启动并留在托盘。' : '在桌面应用中可启用，浏览器预览不修改系统启动项。'}</p></div><button className={`switch ${auto ? 'on' : ''}`} role="switch" aria-label="开机自动启动" aria-checked={auto} disabled={!isDesktop} onClick={async () => { try { setAuto(await autostart(!auto)) } catch (e) { setActionError(String(e)) } }}><span /></button></div><div className="setting-row"><div><strong>关闭窗口后继续监控</strong><p>桌面应用关闭窗口时进入托盘；从托盘菜单选择“退出”才停止监控。</p></div><span className="badge green">已启用</span></div></section><section className="panel settings-panel"><h3>本地存储与采集</h3><dl><div><dt>应用数据位置</dt><dd>{data?.data_dir || '正在读取'}</dd></div><div><dt>进程资源采样</dt><dd>每 5 分钟 · 同步记录趋势</dd></div><div><dt>业务进度检查</dt><dd>全部任务每 5 分钟（另加读取耗时）</dd></div><div><dt>采集器 CPU</dt><dd>{number(data?.observer.cpu_percent)}%</dd></div><div><dt>采集器内存</dt><dd>{bytes(data?.observer.memory_bytes)}</dd></div></dl><p className="source-note"><ShieldCheck size={17} />本应用只读取任务状态。不会启动、停止或重跑业务任务，也不会上传数据。</p></section></>}
    </main></div>
    {form && <TaskForm key={form === 'new' ? 'new' : form.id} initial={form === 'new' ? undefined : form} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await refresh() }} />}
  </div>
}
