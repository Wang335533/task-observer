import { Clock3, Cpu, Database, MemoryStick, Timer } from 'lucide-react'
import type { Task } from '../lib/types'
import { bytes, date, duration, number, percentText } from '../lib/utils'
import { checkStates, percent, runWindow } from '../lib/task'
import { Progress, StatusBadge, StatusNotice, TaskIcon } from './task'

export function checkSummary(task: Task) {
  return task.checking ? '正在检查进度…' : task.last_checked_at ? `${checkStates[task.check_status || 'success']} ${date(task.last_checked_at)}` : '等待首次检查'
}

export function statisticsSummary(task: Task) {
  const { statistics_at, statistics_kind, cached } = task.snapshot
  return `${statistics_at ? `${statistics_kind || '源统计'} ${date(statistics_at)}` : '暂无业务统计'}${cached ? ' · 含缓存' : ''}`
}

export function TaskCard({ task, open }: { task: Task; open: (id: string) => void }) {
  const { config, snapshot, resource, view } = task
  const metrics = snapshot.metrics.slice(0, 2)
  const { start, end } = runWindow(task)
  const value = percent(task)
  return <a className="task-card" data-health={view.health} href={`#/task/${config.id}`} onClick={e => { e.preventDefault(); open(config.id) }} aria-label={`查看 ${config.name} 详情`}>
    <div className="card-body">
      <div className="card-head">
        <TaskIcon adapter={config.adapter} />
        <div className="card-title"><h2>{config.name}</h2><p>{config.description || '已关注的本地任务'}</p></div>
        <StatusBadge state={view.run_state} />
      </div>
      <div className="card-metrics">
        {(metrics.length ? metrics : [{ key: 'unavailable', label: '业务进度', value: null, unit: '' }]).map(m =>
          <div className="metric" key={m.key}><span>{m.label}</span><strong>{number(m.value)}{m.unit && <small>{m.unit}</small>}</strong></div>)}
      </div>
      {value != null && <Progress completed={snapshot.completed!} total={snapshot.total!} value={value} label="已完成" />}
      <div className="card-stage"><span>当前阶段</span><strong>{snapshot.stage}</strong></div>
      <StatusNotice task={task} />
      <div className="card-meta">
        <span className="freshness"><Database size={13} /><span>{statisticsSummary(task)}</span></span>
        <span className="check-cadence" title={`开始：${date(task.check_started_at)}；最近成功：${date(task.last_success_at)}；下次检查：${date(task.next_check_at)}`}>
          <Clock3 size={13} /><span>{checkSummary(task)}<small>每 5 分钟检查 · 单次限时 30 秒</small></span>
        </span>
      </div>
    </div>
    <div className="card-foot">
      <span title="CPU（按整机归一化）"><Cpu size={14} />{percentText(resource.cpu_percent)}</span>
      <span title="内存工作集"><MemoryStick size={14} />{bytes(resource.memory_bytes)}</span>
      <span title="本次运行时长"><Timer size={14} />{duration(start, end)}</span>
    </div>
  </a>
}
