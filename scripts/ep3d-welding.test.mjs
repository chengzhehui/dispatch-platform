import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as THREE from 'three'
import { Ep3dModel, geometryIdAtFace, localBounds } from '../src/scene/Ep3dModel.js'
import { createWeldTask, restoreWeldTask, weldOwner } from '../src/welding.js'
import { weldingPose } from '../src/scene/WeldingVisual.js'

test('batch face picking joins two geometry IDs under one object and highlights only those triangles', async () => {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 2,0,0, 3,0,0, 2,1,0, 4,0,0, 5,0,0, 4,1,0], 3))
  geometry.setAttribute('_batchid', new THREE.Float32BufferAttribute([0,0,0, 1,1,1, 2,2,2], 1))
  geometry.setIndex([0,1,2,3,4,5,6,7,8])
  const root = new THREE.Group(), mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  root.add(mesh); root.batchTable = { getDataFromId: id => ({ componentId: ['source/g1', 'g2', 'g3'][id] }) }
  root.position.set(-9800, -81, 8000); root.rotation.x = -Math.PI / 2
  root.updateMatrixWorld(true)
  assert.equal(geometryIdAtFace(mesh, 0), 'g1')
  assert.equal(geometryIdAtFace(mesh, 1), 'g2')
  const model = new Ep3dModel(() => {})
  const object = { id: 'obj:1', unit: '213', geometryIds: ['g1','g2'], isWeld: true, shard: 0 }
  model.cache.set('213', { byId: new Map([[object.id, object]]), columns: [{ set: 'EP3D', name: '焊点编号' }] })
  model.propertyRequests.set('/data/ep3d/213/properties-0.json', Promise.resolve({ 'obj:1': [[0, 'FW-1']] }))
  model.attachTile(root, '/models/uae/units/213/ep3d/example.b3dm')
  await model.select(object.id)
  assert.ok(model.meshRecords.get(mesh).overlay.matrixWorld.equals(mesh.matrixWorld), 'late-created overlay must inherit tile world coordinates immediately, even when TilesGroup skips subtree updates')
  assert.equal(model.meshRecords.get(mesh).overlay.geometry.attributes.position.count, 6)
  assert.equal(model.meshRecords.get(mesh).overlay.material.depthTest, true)
  assert.equal(model.meshRecords.get(mesh).overlay.material.depthWrite, false)
  assert.equal(model.meshRecords.get(mesh).overlay.material.polygonOffset, true)
  assert.deepEqual(model.selected.properties, [{ set: 'EP3D', name: '焊点编号', value: 'FW-1' }])
  model.updatePulse(0)
  const opacity = model.meshRecords.get(mesh).overlay.material.opacity
  model.updatePulse(260)
  assert.notEqual(model.meshRecords.get(mesh).overlay.material.opacity, opacity)
  model.updatePulse(0, true)
  const reducedOpacity = model.meshRecords.get(mesh).overlay.material.opacity
  model.updatePulse(260, true)
  assert.equal(model.meshRecords.get(mesh).overlay.material.opacity, reducedOpacity)
  geometry.attributes._batchid.setX(2, 1)
  assert.equal(geometryIdAtFace(mesh, 0), null, 'mixed-batch faces must not pick a wrong object')
  const pending = model.select(object.id)
  model.clearSelection(); await pending
  assert.equal(model.selected, null, 'Esc clearing must survive late property responses')
  assert.equal(model.meshRecords.get(mesh).overlay, null)
  model.detachTile(root)
  assert.equal(mesh.children.length, 0)
  model.dispose(); geometry.dispose(); mesh.material.dispose()
})

test('EP3D Z-up bounds convert to unit Y-up after the stored translation exactly once', () => {
  const site = { origin: [9800, 81.105, -8000] }
  const box = localBounds([9801,8002,82,9803,8004,84], site)
  assert.deepEqual(box.min.toArray(), [1,82-81.105,-4])
  assert.deepEqual(box.max.toArray(), [3,84-81.105,-2])
})

test('task stations offset from the weld; ownership and restore preserve node identity', () => {
  const object = { id: 'obj:7', unit: '213', line: 'L', label: 'FW-1', isWeld: true, diameter: '100', fingerprint: 'g1|g2|g3' }
  const task = createWeldTask(object, [10,.6,10], [0,.1,0])
  assert.equal(task.crouch, true)
  assert.equal(task.station[1], .1)
  assert.ok(Math.hypot(task.station[0]-10, task.station[2]-10) >= .749)
  assert.equal(createWeldTask(object, [10,20,10], [0,.1,0]).station[1], 18.85)
  assert.equal(weldOwner([{ id: 'W-1', weldTask: task }], '213', 'obj:7').id, 'W-1')
  assert.equal(weldOwner([{ id: 'W-1', weldTask: task }], '213', 'obj:7', 'W-1'), null)
  assert.ok(restoreWeldTask(task, object))
  assert.equal(restoreWeldTask(task, { ...object, id: 'obj:8' }), null)
  assert.equal(restoreWeldTask(task, { ...object, fingerprint: 'different' }), null)
})

test('procedural welding keeps hands forward with a repeatable rubbing loop and optional crouch', () => {
  const a = weldingPose(0, false), b = weldingPose(.3, false), crouch = weldingPose(0, true)
  assert.ok(a.upperarml.x < -.8)
  assert.notEqual(a.lowerarml.x, b.lowerarml.x)
  assert.ok(crouch.upperlegl.x < -.5 && crouch.lowerlegl.x > 1)
  assert.equal(a.upperlegl.x, 0)
})

test('standalone EP3D data retains all source nodes, same-name welds and lazy property references', () => {
  const manifest = JSON.parse(fs.readFileSync('public/data/ep3d/manifest.json', 'utf8'))
  const index = JSON.parse(fs.readFileSync('public/data/ep3d/213/index.json', 'utf8'))
  assert.equal(index.objects.length, manifest.units['213'].components)
  assert.ok(index.objects.some(row => !row[4] && row[6]), 'pipe components retain bounds for camera focus as well as welds')
  const welds = index.objects.filter(row => row[4])
  assert.equal(welds.length, manifest.units['213'].welds)
  assert.equal(welds.filter(row => row[6]).length, manifest.units['213'].locatableWelds)
  const names = new Map()
  for (const row of welds) {
    const key = `${row[1]}|${row[3]}`
    if (!names.has(key)) names.set(key, [])
    names.get(key).push(row[0])
    assert.ok(fs.existsSync(`public/data/ep3d/213/properties-${row[7]}.json`))
  }
  assert.ok([...names.values()].some(ids => ids.length > 1 && new Set(ids).size === ids.length), 'same-name nodes remain independently bindable')
  assert.equal(new Set(index.objects.map(row => row[0])).size, index.objects.length)
})
