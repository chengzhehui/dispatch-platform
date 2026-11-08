export function createWeldTask(object, point, workerPosition) {
  if (!object?.isWeld || !point.every(Number.isFinite)) throw new Error('请选择有定位信息的 EP3D 焊缝')
  let dx = point[0] - workerPosition[0], dz = point[2] - workerPosition[2]
  const length = Math.hypot(dx, dz)
  if (length < 0.001) { dx = 0; dz = 1 } else { dx /= length; dz /= length }
  const diameter = Number.parseFloat(object.diameter) || 0
  const distance = Math.min(2, Math.max(0.75, diameter / 2000 + 0.6))
  const footHeight = point[1] > 1.9 ? point[1] - 1.15 : 0.1
  return {
    weldId: object.id, unit: object.unit, line: object.line, name: object.label,
    fingerprint: object.fingerprint, status: 'approaching', elapsed: 0,
    point: [...point], station: [point[0] - dx * distance, footHeight, point[2] - dz * distance],
    heading: Math.atan2(dx, dz), crouch: point[1] - footHeight < 1,
  }
}

export function weldOwner(workers, unit, weldId, exceptId = null) {
  return workers.find(worker => worker.id !== exceptId && worker.weldTask?.unit === unit && worker.weldTask?.weldId === weldId) || null
}

export function restoreWeldTask(saved, object) {
  if (!saved || !object?.isWeld || saved.unit !== object.unit || saved.weldId !== object.id || saved.fingerprint !== object.fingerprint) return null
  if (!['approaching', 'welding'].includes(saved.status) || !Number.isFinite(saved.heading) || !Number.isFinite(saved.elapsed) || saved.elapsed < 0) return null
  if (![saved.point, saved.station].every(point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite))) return null
  return { ...saved, line: object.line, name: object.label }
}
