import * as THREE from 'three'
const pulseColor = new THREE.Color(0xffffff)

// Adapted from three-demo's batch-face picking and multi-geometry selection.
export function getBatchAttribute(geometry) {
  return geometry?.getAttribute('_BATCHID') || geometry?.getAttribute('_batchid') || geometry?.getAttribute('BATCHID')
}
export function findBatchTable(object) {
  for (let current = object; current; current = current.parent) {
    const table = current.batchTable || current.userData?.batchTable
    if (table) return table
  }
  return null
}
export function normalizeGeometryId(value) {
  return String(value || '').trim().split('/').filter(Boolean).at(-1) || ''
}
export function geometryIdAtFace(mesh, faceIndex) {
  const geometry = mesh.geometry, batch = getBatchAttribute(geometry), table = findBatchTable(mesh)
  if (!batch || !table || !Number.isInteger(faceIndex)) return null
  const index = geometry.getIndex(), start = faceIndex * 3
  const vertices = [0, 1, 2].map(offset => index ? index.getX(start + offset) : start + offset)
  const values = vertices.map(vertex => Math.round(batch.getX(vertex)))
  if (!values.every(value => value === values[0])) return null
  return normalizeGeometryId(table.getDataFromId(values[0])?.componentId) || null
}
export function localBounds(bounds, site) {
  if (!bounds) return null
  return new THREE.Box3(
    new THREE.Vector3(bounds[0] - site.origin[0], bounds[2] - site.origin[1], -bounds[4] - site.origin[2]),
    new THREE.Vector3(bounds[3] - site.origin[0], bounds[5] - site.origin[1], -bounds[1] - site.origin[2]),
  )
}

async function json(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`EP3D 数据读取失败：${response.status}`)
  return response.json()
}

export class Ep3dModel {
  constructor(onChange, { manifestUrl = '/data/ep3d/manifest.json', propertiesRoot = '/data/ep3d', acceptAllTiles = false } = {}) {
    this.onChange = onChange
    this.manifestUrl = manifestUrl; this.propertiesRoot = propertiesRoot; this.acceptAllTiles = acceptAllTiles
    this.unit = '213'; this.loading = false; this.error = ''; this.selected = null
    this.manifest = null; this.cache = new Map(); this.requests = new Map(); this.propertyRequests = new Map()
    this.roots = new Map(); this.meshRecords = new Map(); this.selectionVersion = 0
  }

  async loadUnit(unit) {
    this.unit = unit; this.loading = true; this.error = ''; this.selected = null; this.selectionVersion++
    this.clearHighlights(); this.onChange()
    try {
      if (!this.manifest) this.manifest = await json(this.manifestUrl)
      const entry = this.manifest.units[unit]
      if (entry && !this.cache.has(unit)) {
        if (!this.requests.has(unit)) this.requests.set(unit, json(entry.url).then(data => {
          const byId = new Map(), byGeometry = new Map(), welds = [], lines = new Map()
          for (const row of data.objects) {
            const [id, lineId, kind, label, isWeld, geometryIds, bounds, shard, diameter] = row
            const object = { id, unit, sourceUnit: row[9] || unit, propertyUnit: row[9] || unit, line: data.lines[lineId], kind, label, isWeld, geometryIds, bounds, shard, diameter, fingerprint: geometryIds.join('|') }
            byId.set(id, object)
            if (!lines.has(object.line)) lines.set(object.line, { id: object.line, label: object.line || '未命名管线', objects: [], weldCount: 0 })
            const line = lines.get(object.line); line.objects.push(object); if (isWeld) line.weldCount++
            for (const geometryId of geometryIds) byGeometry.set(geometryId, object)
            if (isWeld && bounds) welds.push(object)
          }
          this.cache.set(unit, { byId, byGeometry, welds, lines: [...lines.values()].sort((a, b) => a.label.localeCompare(b.label)), columns: data.columns })
        }).catch(error => { this.requests.delete(unit); throw error }))
        await this.requests.get(unit)
      }
    } catch (error) { if (this.unit === unit) this.error = error.message }
    if (this.unit === unit) { this.loading = false; this.onChange() }
  }

  getObject(unit, id) { return this.cache.get(unit)?.byId.get(id) || null }
  tree(query = '') {
    const lines = this.cache.get(this.unit)?.lines || []
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return lines
    return lines.map(line => {
      const objects = line.objects.filter(object => terms.every(term => `${object.unit} ${object.sourceUnit} ${object.line} ${object.kind} ${object.label} ${object.id}`.toLowerCase().includes(term)))
      return objects.length ? { ...line, objects, weldCount: objects.filter(object => object.isWeld).length } : null
    }).filter(Boolean)
  }

  attachTile(root, url) {
    if (!this.acceptAllTiles && !/(^|[/\\])ep3d[/\\]/i.test(url)) return
    const records = []
    root.traverse(mesh => {
      if (!mesh.isMesh || !getBatchAttribute(mesh.geometry) || !findBatchTable(mesh)) return
      const record = { mesh, ranges: null, overlay: null }
      records.push(record); this.meshRecords.set(mesh, record)
    })
    this.roots.set(root, records)
    if (this.selected) this.highlightRecords(records)
  }

  detachTile(root) {
    for (const record of this.roots.get(root) || []) { this.removeOverlay(record); this.meshRecords.delete(record.mesh) }
    this.roots.delete(root)
  }

