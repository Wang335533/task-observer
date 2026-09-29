import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Sample } from '../lib/types'
import { number } from '../lib/utils'
import { PanelHeader } from './common'

const colors = { cpu: 'var(--chart-1)', memory: 'var(--chart-2)' }
const tick = { fontSize: 11, fill: 'var(--chart-axis)' }

export default function Trend({ samples, field, title, unit }: { samples: Sample[]; field: 'cpu' | 'memory'; title: string; unit: string }) {
  const values = samples.map(s => ({ at: new Date(s.at * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), value: field === 'cpu' ? s.cpu : s.memory == null ? null : Math.round(s.memory / 1024 ** 2) }))
  const latest = [...values].reverse().find(v => v.value != null)?.value
  const color = colors[field]
  return <section className="panel pad chart-panel">
    <PanelHeader title={title} meta="最近 24 小时 · 每 5 分钟采样">
      {latest != null && <span className="chart-latest" title="最近一次采样">{number(latest)}<small>{unit}</small></span>}
    </PanelHeader>
    {samples.length < 2 ? <div className="empty compact"><strong>正在积累趋势</strong><p>至少两次采样后显示曲线；缺失读数不会补成零。</p></div> : <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={values} margin={{ top: 6, right: 4, bottom: 0, left: -8 }}>
          <defs><linearGradient id={`fill-${field}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={.22} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="at" minTickGap={70} axisLine={false} tickLine={false} tick={tick} />
          <YAxis width={45} axisLine={false} tickLine={false} tick={tick} />
          <Tooltip formatter={v => [`${number(Number(v))} ${unit}`, title]} cursor={{ stroke: 'var(--border-strong)' }}
            contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', boxShadow: 'var(--shadow-md)', fontSize: 12 }}
            labelStyle={{ color: 'var(--text-3)' }} itemStyle={{ color: 'var(--text)' }} />
          <Area type="monotone" dataKey="value" stroke={color} fill={`url(#fill-${field})`} strokeWidth={2} connectNulls={false} isAnimationActive={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>}
  </section>
}
