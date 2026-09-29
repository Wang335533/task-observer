import type { Task, TaskConfig } from './types'

export const checkStates: Record<string, string> = { checking: '正在检查', success: '检查完成', timeout: '检查超时', error: '检查异常', waiting: '等待首次检查' }

export const adapterLabels: Record<TaskConfig['adapter'], string> = {
  json: '通用 JSON 状态文件', process: '仅监控进程', tieba: '贴吧快照', grok: 'Grok 进度模块', msqa: 'Microsoft Q&A 快照',
  kokusho: '国书数据库分片', ssrn: 'SSRN PDF 本地助手', cnki: '知网期刊进度（只读）',
}

const sourceLabels: Partial<Record<TaskConfig['adapter'], string>> = { grok: '只读进度模块', process: '进程信息', ssrn: '本地助手只读接口', cnki: '只读期次汇总', kokusho: '清单与分片' }
export const sourceLabel = (adapter: TaskConfig['adapter']) => sourceLabels[adapter] || '状态快照'

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral'

// Colour only; the wording of each state stays in utils.states. A finished run stays quiet on live
// views so it never reads as running, and turns green only as a recorded outcome.
export function runTone(state: string, outcome = false): Tone {
  if (state === 'running' || (outcome && state === 'completed')) return 'ok'
  if (state === 'service_online') return 'info'
  if (state === 'failed') return 'danger'
  if (state === 'incomplete' || state === 'unknown_end' || state === 'observation_gap') return 'warn'
  return 'neutral'
}

export const healthTone = (health: string): Tone => health === 'error' ? 'danger' : health === 'ok' ? 'ok' : 'warn'

export function percent(task: Task) {
  const { completed, total } = task.snapshot
  return completed != null && total != null && total > 0 ? Math.round(completed / total * 100) : null
}

// Earliest live process start, or the snapshot's own start once nothing is running.
export function runWindow(task: Task) {
  const running = task.resource.roots.length > 0
  const start = running ? Math.min(...task.resource.roots.map(r => r.created_at)) : task.snapshot.started_at
  return { running, start, end: running ? undefined : task.snapshot.finished_at || undefined }
}

export function logTone(line: string) {
  if (/traceback|exception|error|fatal|失败|错误|异常/i.test(line)) return 'danger'
  if (/warn|警告|超时/i.test(line)) return 'warn'
  return ''
}
