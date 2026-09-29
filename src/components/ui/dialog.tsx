import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
export function Dialog({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-overlay" /><DialogPrimitive.Content className="dialog-content">
    <div className="dialog-header"><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Description>{description}</DialogPrimitive.Description></div>
    <div className="dialog-body">{children}</div>
    <DialogPrimitive.Close className="dialog-close icon-button" aria-label="关闭"><X size={18} /></DialogPrimitive.Close>
  </DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>
}
