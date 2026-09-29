import type { Task } from '../lib/types'
import { bytes, number, percentText } from '../lib/utils'
import { StatusBadge, TaskIcon } from './task'
import { checkSummary } from './TaskCard'

// Dense list layout for many tasks; the whole row opens the task and the name stays a real link for keyboards.
export function TaskTable({ tasks, open }: { tasks: Task[]; open: (id: string) => void }) {
  return <section className="panel">
    <div className="table-wrap">
      <table className="data-table task-table">
        <thead><tr><th>任务</th><th>状态</th><th>当前阶段</th><th>主要指标</th><th className="num">CPU</th><th className="num">内存</th><th>最近检查</th></tr></thead>
        <tbody>{tasks.map(task => {
          const { config, snapshot, resource, view } = task
          return <tr key={config.id} data-health={view.health} onClick={() => open(config.id)}>
            <td>
              <a className="task-cell" href={`#/task/${config.id}`} aria-label={`查看 ${config.name} 详情`} onClick={e => { e.preventDefault(); e.stopPropagation(); open(config.id) }}>
                <TaskIcon adapter={config.adapter} size="sm" />
                <span><strong>{config.name}</strong><small>{config.description || '已关注的本地任务'}</small></span>
              </a>
            </td>
            <td><StatusBadge state={view.run_state} /></td>
            <td className="stage-cell">{snapshot.stage}</td>
            <td><span className="metric-inline">{snapshot.metrics.slice(0, 2).map(m => <span key={m.key}><small>{m.label}</small>{number(m.value)}{m.unit}</span>)}</span></td>
            <td className="num">{percentText(resource.cpu_percent)}</td>
            <td className="num">{bytes(resource.memory_bytes)}</td>
            <td className="muted-cell">{checkSummary(task)}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
  </section>
}
