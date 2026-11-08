import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { groupHistory, nextHistoryDate, buildHistorySchedule, sampleHistorySchedule } from '../src/history.js'

test('fixed two-second day displays only two of three welds, and does not loop', () => {
  const workers = [{ id: '0015', stops: Array.from({ length: 3 }, () => [0, 0, 0]) }]
  const plan = buildHistorySchedule(workers, 2), route = plan.routes.get('0015')
  assert.equal(plan.duration, 2); assert.equal(route.slotSeconds, 1)
  assert.equal(route.slots.length, 2); assert.equal(route.omittedCount, 1)
  assert.equal(sampleHistorySchedule(route, .5).index, 0)
  assert.equal(sampleHistorySchedule(route, 1.5).index, 1)
  const end = sampleHistorySchedule(route, 100)
  assert.equal(end.phase, 'completed'); assert.equal(end.index, 1); assert.equal(end.completed, 2)
  const full = buildHistorySchedule(workers, 4)
  assert.equal(full.routes.get('0015').slots.length, 3)
  assert.equal(full.routes.get('0015').slotSeconds, 4 / 3)
})

test('walking stays inside fixed display slots and cannot extend the day', () => {
  const plan = buildHistorySchedule([{ id: 'A', stops: [[0,0,0], [10,0,0], [20,0,0], [30,0,0]] }, { id: 'B', stops: [[0,0,0]] }], 4, 10)
  assert.equal(plan.duration, 4)
  assert.equal(plan.routes.get('A').slotSeconds, 1)
  assert.equal(plan.routes.get('B').slotSeconds, 4)
  const route = plan.routes.get('A'), walk = sampleHistorySchedule(route, 1.125)
  assert.equal(walk.phase, 'walking'); assert.deepEqual(walk.position, [5,0,0]); assert.equal(walk.completed, 1)
  assert.equal(sampleHistorySchedule(route, 1.25).phase, 'welding')
  assert.equal(sampleHistorySchedule(route, 4).completed, 4)
  assert.ok(route.slots.every(slot => slot.travel <= .25 && slot.end - slot.weldStart >= .75))
  const short = buildHistorySchedule([{ id: 'A', stops: [[0,0,0], [.2,0,0]] }], 2, 120)
  assert.ok(short.routes.get('A').slots[1].travel >= .12)
  const slow = buildHistorySchedule([{ id: 'A', start: [0,0,0], stops: [[10000,0,0]] }], 2, 1)
  assert.equal(slow.duration, 2); assert.equal(slow.routes.get('A').slots[0].travel, .5)
})

test('next-day route carries the last displayed position, without visiting omitted welds', () => {
  const dayOne = buildHistorySchedule([{ id: 'A', stops: [[0,0,0], [10,0,0], [100,0,0]] }], 2, 10)
  const previous = sampleHistorySchedule(dayOne.routes.get('A'), 2).position
  assert.deepEqual(previous, [10,0,0])
  const next = buildHistorySchedule([{ id: 'A', start: previous, stops: [[10,10,0]] }], 1, 10)
  const route = next.routes.get('A')
  assert.equal(next.duration, 1)
  assert.deepEqual(sampleHistorySchedule(route, 0).position, previous)
  assert.deepEqual(sampleHistorySchedule(route, .125).position, [10,5,0])
  assert.equal(sampleHistorySchedule(route, .25).phase, 'welding')
  assert.deepEqual(sampleHistorySchedule(route, 1).position, [10,10,0])
  assert.deepEqual(sampleHistorySchedule(route, .125), sampleHistorySchedule(route, .125))
})

test('history deduplicates cap welders across welds/units and retains unlocated and unknown-worker records', () => {
  const rows = [
    { id: 'a', unit: 'PD02', welders: ['0015', '0015', 'AB'], point: [1,2,3], workArea: '泵组 A' },
    { id: 'b', unit: 'PD03', welders: ['0015'], point: [3,2,1], workArea: '泵组 B' },
    { id: 'c', unit: 'PD02', welders: ['AB', 'X'], point: null, workArea: '未分配' },
    { id: 'd', unit: 'PD02', welders: [], point: [4,2,3], workArea: '泵组 A' },
  ]
  const all = groupHistory(rows)
  assert.equal(all.summary.workers, 3); assert.equal(all.summary.locatedWorkers, 2)
  assert.equal(all.summary.welds, 4); assert.equal(all.summary.missingWelder, 1)
  assert.equal(all.workers.find(worker => worker.id === '0015').records.length, 2)
  assert.equal(all.workers.find(worker => worker.id === '0015').workfaces.length, 2)
  assert.equal(groupHistory(rows, 'PD03').summary.workers, 1)
  assert.equal(groupHistory([]).summary.workers, 0)
})

test('calendar playback includes empty days and clamps at both boundaries', () => {
  const days = ['2026-03-19', '2026-03-20', '2026-03-21']
  assert.equal(nextHistoryDate(days, days[0], -1), days[0])
  assert.equal(nextHistoryDate(days, days[0], 1), days[1])
  assert.equal(nextHistoryDate(days, days[2], 1), days[2])
})

test('standalone diesel daily counts and model anchors agree with exported component geometry bounds', () => {
  const manifest = JSON.parse(fs.readFileSync('public/data/diesel-history/manifest.json', 'utf8'))
  assert.equal(manifest.audit.uniqueRecords, 57822)
  assert.equal(manifest.audit.datedRecords, 35462)
  assert.equal(manifest.audit.locatedWithWelder + manifest.audit.unlocatedWithWelder + manifest.audit.datedMissingWelder, manifest.audit.datedRecords)
  const day = JSON.parse(fs.readFileSync(`public/data/diesel-history/days/${manifest.initialDate}.json`, 'utf8'))
  const group = groupHistory(day.records), summary = manifest.daily[manifest.initialDate]
  assert.equal(group.summary.workers, summary.workers)
  assert.equal(group.summary.locatedWorkers, summary.locatedWorkers)
  assert.equal(group.summary.welds, summary.welds)
  assert.equal(new Set(group.workers.map(worker => worker.id)).size, group.workers.length)
  assert.ok(group.workers.some(worker => worker.id === '0015'))
  const index = JSON.parse(fs.readFileSync('public/data/diesel-ep3d/ALL/index.json', 'utf8'))
  const objects = new Map(index.objects.map(row => [row[0], row]))
  for (const record of day.records.filter(record => record.point)) {
    const object = objects.get(record.componentIds[0]), b = object[6]
    assert.equal(object[4], true); assert.equal(object[9], record.unit)
    assert.equal(index.lines[object[1]], record.line)
    assert.ok([record.weld, record.initialWeld].includes(object[3]))
    const point = [(b[0]+b[3])/2, (b[2]+b[5])/2, -(b[1]+b[4])/2]
    assert.ok(Math.hypot(...point.map((value, i) => value - record.point[i])) < 1e-5, 'Y-up source bounds must land on the same weld after the Z-up tile transform')
    assert.ok(record.componentIds.every(id => objects.has(id)))
  }
  for (const row of index.objects.filter(row => day.records.some(record => record.componentIds.includes(row[0])))) {
    assert.ok(fs.existsSync(`public/data/diesel-ep3d/${row[9]}/properties-${row[7]}.json`))
  }
})
