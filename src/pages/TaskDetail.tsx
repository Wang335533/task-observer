import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Activity, ArrowLeft, BookOpen, Cpu, FileText, Folder, History, LoaderCircle, RefreshCw, ShieldCheck, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Empty, PanelHeader } from '../components/common'
import { Progress, StatusBadge, StatusNotice, TaskIcon } from '../components/task'
import { RunTable } from '../components/RunTable'
import { REFRESH_MS, rpc } from '../lib/bridge'
import type { Run, Sample, Task } from '../lib/types'
import { bytes, date, duration, number, percentText } from '../lib/utils'
import { adapterLabels, checkStates, logTone, percent, runWindow, sourceLabel } from '../lib/task'

const Trend = lazy(() => import('../components/Trend'))
const tabs = [['overview', '进度概览', Activity], ['logs', '运行日志', FileText], ['resources', '资源趋势', Cpu], ['history', '运行历史', History]] as const
type Tab = typeof tabs[number][0]

export function TaskDetail({ task, back, edit, names }: { task: Task; back: () => void; edit: () => void; names: Record<string, string> }) {
  const [tab, setTab] = useState<Tab>('overview')
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
    window.addEventListener('observer-resumed', visible)
    return () => { ++requestGeneration.current; clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('observer-resumed', visible) }
  }, [refresh])

  const { config, snapshot, resource, view } = task
  const { start, end } = runWindow(task)
  const value = percent(task)
  const checks: [string, number | null | undefined][] = [['检查开始', task.check_started_at], ['检查结束', task.last_checked_at], ['最近成功', task.last_success_at], ['下次检查', task.next_check_at]]

  return <>
    <button className="back-link" onClick={back}><ArrowLeft size={15} />返回任务总览</button>
    <section className="detail-hero">
      <div className="hero-main">
        <TaskIcon adapter={config.adapter} size="lg" />
        <div className="hero-text">
          <div className="detail-title"><h1>{config.name}</h1><StatusBadge state={view.run_state} /></div>
          <p>{config.description || '本地业务任务'} · {resource.process_count || 0} 个关联进程</p>
        </div>
        <Button variant="outline" onClick={edit}><SlidersHorizontal size={16} />编辑关注规则</Button>
      </div>
      <dl className="hero-facts">
        <div><dt>本次运行</dt><dd>{duration(start, end)}</dd></div>
        <div title="按整机总算力归一化"><dt>CPU</dt><dd>{percentText(resource.cpu_percent)}</dd></div>
        <div title="关联进程工作集之和"><dt>内存</dt><dd>{bytes(resource.memory_bytes)}</dd></div>
        <div><dt>下次检查</dt><dd>{date(task.next_check_at)}</dd></div>
        <div><dt>进度来源</dt><dd>{adapterLabels[config.adapter] || config.adapter}</dd></div>
      </dl>
      <div className="detail-tabs" role="tablist" aria-label="任务详情">
        {tabs.map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setError(''); setTab(id) }}><Icon size={16} />{label}</button>)}
      </div>
    </section>
    {error && <div role="alert" className="error-message">{error}</div>}
    <div role="tabpanel">
      {tab === 'overview' && <>
        {snapshot.metrics.length > 0 && <div className="detail-metrics">
          {snapshot.metrics.map(m => <section className="panel detail-metric" key={m.key}>
            <span className="metric-label">{m.label}</span>
            <strong>{number(m.value)}{m.unit && <small>{m.unit}</small>}</strong>
            <span className="metric-foot">{snapshot.statistics_kind || '源统计'} {date(m.statistics_at === undefined ? snapshot.statistics_at : m.statistics_at)}{m.cached ? ' · 缓存' : ''}</span>
          </section>)}
        </div>}
        <div className="detail-columns">
          <div className="detail-stack">
            <section className="panel pad">
              <PanelHeader title="业务进展" meta={`来源：${sourceLabel(config.adapter)}`} />
              <div className="stage-focus">
                <span className="stage-mark"><Activity size={20} /></span>
                <div><span className="eyebrow">当前阶段</span><h2>{snapshot.stage}</h2>{snapshot.current && <p className="mono">{snapshot.current}</p>}</div>
              </div>
              {value != null && <Progress completed={snapshot.completed!} total={snapshot.total!} value={value} />}
              {snapshot.note && <p className="source-note"><BookOpen size={15} /><span>{snapshot.note}</span></p>}
              {snapshot.queues.length > 0 && <div className="queue-grid">
                {snapshot.queues.map(m => <div key={m.key}><span>{m.label}{m.cached ? ' · 缓存' : ''}{m.statistics_at !== undefined && <small>读取于 {date(m.statistics_at)}</small>}</span><strong>{number(m.value)}</strong></div>)}
              </div>}
            </section>
            <section className="panel pad">
              <PanelHeader title="任务接入信息"><Folder size={17} className="panel-icon" /></PanelHeader>
              <dl className="kv">
                <div><dt>项目位置</dt><dd className="mono">{config.project}</dd></div>
                <div><dt>识别入口</dt><dd className="mono">{config.entry}{config.subcommands.length ? ` · ${config.subcommands.join(' / ')}` : ''}</dd></div>
                {config.snapshot && <div><dt>进度文件</dt><dd className="mono">{config.snapshot}</dd></div>}
                <div><dt>任务标识</dt><dd className="mono">{config.id}</dd></div>
              </dl>
              {config.adapter === 'json' && <details className="schema-details">
                <summary>查看通用进度文件格式</summary>
                <p>由任务自身定期原子更新；以下仅为接入示例，不写入你的项目。</p>
                <pre className="schema-example">{JSON.stringify({ schema_version: 1, task_id: config.id, run_id: '每次运行的唯一标识', status: 'running', stage: '训练中', updated_at: 'ISO 8601 时间', completed: 12, total: 40, metrics: [{ key: 'loss', label: 'Loss', value: 0.284, unit: '' }] }, null, 2)}</pre>
              </details>}
            </section>
          </div>
          <section className="panel pad health-panel">
            <PanelHeader title="运行状况"><ShieldCheck size={17} className="panel-icon" /></PanelHeader>
            <StatusNotice task={task} />
            {view.issues.slice(1).map(i => <p className="issue-line" key={i.code}><TriangleAlert size={14} />{i.message}</p>)}
            <ol className="check-timeline" aria-label="检查记录">
              {checks.map(([label, at], index) => <li key={label} className={index === checks.length - 1 ? 'upcoming' : at ? 'done' : ''}><span>{label}</span><strong>{date(at)}</strong></li>)}
            </ol>
            <dl className="kv">
              <div><dt>检查结果</dt><dd>{checkStates[task.check_status || 'waiting']}</dd></div>
              <div><dt>本次耗时</dt><dd>{number(task.read_duration)} 秒</dd></div>
              <div><dt>{snapshot.statistics_kind || '源统计'}</dt><dd>{date(snapshot.statistics_at)}</dd></div>
              <div><dt>任务进程</dt><dd>{resource.roots.length ? resource.roots.map(r => r.pid).join('、') : '当前未识别到'}</dd></div>
            </dl>
            <small className="footnote">CPU 按整机总算力归一化；内存为关联进程工作集之和。</small>
          </section>
        </div>
      </>}
      {tab === 'logs' && <section className="panel log-panel">
        <PanelHeader title="最近日志" meta={<span className="log-path">{logs?.path || '按需读取，不复制完整日志'}</span>}>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>{loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}刷新</Button>
        </PanelHeader>
        {logs?.lines.length
          ? <pre className="log-content">{logs.lines.map((line, index) => <span key={index} className={`log-line ${logTone(line)}`}>{line}</span>)}</pre>
          : <Empty icon={FileText} title={loading ? '正在读取日志' : '暂无可显示的日志'} text={logs?.message || '仅读取最近 200 行，最多 128 KB。'} />}
        <div className="panel-foot">每 5 分钟刷新 · 最多展示最近 200 行 · 常见凭据字段自动隐藏</div>
      </section>}
      {tab === 'resources' && <Suspense fallback={<div className="loading"><LoaderCircle className="spin" size={18} />正在加载资源图表…</div>}>
        <div className="charts">
          <Trend samples={detail.samples} field="cpu" title="CPU 使用率" unit="%" />
          <Trend samples={detail.samples} field="memory" title="内存工作集" unit="MB" />
        </div>
        <p className="footnote">仅汇总此任务及其子进程。GPU 指标可由任务的通用状态文件提供，不将整机 GPU 使用率误标成单任务使用率。</p>
      </Suspense>}
      {tab === 'history' && <section className="panel">
        <PanelHeader title="本任务运行历史" meta="仅记录实际观察到的运行" />
        <RunTable runs={detail.history} names={names} />
      </section>}
    </div>
  </>
}
