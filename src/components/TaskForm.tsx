import { useState } from 'react'
import type { FormEvent } from 'react'
import { Dialog } from './ui/dialog'
import { Button } from './ui/button'
import type { TaskConfig } from '../lib/types'
import { rpc } from '../lib/bridge'
const blank: TaskConfig = { id: '', name: '', description: '', adapter: 'json', project: '', match_kind: 'script', entry: '', subcommands: [], snapshot: '', logs: '', python: '', interval: 30 }
export function TaskForm({ initial, onClose, onSaved }: { initial?: TaskConfig; onClose: () => void; onSaved: (task: TaskConfig) => void }) {
  const [task, setTask] = useState<TaskConfig>(initial || blank)
  const [commands, setCommands] = useState(task.subcommands.join(', '))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const field = (key: keyof TaskConfig, value: string) => setTask(t => ({ ...t, [key]: value }))
  async function submit(e: FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try { onSaved(await rpc<TaskConfig>('save_task', { task: { ...task, subcommands: commands.split(/[,，]/).map(s => s.trim()).filter(Boolean) } })) }
    catch (e) { setError(String(e)) } finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose() }} title={initial ? '编辑关注任务' : '添加关注任务'} description="指定一次入口，之后自动识别。此操作不会启动或修改任务。"><form onSubmit={submit} className="task-form">
    <div className="form-row"><label>任务名称<input required value={task.name} onChange={e => field('name', e.target.value)} placeholder="例如：模型训练" /></label><label>说明<input value={task.description} onChange={e => field('description', e.target.value)} placeholder="任务用途（可选）" /></label></div>
    <label>项目文件夹<input required value={task.project} onChange={e => field('project', e.target.value)} placeholder="E:\我的项目\训练" /></label>
    <div className="form-row"><label>识别方式<select value={task.match_kind} onChange={e => field('match_kind', e.target.value)}><option value="script">脚本完整路径</option><option value="module">Python 模块（-m）</option></select></label><label>进度来源<select value={task.adapter} onChange={e => field('adapter', e.target.value)}><option value="json">通用 JSON 状态文件</option><option value="process">仅监控进程</option><option value="tieba">贴吧快照</option><option value="grok">Grok 进度模块</option></select></label></div>
    <label>{task.match_kind === 'script' ? '脚本路径' : '模块名称'}<input required value={task.entry} onChange={e => field('entry', e.target.value)} placeholder={task.match_kind === 'script' ? 'E:\我的项目\训练\train.py' : 'grokspider'} /></label>
    {task.match_kind === 'module' && <label>运行子命令（可选，英文逗号分隔）<input value={commands} onChange={e => setCommands(e.target.value)} placeholder="run, train" /><small>模块启动时的工作目录必须与项目文件夹一致。</small></label>}
    {(task.adapter === 'json' || task.adapter === 'tieba') && <label>JSON 状态文件<input required value={task.snapshot} onChange={e => field('snapshot', e.target.value)} placeholder="E:\我的项目\训练\progress.json" /></label>}
    {task.adapter === 'grok' && <label>项目 Python 解释器<input required value={task.python} onChange={e => field('python', e.target.value)} placeholder="C:\...\python.exe" /><small>只调用 grokspider.progress，不运行采集命令。</small></label>}
    <label>日志文件或文件夹（可选）<input value={task.logs} onChange={e => field('logs', e.target.value)} placeholder="E:\我的项目\训练\logs" /></label>
    {error && <p role="alert" className="error-message">{error}</p>}<div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>取消</Button><Button disabled={saving}>{saving ? '保存中…' : '保存关注任务'}</Button></div>
  </form></Dialog>
}
