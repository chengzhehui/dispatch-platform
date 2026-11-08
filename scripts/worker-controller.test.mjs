import { test } from 'node:test'
import assert from 'node:assert/strict'
import { movementIntent, advanceJump, JUMP_SPEED } from '../src/scene/WorkerController.js'

test('WASD supports backwards/strafe, cancels opposites and normalizes diagonals', () => {
  assert.deepEqual(movementIntent(new Set(['KeyS'])), { forward: -1, strafe: 0, moving: true })
  assert.deepEqual(movementIntent(new Set(['KeyA'])), { forward: 0, strafe: -1, moving: true })
  assert.equal(movementIntent(new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD'])).moving, false)
  const diagonal = movementIntent(new Set(['KeyW', 'KeyD']))
  assert.ok(Math.abs(Math.hypot(diagonal.forward, diagonal.strafe) - 1) < 1e-10)
  assert.equal(movementIntent(new Set(), 1).moving, false)
  assert.equal(movementIntent(new Set(), 2).moving, false)
  assert.equal(movementIntent(new Set(), 3).forward, 1)
})

test('a flat-ground jump rises, falls, lands exactly and is frame-rate independent', () => {
  const initial = { height: 0, velocity: JUMP_SPEED }
  assert.deepEqual(advanceJump(initial, 0), initial)
  let jump = { ...initial }, maxHeight = 0
  for (let i = 0; i < 120 && jump; i++) { jump = advanceJump(jump, 1 / 120); maxHeight = Math.max(maxHeight, jump?.height || 0) }
  assert.equal(jump, null)
  assert.ok(maxHeight > 1 && maxHeight < 1.3)
  const oneStep = advanceJump(initial, 0.3)
  let manySteps = { ...initial }
  for (let i = 0; i < 30; i++) manySteps = advanceJump(manySteps, 0.01)
  assert.ok(Math.abs(oneStep.height - manySteps.height) < 1e-10)
  assert.ok(Math.abs(oneStep.velocity - manySteps.velocity) < 1e-10)
})
