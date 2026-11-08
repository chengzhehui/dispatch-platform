import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSite, zoneAt, zonesFor, moveTowards, stagingPosition, formationTargets, GROUND_ELEVATIONS } from '../src/domain.js'
const site = createSite([1000, 2000, 50, 100, 0, 0, 0, 60, 0, 0, 0, 50], 50)
test('model axes, site dimensions, 3D zone numbering and half-open boundaries', () => {
  assert.deepEqual(site.origin, [1000, 0, -2000])
  assert.equal(zonesFor(site).length, 24)
  assert.equal(zoneAt([-99, 0.1, -59], site), 'A1-1')
  assert.equal(zoneAt([-49, 50.1, -9], site), 'B2-2')
  assert.equal(zoneAt([100, 0, 0], site), null)
  assert.equal(zoneAt([0, 100, 0], site), null)
  assert.equal(zoneAt(stagingPosition(0, site), site), null)
})
test('movement crosses zone boundaries and stops exactly at target', () => {
  const start = [-99, 0.1, -59], target = [-49, 0.1, -59]
  const halfway = moveTowards(start, target, 25)
  assert.equal(halfway.arrived, false)
  assert.equal(zoneAt(halfway.position, site), 'A1-1')
  const arrived = moveTowards(halfway.position, target, 30)
  assert.equal(arrived.arrived, true)
  assert.deepEqual(arrived.position, target)
  assert.equal(zoneAt(arrived.position, site), 'A2-1')
})
test('formation near site boundary stays inside, including elevated layer', () => {
  const targets = formationTargets([99.9, 50.1, 59.9], 200, site)
  assert.equal(targets.length, 200)
  assert.ok(targets.every(p => zoneAt(p, site)?.endsWith('-2')))
  assert.equal(new Set(targets.map(p => p.join(','))).size, 200)
})
test('213 ground follows the broad platform instead of underground bounding-box minimum', () => {
  const box = [9829.197754, 8068.2543945, 72.080988, 221.302246, 0, 0, 0, 100.4291995, 0, 0, 0, 71.821005]
  const calibrated = createSite(box, 50, GROUND_ELEVATIONS['213'])
  assert.equal(calibrated.origin[1], 81.105)
  assert.equal(calibrated.ny, 2)
  assert.ok(calibrated.height < 63)
  assert.equal(stagingPosition(0, calibrated)[1], 0.1)
  assert.equal(zoneAt([calibrated.minX + 1, .1, calibrated.minZ + 1], calibrated), 'A1-1')
})
