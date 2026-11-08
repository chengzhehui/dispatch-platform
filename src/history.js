export function groupHistory(records, unit = 'ALL') {
  const filtered = records.filter(record => unit === 'ALL' || record.unit === unit)
  const byWorker = new Map()
  for (const record of filtered) for (const id of new Set(record.welders)) {
    if (!byWorker.has(id)) byWorker.set(id, { id, records: [], located: [], workfaces: [] })
    const worker = byWorker.get(id); worker.records.push(record)
    if (Array.isArray(record.point) && record.point.length === 3 && record.point.every(Number.isFinite)) worker.located.push(record)
  }
  const workers = [...byWorker.values()].sort((a, b) => a.id.localeCompare(b.id))
  for (const worker of workers) {
    const faces = new Map()
    for (const record of worker.records) {
      const key = `${record.unit}|${record.workArea}`
      if (!faces.has(key)) faces.set(key, { unit: record.unit, label: record.workArea, count: 0, located: 0 })
      faces.get(key).count++; if (record.point) faces.get(key).located++
    }
    worker.workfaces = [...faces.values()]
  }
  return { records: filtered, workers, summary: { workers: workers.length, locatedWorkers: workers.filter(worker => worker.located.length).length,
    welds: filtered.length, locatedWelds: filtered.filter(record => record.point).length, missingWelder: filtered.filter(record => !record.welders.length).length } }
}

export function nextHistoryDate(dates, current, direction) {
  const index = dates.indexOf(current)
  return dates[Math.max(0, Math.min(dates.length - 1, index + direction))]
}

// A fixed day budget supplies at most one display slot per second. Walking is
// part of each slot; omitted welds stay in the source records and statistics.
export function buildHistorySchedule(workers, requestedSeconds = 4, walkSpeed = 120) {
  const speed = Math.max(1, Number(walkSpeed) || 120)
  const duration = Math.max(1, Number(requestedSeconds) || 4)
  const routes = workers.filter(worker => worker.stops.length).map(worker => {
    const count = Math.min(worker.stops.length, Math.floor(duration))
    const slotSeconds = duration / count
    let from = worker.start || worker.stops[0]
    const slots = worker.stops.slice(0, count).map((to, index) => {
      const distance = Math.hypot(...to.map((value, i) => value - from[i]))
      // Keep walking visible, but leave most of the fixed slot for welding.
      const travel = distance > .001 ? Math.min(Math.max(.12, distance / speed), slotSeconds * .25) : 0
      const slot = { from: [...from], to: [...to], travel, index, start: index * slotSeconds, weldStart: index * slotSeconds + travel, end: (index + 1) * slotSeconds }
      from = to; return slot
    })
    return [worker.id, { slots, slotSeconds, weldSeconds: Math.min(...slots.map(slot => slot.end - slot.weldStart)), duration, omittedCount: worker.stops.length - count }]
  })
  return { duration, requested: duration, speed, routes: new Map(routes) }
}

export function sampleHistorySchedule(route, elapsed) {
  const time = Math.max(0, elapsed), last = route.slots.at(-1)
  if (time >= route.duration) return { index: last.index, phase: 'completed', position: [...last.to], completed: route.slots.length, elapsed: last.end - last.weldStart }
  const slot = route.slots.find(slot => time < slot.end) || last
  if (time < slot.weldStart && slot.travel > 0) {
    const t = Math.max(0, Math.min(1, (time - slot.start) / slot.travel))
    return { index: slot.index, phase: 'walking', position: slot.from.map((value, i) => value + (slot.to[i] - value) * t), completed: slot.index, elapsed: 0 }
  }
  return { index: slot.index, phase: 'welding', position: [...slot.to], completed: slot.index, elapsed: Math.max(0, time - slot.weldStart) }
}
