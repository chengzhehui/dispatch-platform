// Same interpreter-discovery approach as three-demo, with python3 preferred on
// macOS/Linux and Python 2 explicitly rejected. No shell or Windows-only paths.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function pythonCandidates(platform = process.platform, env = process.env) {
  if (env.PYTHON) return [env.PYTHON]
  return platform === 'win32' ? ['python', 'python3'] : ['python3', 'python']
}

export function runPython(args, { platform = process.platform, env = process.env, spawn = spawnSync, report = console.error } = {}) {
  if (!args.length) { report('用法：node scripts/run-python.mjs <script.py> [...参数]'); return 1 }
  const options = { env: { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, shell: false, windowsHide: true }
  for (const command of pythonCandidates(platform, env)) {
    const version = spawn(command, ['--version'], { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (version.error || version.status !== 0 || !/Python\s+3\./i.test(`${version.stdout || ''}\n${version.stderr || ''}`)) continue
    const result = spawn(command, args, { ...options, stdio: 'inherit' })
    if (result.error) { report(`Python 启动失败：${result.error.message}`); return 1 }
    return result.status ?? 1
  }
  report('未找到可用的 Python 3。请安装 Python 3，确保 python3 或 python 在 PATH 中；也可用 PYTHON 指定解释器完整路径。')
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runPython(process.argv.slice(2))
