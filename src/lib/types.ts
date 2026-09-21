export type Metric = { key: string; label: string; value: number | null; unit: string; statistics_at?: number | null; cached?: boolean }
export type TaskConfig = {
  id: string; name: string; description: string; adapter: 'grok' | 'tieba' | 'json' | 'process' | 'msqa' | 'kokusho' | 'ssrn' | 'cnki';
  project: string; match_kind: 'module' | 'script'; entry: string; subcommands: string[];
  snapshot: string; logs: string; python: string; interval: number; helper_port?: number;
}
export type Issue = { code: string; level: string; message: string }
export type Task = {
  config: TaskConfig;
  snapshot: { metrics: Metric[]; queues: Metric[]; stage: string; status: string; run_id: string | null;
    updated_at: number | null; statistics_at: number | null; statistics_kind?: string; started_at?: number | null; finished_at?: number | null;
    issues: Issue[]; completed: number | null; total: number | null; current: string; note?: string; cached: boolean; last_error?: string };
  resource: { roots: { pid: number; created_at: number; identity: string }[]; cpu_percent?: number | null; memory_bytes?: number | null; process_count?: number };
  view: { run_state: string; health: string; issues: Issue[]; stale: boolean; cooldown?: boolean };
  checking: boolean; last_checked_at?: number | null;
  check_status?: string; check_started_at?: number | null; last_success_at?: number | null; next_check_at?: number | null; read_duration?: number | null;
}
export type Alert = { id: number; task_id: string; code: string; level: string; message: string; created: number; resolved: number | null; acknowledged: number }
export type Run = { id: string; task_id: string; started: number; ended: number | null; status: string; observed_at: number }
export type Sample = { at: number; cpu: number | null; memory: number | null; metrics?: Metric[] }
export type Snapshot = { collector_generation: number; revision: number; tasks: Task[]; last_scan: number | null; scan_error: string | null; observer: { cpu_percent?: number; memory_bytes?: number };
  settings: { notifications: boolean }; data_dir: string; alerts: Alert[]; events: { id: number; task_id: string; at: number; message: string }[] }