  pick(raycaster, tilesGroup) {
    for (const hit of raycaster.intersectObjects(tilesGroup.children, true)) {
      if (!this.meshRecords.has(hit.object)) continue
      let visible = true
      for (let parent = hit.object; parent; parent = parent.parent) if (!parent.visible) { visible = false; break }
      if (!visible) continue
      const geometryId = geometryIdAtFace(hit.object, hit.faceIndex)
      if (!geometryId) continue
      const object = this.cache.get(this.unit)?.byGeometry.get(geometryId)
      if (object) return { object, geometryId, point: hit.point }
      if (this.loading) return { loading: true }
    }
    return null
  }

  async select(id) {
    const object = this.getObject(this.unit, id)
    if (!object) return null
    const version = ++this.selectionVersion
    this.selected = { ...object, properties: [], loading: true, propertyError: '' }
    this.clearHighlights()
    this.highlightRecords([...this.meshRecords.values()])
    this.onChange()
    try {
      const url = `${this.propertiesRoot}/${object.propertyUnit || object.unit}/properties-${object.shard}.json`
      if (!this.propertyRequests.has(url)) this.propertyRequests.set(url, json(url).catch(error => { this.propertyRequests.delete(url); throw error }))
      const shard = await this.propertyRequests.get(url)
      if (this.selectionVersion !== version) return object
      const columns = this.cache.get(object.unit).columns
      this.selected.properties = (shard[id] || []).map(([column, value]) => ({ set: columns[column].set, name: columns[column].name, value: String(value) }))
    } catch (error) { if (this.selectionVersion === version) this.selected.propertyError = error.message }
    if (this.selectionVersion === version) { this.selected.loading = false; this.onChange() }
    return object
  }

  clearSelection() {
    this.selectionVersion++; this.selected = null
    this.clearHighlights(); this.onChange()
  }

  indexRanges(record) {
    if (record.ranges) return record.ranges
    const geometry = record.mesh.geometry, batch = getBatchAttribute(geometry), index = geometry.getIndex(), table = findBatchTable(record.mesh)
    const count = index ? index.count : geometry.attributes.position.count
    const ranges = new Map(), ids = new Map()
    let previousId = null, previousRange = null
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const vertex = n => index ? index.getX(offset + n) : offset + n
      const id = Math.round(batch.getX(vertex(0)))
      if (id !== Math.round(batch.getX(vertex(1))) || id !== Math.round(batch.getX(vertex(2)))) { previousId = null; continue }
      if (!ids.has(id)) ids.set(id, normalizeGeometryId(table.getDataFromId(id)?.componentId))
      const geometryId = ids.get(id)
      if (!geometryId) continue
      if (geometryId === previousId && previousRange[1] === offset) previousRange[1] = offset + 3
      else {
        previousRange = [offset, offset + 3]
        if (!ranges.has(geometryId)) ranges.set(geometryId, [])
        ranges.get(geometryId).push(previousRange)
      }
      previousId = geometryId
    }
    record.ranges = ranges
    return ranges
  }

  highlightRecords(records) {
    if (!this.selected) return
    for (const record of records) {
      if (record.overlay) continue
      const ranges = this.indexRanges(record), geometry = record.mesh.geometry, index = geometry.getIndex(), position = geometry.attributes.position
      const vertices = []
      for (const id of this.selected.geometryIds) for (const [start, end] of ranges.get(id) || []) {
        for (let offset = start; offset < end; offset++) {
          const vertex = index ? index.getX(offset) : offset
          vertices.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex))
        }
      }
      if (!vertices.length) continue
      const overlayGeometry = new THREE.BufferGeometry()
      overlayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      // Match three-demo: highlight visible surfaces without drawing through equipment.
      const material = new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false })
      const overlay = new THREE.Mesh(overlayGeometry, material)
      overlay.name = 'ep3d-component-highlight'; overlay.renderOrder = 30; overlay.raycast = () => {}
      record.mesh.add(overlay); record.overlay = overlay
      // TilesGroup deliberately skips unchanged subtrees. A highlight added after
      // a tile is loaded must inherit its world transform before the next draw.
      overlay.updateWorldMatrix(true, false)
    }
  }

  removeOverlay(record) { if (record.overlay) { record.mesh.remove(record.overlay); record.overlay.geometry.dispose(); record.overlay.material.dispose(); record.overlay = null } }
  updatePulse(time, reducedMotion = false) {
    const pulse = reducedMotion ? 0.75 : (Math.sin(time / 260) + 1) / 2
    for (const record of this.meshRecords.values()) {
      if (!record.overlay) continue
      const material = record.overlay.material
      // Pulse color as well as alpha: duplicate ADD LOD surfaces can accumulate alpha.
      material.color.set(0x2563eb).lerp(pulseColor, 0.6 * pulse)
      material.opacity = 0.35 + 0.55 * pulse
    }
  }
  clearHighlights() { for (const record of this.meshRecords.values()) this.removeOverlay(record) }
  clearTiles() { for (const root of [...this.roots.keys()]) this.detachTile(root) }
  state() {
    const entry = this.manifest?.units[this.unit]
    return { available: !!entry, ready: this.cache.has(this.unit), loading: this.loading, error: this.error, weldCount: entry?.locatableWelds || 0, componentCount: entry?.components || 0, selectionVersion: this.selectionVersion, selected: this.selected }
  }
  dispose() { this.selectionVersion++; this.clearTiles() }
}
