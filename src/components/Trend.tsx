import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Sample } from '../lib/types'
import { number } from '../lib/utils'

export default function Trend({ samples, field, title, unit }: { samples: Sample[]; field: 'cpu' | 'memory'; title: string; unit: string }) {
  const values = samples.map(s => ({ at: new Date(s.at * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), value: field === 'cpu' ? s.cpu : s.memory == null ? null : Math.round(s.memory / 1024 ** 2) }))
  return <section className="panel chart-panel"><div className="panel-title"><h3>{title}</h3><span>最近 24 小时 · 每 5 分钟采样</span></div>{samples.length < 2 ? <div className="empty"><strong>正在积累趋势</strong><p>至少两次采样后显示曲线；缺失读数不会补成零。</p></div> : <div className="chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={values}><defs><linearGradient id={`fill-${field}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#11989d" stopOpacity={.18} /><stop offset="100%" stopColor="#11989d" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e8edef" /><XAxis dataKey="at" minTickGap={70} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#89929e' }} /><YAxis width={45} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#89929e' }} /><Tooltip formatter={v => [`${number(Number(v))} ${unit}`, title]} contentStyle={{ borderRadius: 10, border: '1px solid #e4e9eb' }} /><Area type="monotone" dataKey="value" stroke="#0b8d93" fill={`url(#fill-${field})`} strokeWidth={2} connectNulls={false} isAnimationActive={false} /></AreaChart></ResponsiveContainer></div>}</section>
}

