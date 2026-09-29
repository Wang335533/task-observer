import { BellRing, Check, ChevronRight, CircleAlert, CircleCheck, Radar, TriangleAlert } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Empty, PageHeader } from '../components/common'
import type { Alert } from '../lib/types'
import { date } from '../lib/utils'

const icons = { error: CircleAlert, collector: Radar }

export function AlertsPage({ alerts, names, open, ack }: { alerts: Alert[]; names: Record<string, string>; open: (id: string) => void; ack: (alert: Alert) => Promise<void> }) {
  const unread = alerts.filter(a => !a.acknowledged && !a.resolved).length
  return <>
    <PageHeader title="提醒" count={unread} description="同一问题持续期间只提醒一次，恢复后再次发生才重新提醒。" />
    <section className="panel alerts-panel">
      {alerts.length ? alerts.map(alert => {
        const Icon = alert.resolved ? CircleCheck : icons[alert.level as keyof typeof icons] || TriangleAlert
        const state = alert.resolved ? 'resolved' : alert.acknowledged ? 'read' : 'open'
        return <div className={`alert-row ${state}`} key={alert.id}>
          <span className={`alert-icon ${alert.resolved ? 'resolved' : alert.level}`}><Icon size={18} /></span>
          <div className="alert-body">
            <button className="alert-task" onClick={() => open(alert.task_id)}>{names[alert.task_id] || alert.task_id}<ChevronRight size={13} /></button>
            <p>{alert.message}</p>
            <small><span className={`alert-state ${state}`}>{alert.resolved ? '已恢复' : alert.acknowledged ? '已读 · 问题仍存在' : '待关注'}</span>{date(alert.created)}</small>
          </div>
          {!alert.acknowledged && <Button variant="ghost" size="sm" onClick={() => void ack(alert)}><Check size={15} />标记已读</Button>}
        </div>
      }) : <Empty icon={BellRing} title="目前没有提醒" text="任务异常、需要核查或采集信息过期时，会在这里显示。" />}
    </section>
  </>
}
