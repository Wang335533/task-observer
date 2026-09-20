import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import path from 'node:path'

// Development-only bridge. Production uses the Tauri stdio bridge and has no port.
function previewBridge(): Plugin {
  return {
    name: 'local-collector-preview',
    configureServer(server) {
      // UI tests intercept RPC in Playwright; no process inspection is needed.
      if (process.env.OBSERVER_UI_TEST === '1') return
      const interpreter = process.env.OBSERVER_PYTHON || path.resolve('.venv/Scripts/python.exe')
      const child = spawn(interpreter, ['-B', '-m', 'collector.main', '--data-dir', process.env.TASK_OBSERVER_DATA_DIR || path.resolve('../work/preview-data')],
        { cwd: process.cwd(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
      let counter = 0
      let error = ''
      const pending = new Map<number, { resolve: (value: unknown) => void, reject: (e: Error) => void }>()
      createInterface({ input: child.stdout }).on('line', line => {
        try {
          const message = JSON.parse(line)
          const request = pending.get(message.id)
          if (request) { pending.delete(message.id); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result) }
        } catch { /* Non-protocol output is never rendered. */ }
      })
      child.on('error', e => { error = e.message })
      child.on('exit', () => { error ||= '采集器已退出'; for (const p of pending.values()) p.reject(new Error(error)); pending.clear() })
      child.stderr.on('data', () => { /* Keep raw subprocess errors out of browser logs. */ })
      server.middlewares.use('/__observer', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const origin = req.headers.origin
        if (req.method !== 'POST' || (origin && new URL(origin).host !== req.headers.host)) { res.statusCode = 403; res.end('{}'); return }
        try {
          if (error) throw new Error(error)
          let body = ''
          for await (const chunk of req) { body += chunk; if (body.length > 131072) throw new Error('请求过大') }
          const request = JSON.parse(body)
          const id = ++counter
          const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('采集器响应超时')) }, 15000)
            pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: e => { clearTimeout(timer); reject(e) } })
            child.stdin.write(JSON.stringify({ id, method: request.method, params: request.params }) + '\n')
          })
          res.end(JSON.stringify({ result }))
        } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })) }
      })
      server.httpServer?.on('close', () => { child.stdin.end() })
    },
  }
}

export default defineConfig({ plugins: [react(), previewBridge()], clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/build/**', '**/.venv/**'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 700 } })
