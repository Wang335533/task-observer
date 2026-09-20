export type Metric = { key: string; label: string; value: number | null; unit: string }
export type TaskConfig = {
  id: string; name: string; description: string; adapter: 'grok' | 'tieba' | 'json' | 'process';
  project: string; match_kind: 'module' | 'script'; entry: string; subcommands: string[];
  snapshot: string; logs: string; python: string; interval: number;
}
export type Issue = { code: string; level: string; message: string }
export type Task = {
  config: TaskConfig;
  snapshot: { metrics: Metric[]; queues: Metric[]; stage: string; status: string; run_id: string | null;
    updated_at: number | null; statistics_at: number | null; started_at?: number | null; finished_at?: number | null;
    issues: Issue[]; completed: number | null; total: number | null; current: string; note?: string; cached: boolean; last_error?: string };
  resource: { roots: { pid: number; created_at: number; identity: string }[]; cpu_percent?: number | null; memory_bytes?: number | null; process_count?: number };
  view: { run_state: string; health: string; issues: Issue[]; stale: boolean; cooldown?: boolean };
  checking: boolean;
}
export type Alert = { id: number; task_id: string; code: string; level: string; message: string; created: number; resolved: number | null; acknowledged: number }
export type Run = { id: string; task_id: string; started: number; ended: number | null; status: string; observed_at: number }
export type Sample = { at: number; cpu: number | null; memory: number | null; metrics: Metric[] }
export type Snapshot = { tasks: Task[]; last_scan: number | null; scan_error: string | null; observer: { cpu_percent?: number; memory_bytes?: number };
  settings: { notifications: boolean }; data_dir: string; alerts: Alert[]; events: { id: number; task_id: string; at: number; message: string }[] }
