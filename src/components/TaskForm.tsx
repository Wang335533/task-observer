import { useState } from 'react'
import type { FormEvent } from 'react'
import { Info } from 'lucide-react'
import { Dialog } from './ui/dialog'
import { Button } from './ui/button'
import type { TaskConfig } from '../lib/types'
import { rpc } from '../lib/bridge'
import { adapterLabels } from '../lib/task'
const blank: TaskConfig = { id: '', name: '', description: '', adapter: 'json', project: '', match_kind: 'script', entry: '', subcommands: [], snapshot: '', logs: '', python: '', interval: 300 }
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
    <fieldset>
      <legend>基本信息</legend>
      <div className="form-row"><label className="field"><span>任务名称</span><input required value={task.name} onChange={e => field('name', e.target.value)} placeholder="例如：模型训练" /></label><label className="field"><span>说明</span><input value={task.description} onChange={e => field('description', e.target.value)} placeholder="任务用途（可选）" /></label></div>
      <label className="field"><span>项目文件夹</span><input required value={task.project} onChange={e => field('project', e.target.value)} placeholder="E:\我的项目\训练" /></label>
    </fieldset>
    <fieldset>
      <legend>运行入口</legend>
      <div className="form-row entry-row"><label className="field"><span>识别方式</span><select value={task.match_kind} onChange={e => field('match_kind', e.target.value)}><option value="script">脚本完整路径</option><option value="module">Python 模块（-m）</option></select></label><label className="field"><span>{task.match_kind === 'script' ? '脚本路径' : '模块名称'}</span><input required value={task.entry} onChange={e => field('entry', e.target.value)} placeholder={task.match_kind === 'script' ? 'E:\\我的项目\\训练\\train.py' : 'grokspider'} /></label></div>
      {task.match_kind === 'module' && <label className="field"><span>运行子命令（可选，英文逗号分隔）</span><input value={commands} onChange={e => setCommands(e.target.value)} placeholder="run, train" /><small>模块启动时的工作目录必须与项目文件夹一致。</small></label>}
    </fieldset>
    <fieldset>
      <legend>进度与日志</legend>
      <label className="field"><span>进度来源</span><select aria-label="进度来源" value={task.adapter} onChange={e => field('adapter', e.target.value)}>{Object.entries(adapterLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      {(['json', 'tieba', 'guba', 'msqa', 'kokusho', 'cnki'].includes(task.adapter)) && <label className="field"><span>{task.adapter === 'kokusho' ? '原始数据目录（包含三类详情分片）' : task.adapter === 'cnki' ? '知网 SQLite 数据库（只读）' : 'JSON 状态文件'}</span><input required value={task.snapshot} onChange={e => field('snapshot', e.target.value)} placeholder="E:\我的项目\训练\progress.json" /></label>}
      {task.adapter === 'ssrn' && <label className="field"><span>本地助手端口</span><input type="number" min={1024} max={65535} value={task.helper_port ?? 18765} onChange={e => setTask(t => ({ ...t, helper_port: Number(e.target.value) }))} /><small>仅连接 127.0.0.1 的现有助手，不启动服务、不执行下载操作。</small></label>}
      {task.adapter === 'grok' && <p className="form-note"><Info size={15} /><span>自动读取项目的只读进度模块与配置，无需另行指定 Python；不会运行抓取命令。</span></p>}
      {task.adapter === 'guba' && <p className="form-note"><Info size={15} /><span>选择正式输出目录的 progress.json；抓取命令需显式指定相同的 --output，避免把独立样本误认作正式运行。</span></p>}
      <label className="field"><span>日志文件或文件夹（可选）</span><input value={task.logs} onChange={e => field('logs', e.target.value)} placeholder="E:\我的项目\训练\logs" /></label>
    </fieldset>
    {error && <p role="alert" className="error-message">{error}</p>}<div className="form-actions"><Button type="button" variant="ghost" onClick={onClose}>取消</Button><Button disabled={saving}>{saving ? '保存中…' : '保存关注任务'}</Button></div>
  </form></Dialog>
}
