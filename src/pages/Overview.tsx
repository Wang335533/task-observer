import { Activity, ArrowRight, Bell, ChevronRight, LayoutGrid, List, LoaderCircle, Plus, Radar, Search, Sparkles, TriangleAlert, WifiOff, X, type LucideIcon } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Empty, PanelHeader, PageHeader } from '../components/common'
import { TaskCard } from '../components/TaskCard'
import { TaskTable } from '../components/TaskTable'
import type { Snapshot, Task } from '../lib/types'
import type { Tone } from '../lib/task'
import { date, relative } from '../lib/utils'

export type Filter = 'all' | 'running' | 'attention'
export type View = 'grid' | 'list'

function Kpi({ icon: Icon, label, value, tone, note, action }: { icon: LucideIcon; label: string; value: number; tone?: Tone; note?: string; action?: { label: string; onClick: () => void } }) {
  return <div className="kpi">
    <span className="kpi-label"><Icon size={15} />{label}</span>
    <strong className={tone && value ? `tone-text-${tone}` : ''}>{value}</strong>
    {action ? <button className="kpi-link" onClick={action.onClick}>{action.label}<ArrowRight size={13} /></button> : <span className="kpi-note">{note}</span>}
  </div>
}

export function Overview({ data, error, tasks, names, filter, setFilter, search, setSearch, view, setView, open, go, onAdd }: {
  data: Snapshot | null; error: string; tasks: Task[]; names: Record<string, string>
  filter: Filter; setFilter: (filter: Filter) => void; search: string; setSearch: (search: string) => void
  view: View; setView: (view: View) => void; open: (id: string) => void; go: (path: string) => void; onAdd: () => void
}) {
  const running = tasks.filter(t => t.view.run_state === 'running').length
  const online = tasks.filter(t => t.view.run_state === 'service_online').length
  const attention = tasks.filter(t => t.view.health !== 'ok').length
  const unread = (data?.alerts || []).filter(a => !a.acknowledged && !a.resolved).length
  const filtered = tasks.filter(t => (filter === 'all' || (filter === 'attention' ? t.view.health !== 'ok' : t.view.run_state === filter)) && `${t.config.name} ${t.config.description}`.toLowerCase().includes(search.toLowerCase()))
  const filters: [Filter, string, number][] = [['all', '全部任务', tasks.length], ['running', '运行中', running], ['attention', '需关注', attention]]
  const events = data?.events || []

  return <>
    <PageHeader title="任务总览" count={tasks.length} description="关注业务进展，让每一项运行都有迹可循。" actions={<Button onClick={onAdd}><Plus size={17} />添加关注任务</Button>} />

    <section className="kpi-strip" aria-label="任务概况">
      <Kpi icon={LayoutGrid} label="关注任务" value={tasks.length} note="各任务独立每 5 分钟检查" />
      <Kpi icon={Activity} label="正在运行" value={running} tone="ok" note={online ? `另有 ${online} 个本地助手在线` : '按关联进程实时识别'} />
      <Kpi icon={TriangleAlert} label="需要关注" value={attention} tone="warn" note="全部任务状态正常" action={attention ? { label: '筛选查看', onClick: () => setFilter('attention') } : undefined} />
      <Kpi icon={Bell} label="未读提醒" value={unread} tone="warn" note="没有待处理的提醒" action={unread ? { label: '打开提醒', onClick: () => go('/alerts') } : undefined} />
    </section>

    <div className="section-toolbar">
      <div className="segmented" role="group" aria-label="任务筛选">
        {filters.map(([id, label, count]) => <button key={id} aria-label={label} aria-pressed={filter === id} className={filter === id ? 'selected' : ''} onClick={() => setFilter(id)}>{label}<span className="count">{count}</span></button>)}
      </div>
      <div className="toolbar-controls">
        <div className="search">
          <Search size={15} />
          <input aria-label="搜索关注任务" placeholder="搜索任务名称或说明" value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button className="search-clear" aria-label="清除搜索" onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <div className="segmented icon-only" role="group" aria-label="显示方式">
          <button aria-label="卡片视图" title="卡片视图" aria-pressed={view === 'grid'} className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}><LayoutGrid size={16} /></button>
          <button aria-label="列表视图" title="列表视图" aria-pressed={view === 'list'} className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><List size={16} /></button>
        </div>
      </div>
    </div>

    {!data ? (error
      ? <section className="panel"><Empty icon={WifiOff} title="暂时无法读取任务" text="采集器恢复连接后会自动显示关注任务。" /></section>
      : <div className="loading"><LoaderCircle className="spin" size={18} />正在连接本地采集器…</div>)
      : !tasks.length ? <section className="panel"><Empty icon={Radar} title="还没有关注任务" text="登记一个脚本或 Python 模块入口，之后会自动识别它的运行并读取业务进度；不会启动或修改任务。"><Button onClick={onAdd}><Plus size={16} />添加第一个任务</Button></Empty></section>
      : !filtered.length ? <section className="panel"><Empty icon={Search} title="没有符合条件的任务" text="调整筛选条件或搜索关键词。"><Button variant="outline" size="sm" onClick={() => { setFilter('all'); setSearch('') }}>清除筛选条件</Button></Empty></section>
      : view === 'grid' ? <div className="task-grid">{filtered.map(t => <TaskCard key={t.config.id} task={t} open={open} />)}</div>
      : <TaskTable tasks={filtered} open={open} />}

    <section className="panel activity-panel">
      <PanelHeader title="最近动态" meta="来自已关注任务" />
      {events.length ? <ol className="activity-list">{events.slice(0, 6).map(event => <li key={event.id}>
        <button onClick={() => open(event.task_id)}>
          <span className="event-dot" />
          <span className="event-task">{names[event.task_id] || event.task_id}</span>
          <span className="event-message">{event.message}</span>
          <time title={date(event.at)}>{relative(event.at)}</time>
          <ChevronRight size={14} />
        </button>
      </li>)}</ol> : <div className="activity-empty"><Sparkles size={16} /><span>新的运行与业务进展会出现在这里。</span></div>}
    </section>
  </>
}
