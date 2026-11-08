export const UNIT_IDS = ['213', '27', '37', '38', '39']
export const MAX_WORKERS = 200
// Source model elevations, measured from broad, shallow background-platform tiles.
export const GROUND_ELEVATIONS = { '213': 81.105, '27': 73, '37': 73.125, '38': 73, '39': 73 }
export function createSite(box, size = 50, groundElevation = box[2] - box[11]) {
  const width = box[3] * 2, depth = box[7] * 2, height = Math.max(0.1, box[2] + box[11] - groundElevation)
  return { sourceBox: [...box], groundElevation, width, depth, height, origin: [box[0], groundElevation, -box[1]], minX: -width / 2, minZ: -depth / 2, nx: Math.max(1, Math.ceil(width / size)), nz: Math.max(1, Math.ceil(depth / size)), ny: Math.max(1, Math.ceil(height / size)), size }
}
export function zoneAt(position, site) {
  const [x, y, z] = position, { minX, minZ, width, depth, ny, size } = site
  if (x < minX || x >= minX + width || z < minZ || z >= minZ + depth || y < 0 || y >= ny * size) return null
  return `${String.fromCharCode(65 + Math.floor((z - minZ) / size))}${Math.floor((x - minX) / size) + 1}-${Math.floor(y / size) + 1}`
}
export function zonesFor(site) {
  const zones = []
  for (let y = 0; y < site.ny; y++) for (let z = 0; z < site.nz; z++) for (let x = 0; x < site.nx; x++) zones.push({ id: `${String.fromCharCode(65 + z)}${x + 1}-${y + 1}`, layer: y, x, z, count: 0 })
  return zones
}
export function stagingPosition(index, site) {
  return [site.minX - 13 - Math.floor(index / 10) * 2.6, 0.1, site.minZ + 8 + (index % 10) * 2.6]
}
export function moveTowards(position, target, step) {
  const distance = Math.hypot(...target.map((v, i) => v - position[i]))
  if (distance <= step) return { position: [...target], arrived: true }
  return { position: position.map((v, i) => v + (target[i] - v) * step / distance), arrived: false }
}
export function formationTargets(center, count, site) {
  const columns = Math.ceil(Math.sqrt(count)), spacing = 2.2
  const rows = Math.ceil(count / columns)
  const halfWidth = (columns - 1) * spacing / 2, halfDepth = (rows - 1) * spacing / 2
  const anchorX = Math.max(site.minX + halfWidth + 0.1, Math.min(site.minX + site.width - halfWidth - 0.1, center[0]))
  const anchorZ = Math.max(site.minZ + halfDepth + 0.1, Math.min(site.minZ + site.depth - halfDepth - 0.1, center[2]))
  const result = []
  for (let i = 0; i < count; i++) {
    const x = anchorX + ((i % columns) - (columns - 1) / 2) * spacing
    const z = anchorZ + (Math.floor(i / columns) - (rows - 1) / 2) * spacing
    result.push([Math.min(site.minX + site.width - 0.1, Math.max(site.minX + 0.1, x)), center[1], Math.min(site.minZ + site.depth - 0.1, Math.max(site.minZ + 0.1, z))])
  }
  return result
}
