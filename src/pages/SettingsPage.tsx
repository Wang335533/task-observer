import type { ReactNode } from 'react'
import { Monitor, Moon, ShieldCheck, Sun } from 'lucide-react'
import { PageHeader } from '../components/common'
import { autostart, isDesktop, rpc } from '../lib/bridge'
import type { Snapshot } from '../lib/types'
import type { ThemePreference } from '../lib/theme'
import { bytes, percentText } from '../lib/utils'

const themes = [['system', '跟随系统', Monitor], ['light', '浅色', Sun], ['dark', '深色', Moon]] as const

function Switch({ label, checked, disabled, onToggle }: { label: string; checked: boolean; disabled?: boolean; onToggle: () => Promise<void> }) {
  return <button className={`switch ${checked ? 'on' : ''}`} role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => void onToggle()}><span /></button>
}

function Row({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong><p>{text}</p></div>{children}</div>
}

export function SettingsPage({ data, auto, setAuto, theme, setTheme, refresh, fail }: {
  data: Snapshot | null; auto: boolean; setAuto: (enabled: boolean) => void; theme: ThemePreference; setTheme: (theme: ThemePreference) => void
  refresh: () => Promise<void>; fail: (message: string) => void
}) {
  const toggleNotifications = async () => { try { await rpc('set_notifications', { enabled: !data?.settings.notifications }); await refresh() } catch (e) { fail(String(e)) } }
  const toggleAutostart = async () => { try { setAuto(await autostart(!auto)) } catch (e) { fail(String(e)) } }
  return <>
    <PageHeader title="设置" description="轻量运行，专注于本地任务。" />
    <div className="settings">
      <section className="panel settings-panel">
        <h3>外观</h3>
        <Row title="界面主题" text="跟随 Windows 的浅色 / 深色设置，或固定使用其中一种。">
          <div className="segmented" role="group" aria-label="界面主题">
            {themes.map(([id, label, Icon]) => <button key={id} aria-pressed={theme === id} className={theme === id ? 'selected' : ''} onClick={() => setTheme(id)}><Icon size={15} />{label}</button>)}
          </div>
        </Row>
      </section>
      <section className="panel settings-panel">
        <h3>运行与通知</h3>
        <Row title="桌面异常提醒" text="使用 Windows 通知；关闭后仍保留应用内提醒。">
          <Switch label="桌面异常提醒" checked={!!data?.settings.notifications} onToggle={toggleNotifications} />
        </Row>
        <Row title="开机自动启动" text={isDesktop ? '登录 Windows 后自动启动并留在托盘。' : '在桌面应用中可启用，浏览器预览不修改系统启动项。'}>
          <Switch label="开机自动启动" checked={auto} disabled={!isDesktop} onToggle={toggleAutostart} />
        </Row>
        <Row title="关闭窗口后继续监控" text="桌面应用关闭窗口时进入托盘；从托盘菜单选择“退出”才停止监控。">
          <span className="badge tone-ok"><span className="status-dot" />已启用</span>
        </Row>
      </section>
      <section className="panel settings-panel">
        <h3>本地存储与采集</h3>
        <dl className="kv">
          <div><dt>应用数据位置</dt><dd className="mono">{data?.data_dir || '正在读取'}</dd></div>
          <div><dt>进程资源采样</dt><dd>每 5 分钟 · 同步记录趋势</dd></div>
          <div><dt>业务进度检查</dt><dd>各任务独立每 5 分钟 · 单次限时 30 秒</dd></div>
          <div><dt>采集器 CPU</dt><dd>{percentText(data?.observer.cpu_percent)}</dd></div>
          <div><dt>采集器内存</dt><dd>{bytes(data?.observer.memory_bytes)}</dd></div>
        </dl>
        <p className="source-note"><ShieldCheck size={16} /><span>本应用只读取任务状态。不会启动、停止或重跑业务任务，也不会上传数据。</span></p>
      </section>
    </div>
  </>
}
