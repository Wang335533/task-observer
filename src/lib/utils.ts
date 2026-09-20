import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export const cn = (...values: ClassValue[]) => twMerge(clsx(values))
export function number(value: number | null | undefined) { return value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 3 }) }
export function bytes(value: number | null | undefined) { return value == null ? '—' : value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(0)} MB` }
export function relative(time: number | null | undefined) {
  if (!time) return '尚无更新'
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - time))
  return seconds < 60 ? `${seconds} 秒前` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟前` : seconds < 86400 ? `${Math.floor(seconds / 3600)} 小时前` : `${Math.floor(seconds / 86400)} 天前`
}
export function date(time: number | null | undefined) { return time ? new Date(time * 1000).toLocaleString('zh-CN', { hour12: false }) : '—' }
export function duration(start: number | null | undefined, end = Date.now() / 1000) {
  if (!start) return '—'
  const minutes = Math.max(0, Math.floor((end - start) / 60))
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}
export const states: Record<string, string> = { running: '运行中', completed: '已完成', failed: '运行失败', incomplete: '有待处理事项', unknown_end: '结果未确认', idle: '未运行', observation_gap: '监控中断，结果未知' }
