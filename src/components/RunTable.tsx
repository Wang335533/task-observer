import { History } from 'lucide-react'
import type { Run } from '../lib/types'
import { date, duration } from '../lib/utils'
import { Empty } from './common'
import { StatusBadge } from './task'

export function RunTable({ runs, names }: { runs: Run[]; names: Record<string, string> }) {
  if (!runs.length) return <Empty icon={History} title="还没有运行记录" text="应用开始监控后，会自动记录关注任务的运行与结束。" />
  return <div className="table-wrap">
    <table className="data-table">
      <thead><tr><th>任务</th><th>开始时间</th><th>时长</th><th>运行结果</th></tr></thead>
      <tbody>{runs.map(run => <tr key={run.id}>
        <td><strong>{names[run.task_id] || run.task_id}</strong><small className="run-id">{run.id.split(':').slice(1).join(':')}</small></td>
        <td>{date(run.started)}</td>
        <td>{run.ended || run.status === 'running' ? duration(run.started, run.ended || undefined) : '—'}</td>
        <td><StatusBadge state={run.status} outcome /></td>
      </tr>)}</tbody>
    </table>
  </div>
}
