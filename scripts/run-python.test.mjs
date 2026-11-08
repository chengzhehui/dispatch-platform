import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pythonCandidates, runPython } from './run-python.mjs'

test('macOS/Linux prefer python3; Windows retains python; PYTHON is an exact executable path', () => {
  assert.deepEqual(pythonCandidates('darwin', {}), ['python3', 'python'])
  assert.deepEqual(pythonCandidates('linux', {}), ['python3', 'python'])
  assert.deepEqual(pythonCandidates('win32', {}), ['python', 'python3'])
  assert.deepEqual(pythonCandidates('darwin', { PYTHON: '/Applications/My Python/bin/python3' }), ['/Applications/My Python/bin/python3'])
})

test('legacy python2 is skipped and Python3 receives Unicode arguments and UTF-8 environment', () => {
  const calls = []
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    return args[0] === '--version' ? { status: 0, stdout: command === 'python' ? 'Python 2.7.18' : 'Python 3.12.0' } : { status: 7 }
  }
  const args = ['脚本/导入.py', '--source', '/用户/模型 文件']
  assert.equal(runPython(args, { platform: 'win32', env: {}, spawn }), 7)
  assert.deepEqual(calls.map(call => call.command), ['python', 'python3', 'python3'])
  assert.deepEqual(calls[2].args, args)
  assert.equal(calls[2].options.shell, false)
  assert.equal(calls[2].options.env.PYTHONUTF8, '1')
  assert.equal(calls[2].options.env.PYTHONIOENCODING, 'utf-8')
})

test('macOS works when only python3 exists; script errors do not retry another interpreter', () => {
  const calls = []
  const spawn = (command, args) => { calls.push(command); return { status: args[0] === '--version' ? 0 : 1, stdout: 'Python 3.12.0' } }
  assert.equal(runPython(['test.py'], { platform: 'darwin', env: {}, spawn }), 1)
  assert.deepEqual(calls, ['python3', 'python3'])
  const messages = []
  assert.equal(runPython(['test.py'], { env: {}, spawn: () => ({ error: new Error('ENOENT') }), report: message => messages.push(message) }), 1)
  assert.match(messages[0], /Python 3/)
})
