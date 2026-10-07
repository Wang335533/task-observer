import { Activity, BookOpen, FileText, Link2, MessageSquare, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { Task, TaskConfig } from '../lib/types'
import { number, states } from '../lib/utils'
import { runTone } from '../lib/task'

const glyphs = { kokusho: BookOpen, ssrn: FileText, cnki: FileText, msqa: MessageSquare, tieba: MessageSquare, guba: MessageSquare, grok: Link2, json: Activity, process: Activity }

export function TaskIcon({ adapter, size = 'md' }: { adapter: TaskConfig['adapter']; size?: 'sm' | 'md' | 'lg' }) {
  const Glyph = glyphs[adapter] || Activity
  return <span className={`task-icon ${size} ${adapter}`} aria-hidden="true"><Glyph size={size === 'lg' ? 26 : size === 'sm' ? 16 : 20} /></span>
}

export function StatusBadge({ state, outcome }: { state: string; outcome?: boolean }) {
  return <span className={`badge tone-${runTone(state, outcome)}`}><span className={`status-dot${state === 'running' ? ' live' : ''}`} />{states[state] || state}</span>
}

export function StatusNotice({ task }: { task: Task }) {
  const issue = task.view.issues[0]
  if (issue) return <div className={`notice ${issue.level === 'error' ? 'danger' : 'warn'}`}><TriangleAlert size={15} /><span>{issue.message}</span></div>
  const text = task.view.run_state === 'service_online' ? '本地助手在线，下载活动见当前阶段' : task.view.cooldown ? '正在等待冷却结束' : task.view.run_state === 'running' ? '任务正在运行' : '继续按原来的方式运行任务即可'
  return <div className="notice quiet"><ShieldCheck size={15} /><span>{text}</span></div>
}

export function Progress({ completed, total, value, label }: { completed: number; total: number; value: number; label?: string }) {
  return <div className="progress-block">
    <div className="progress-label"><span>{label ? `${label} ` : ''}{number(completed)} / {number(total)}</span><strong>{value}%</strong></div>
    <progress max={total} value={completed} />
  </div>
}
