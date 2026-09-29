import { PageHeader, PanelHeader } from '../components/common'
import { RunTable } from '../components/RunTable'
import type { Run } from '../lib/types'

export function HistoryPage({ runs, names }: { runs: Run[]; names: Record<string, string> }) {
  const running = runs.filter(r => r.status === 'running').length
  return <>
    <PageHeader title="运行历史" description="记录应用观察到的启动与结束；监控中断期间的结果保持未知。" />
    <section className="panel">
      <PanelHeader title="全部运行记录" meta={runs.length ? `共 ${runs.length} 条${running ? ` · ${running} 条进行中` : ''}` : '仅记录实际观察到的运行'} />
      <RunTable runs={runs} names={names} />
    </section>
  </>
}
