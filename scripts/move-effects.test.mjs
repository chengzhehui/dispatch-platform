import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MoveCommandEffects } from '../src/scene/MoveCommandEffects.js'

test('formation marker stays at the click until its last moving member arrives', () => {
  const scene = new THREE.Scene(), effects = new MoveCommandEffects(scene)
  const workers = [{ id: 'one', unit: '213', target: [9, .1, 10] }, { id: 'two', unit: '213', target: [11, .1, 10] }]
  effects.issue('213', [10, .1, 10], ['one', 'two'])
  const order = [...effects.orders.values()][0]
  assert.deepEqual(order.point, [10, .1, 10])
  workers[0].target = null
  effects.prune(workers)
  assert.equal(effects.orders.size, 1)
  assert.deepEqual([...order.members], ['two'])
  workers[1].target = null
  effects.prune(workers)
  assert.equal(effects.orders.size, 0)
  assert.equal(scene.children.length, 0)
  effects.dispose()
})

test('retargeting preserves other orders; stopping or deleting a worker clears its marker', () => {
  const effects = new MoveCommandEffects(new THREE.Scene())
  const workers = [{ id: 'one', unit: '213', target: [1, .1, 1] }, { id: 'two', unit: '213', target: [1, .1, 1] }]
  effects.issue('213', [1, .1, 1], ['one', 'two'])
  workers[0].target = [5, .1, 5]
  effects.issue('213', [5, .1, 5], ['one'])
  assert.equal(effects.orders.size, 2)
  assert.deepEqual(effects.snapshot().map(order => order.workerIds), [['two'], ['one']])
  workers[1].target = null
  effects.prune(workers)
  assert.deepEqual(effects.snapshot().map(order => order.point), [[5, .1, 5]])
  effects.prune([])
  assert.equal(effects.orders.size, 0)
  effects.dispose()
})

test('pulse animation continues while moving; unit switching hides markers without losing them', () => {
  const effects = new MoveCommandEffects(new THREE.Scene())
  effects.reducedMotion = false
  const workers = [{ id: 'one', unit: '213', target: [0, 50.1, 0] }]
  const camera = new THREE.PerspectiveCamera(45, 1, .2, 1000)
  camera.position.set(20, 80, 40); camera.lookAt(0, 50, 0); camera.updateMatrixWorld()
  effects.issue('213', [0, 50.1, 0], ['one'])
  const order = [...effects.orders.values()][0], visual = order.visual
  effects.update(workers, '213', camera, 800, order.createdAt + .1)
  const initial = visual.waves[0].scale.x
  assert.equal(visual.root.visible, true)
  assert.ok(Math.abs(visual.root.position.y - 50.16) < 1e-8)
  effects.update(workers, '213', camera, 800, order.createdAt + 3)
  assert.notEqual(visual.waves[0].scale.x, initial)
  assert.equal(visual.burst.visible, false)
  assert.equal(visual.root.visible, true)
  effects.update(workers, '27', camera, 800, order.createdAt + 4)
  assert.equal(visual.root.visible, false)
  assert.equal(effects.orders.size, 1)
  effects.update(workers, '213', camera, 800, order.createdAt + 5)
  assert.equal(visual.root.visible, true)
  effects.dispose()
})

test('saved click anchors restore for groups; legacy moving workers recover goal markers', () => {
  const effects = new MoveCommandEffects(new THREE.Scene())
  const workers = [{ id: 'one', unit: '213', target: [9, .1, 10] }, { id: 'two', unit: '213', target: [11, .1, 10] }, { id: 'three', unit: '27', target: [2, .1, 2] }]
  effects.restore([null, { unit: '213', point: [10, .1, 10], workerIds: ['one', 'two', 'missing'] }], workers)
  assert.equal(effects.orders.size, 2)
  assert.deepEqual(effects.snapshot()[0], { unit: '213', point: [10, .1, 10], workerIds: ['one', 'two'] })
  assert.deepEqual(effects.snapshot()[1].point, [2, .1, 2])
  effects.dispose()
})

test('click light streaks converge, flash once and leave the persistent destination marker', () => {
  const effects = new MoveCommandEffects(new THREE.Scene())
  effects.reducedMotion = false
  const workers = [{ id: 'one', unit: '213', target: [0, .1, 0] }]
  const camera = new THREE.PerspectiveCamera(45, 1, .2, 1000)
  camera.position.set(20, 30, 40); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
  effects.issue('213', [0, .1, 0], ['one'])
  const { visual, createdAt } = [...effects.orders.values()][0]
  effects.update(workers, '213', camera, 800, createdAt + .1)
  const outerDistance = visual.rays[0].ray.position.length()
  assert.equal(visual.convergence.visible, true)
  assert.ok(visual.rays.every(({ ray }) => ray.visible))
  effects.update(workers, '213', camera, 800, createdAt + .38)
  assert.ok(visual.rays[0].ray.position.length() < outerDistance)
  assert.equal(visual.flash.visible, true)
  effects.update(workers, '213', camera, 800, createdAt + 1)
  assert.equal(visual.convergence.visible, false)
  assert.equal(visual.flash.visible, false)
  assert.equal(visual.root.visible, true)
  assert.equal(effects.orders.size, 1)
  effects.reducedMotion = true
  effects.update(workers, '213', camera, 800, createdAt + .1)
  assert.equal(visual.convergence.visible, false)
  assert.equal(visual.flash.visible, false)
  effects.dispose()
})
