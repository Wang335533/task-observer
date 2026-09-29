import type { ReactNode } from 'react'
import { Inbox, type LucideIcon } from 'lucide-react'

export function Empty({ title, text, icon: Icon = Inbox, children }: { title: string; text: string; icon?: LucideIcon; children?: ReactNode }) {
  return <div className="empty">
    <span className="empty-icon"><Icon size={20} /></span>
    <strong>{title}</strong>
    <p>{text}</p>
    {children}
  </div>
}

export function PageHeader({ title, count, description, actions }: { title: string; count?: number; description?: string; actions?: ReactNode }) {
  return <header className="page-heading">
    <div>
      <h1>{title}{count != null && <span className="title-count">{count}</span>}</h1>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>
}

export function PanelHeader({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  return <div className="panel-header">
    <div className="panel-heading"><h3>{title}</h3>{meta && <span className="panel-meta">{meta}</span>}</div>
    {children}
  </div>
}
