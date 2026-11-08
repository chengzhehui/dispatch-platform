import * as THREE from 'three'
import { TilesRenderer } from '3d-tiles-renderer'
import { GLTFExtensionsPlugin } from '3d-tiles-renderer/plugins'
import { DispatchScene } from './DispatchScene.js'
import { Ep3dModel, findBatchTable, getBatchAttribute, normalizeGeometryId } from './Ep3dModel.js'
import { createSite } from '../domain.js'
import { createWorker, preloadWorker } from './worker.js'
import { createWeldTask } from '../welding.js'
import { groupHistory, nextHistoryDate, buildHistorySchedule, sampleHistorySchedule } from '../history.js'

async function json(url) { const response = await fetch(url); if (!response.ok) throw new Error(`历史派工数据加载失败：${response.status}`); return response.json() }

export class DieselHistoryScene extends DispatchScene {
  constructor(host, onState, onMessage) {
    super(host, onState, onMessage)
    this.ep3d.dispose()
    this.ep3d = new Ep3dModel(() => this.emit(), { manifestUrl: '/data/diesel-ep3d/manifest.json', propertiesRoot: '/data/diesel-ep3d', acceptAllTiles: true })
    this.unit = 'ALL'; this.workerController.readOnly = true
    this.historyManifest = null; this.historyDate = ''; this.dayRecords = []; this.dayCache = new Map(); this.historyVersion = 0
    this.historyLoading = false; this.historyError = ''; this.playing = false; this.playbackSeconds = 4; this.dateElapsed = 0
    this.walkSpeed = 120; this.speed = 120; this.dayDuration = 4; this.carryDate = ''; this.carryPositions = new Map(); this.historyGroups = groupHistory([]); this.historyDisposed = false
    this.hideStaging = true; this.gridVisible = false; this.showDesignModels = false; this.lastDesignVisibility = false; this.designMeshes = new Map()
    this.workfaces = new THREE.Group(); this.scene.add(this.workfaces)
    this.onState = state => onState({ ...state, history: this.historyState() })
  }
  async init() {
    this.historyManifest = await json('/data/diesel-history/manifest.json')
    const box = this.historyManifest.modelBox
    for (const unit of ['ALL', ...this.historyManifest.units]) this.sites[unit] = createSite(box, this.size, 0)
    try { await preloadWorker(); this.workerAssetReady = true } catch { this.onMessage('本地人物模型加载失败，显示简化人物') }
    await this.loadUnit('ALL')
    await this.setDate(this.historyManifest.initialDate)
  }
  async loadUnit(unit, { force = false } = {}) {
    if (!this.sites[unit] || (!force && this.tiles && this.unit === unit)) return false
    this.setCameraMode('review'); this.followedId = null; this.unit = unit; this.site = this.sites[unit]; this.selected.clear()
    const metadata = this.ep3d.loadUnit(unit)
    if (!this.tiles || force) {
      this.ep3d.clearTiles()
      if (this.tiles) { this.scene.remove(this.tiles.group); this.tiles.dispose() }
      this.generation++; this.loaded = 0; this.errors = 0
      const tiles = new TilesRenderer(this.historyManifest.modelUrl); this.tiles = tiles
      tiles.errorTarget = 32; tiles.downloadQueue.maxJobs = 4; tiles.parseQueue.maxJobs = 1
      tiles.lruCache.maxSize = 1200; tiles.lruCache.minSize = 800
      tiles.lruCache.maxBytesSize = 768 * 1024 * 1024; tiles.lruCache.minBytesSize = 512 * 1024 * 1024
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: this.draco, autoDispose: false }))
      tiles.group.rotation.x = -Math.PI / 2
      tiles.group.position.set(-this.site.origin[0], -this.site.origin[1], -this.site.origin[2]); tiles.group.updateMatrixWorld(true)
      tiles.setCamera(this.camera); tiles.setResolutionFromRenderer(this.camera, this.renderer)
      tiles.addEventListener('load-model', event => { if (this.tiles !== tiles) return; this.loaded++; event.scene.userData.dispatchEp3d = true; this.applyDesignVisibility(event.scene); this.ep3d.attachTile(event.scene, event.url || '') })
      tiles.addEventListener('dispose-model', event => { event.scene.traverse(mesh => this.designMeshes.delete(mesh)); this.ep3d.detachTile(event.scene) })
      tiles.addEventListener('load-error', () => { if (this.tiles === tiles) { this.errors++; this.onMessage('柴油项目部分模型加载失败，可重新加载') } })
      this.scene.add(tiles.group)
    }
    this.rebuildSite(); this.overview()
    this.world.children[0].position.y = this.historyManifest.modelBox[2] - this.historyManifest.modelBox[11] - 1
    this.rebuildWorkers(); this.emit(); await metadata
    if (unit !== 'ALL' && this.historyGroups.records.some(record => record.point)) {
      const box = new THREE.Box3().setFromPoints(this.historyGroups.records.filter(record => record.point).map(record => new THREE.Vector3(...record.point).sub(new THREE.Vector3(...this.site.origin))))
      this.controls.focusBounds(box.expandByScalar(2))
    }
    if (this.unit === 'ALL') for (const root of this.ep3d.roots.keys()) this.applyDesignVisibility(root)
    return true
  }
  async setDate(day) {
    if (!this.historyManifest.dates.includes(day)) return
    const version = ++this.historyVersion
    if (!this.historyLoading) { this.carryDate = this.historyDate; this.carryPositions = new Map(this.workers.map(worker => [worker.id, [...worker.position]])) }
    const adjacent = !!this.carryDate && this.historyManifest.dates.indexOf(day) === this.historyManifest.dates.indexOf(this.carryDate) + 1
    const starts = adjacent ? new Map(this.carryPositions) : new Map()
    const followed = adjacent && this.cameraMode === 'worker' ? this.followedId : null
    this.historyDate = day; this.historyLoading = true; this.historyError = ''; this.dateElapsed = 0
    this.setCameraMode('review'); this.ep3d.clearSelection(); this.dayRecords = []; this.rebuildWorkers(); this.emit()
    try {
      if (!this.dayCache.has(day)) this.dayCache.set(day, this.historyManifest.daily[day] ? json(`/data/diesel-history/days/${day}.json`).catch(error => { this.dayCache.delete(day); throw error }) : Promise.resolve({ records: [] }))
      const data = await this.dayCache.get(day)
      if (version !== this.historyVersion || this.historyDisposed) return
      this.dayRecords = data.records; this.historyLoading = false; this.rebuildWorkers(starts); if (followed && this.workers.some(worker => worker.id === followed)) this.setCameraMode('worker', followed); this.emit()
      this.onMessage(`${day} · ${this.historyGroups.summary.workers} 名盖面焊工 · ${this.historyGroups.summary.welds} 道焊口 · 历史作业示意`)
    } catch (error) { if (version === this.historyVersion && !this.historyDisposed) { this.historyLoading = false; this.historyError = error.message; this.playing = false; this.emit() } }
  }
  rebuildSite() {
    super.rebuildSite()
    for (const child of this.world.children) if (child.name.startsWith('dispatch-staging')) child.visible = false
    this.stagingLabel.visible = false
    if (this.historyManifest) this.world.children[0].position.y = this.historyManifest.modelBox[2] - this.historyManifest.modelBox[11] - 1
  }
  rebuildWorkers(starts = new Map()) {
    for (const worker of this.workers) { this.scene.remove(worker.visual.root, worker.visual.path); this.disposeWorker(worker) }
    this.workers = []; this.selected.clear(); this.followedId = null
    this.historyGroups = groupHistory(this.dayRecords, this.unit)
    for (const group of this.historyGroups.workers) {
      if (!group.located.length) continue
      const worker = { id: group.id, unit: this.unit, position: [0, 0, 0], target: null, visual: createWorker(group.id), queue: group.located, queueIndex: -1, completedCount: 0, historyMoving: false }
      worker.tasks = group.located.map(record => this.createHistoryTask(worker.id, record))
      this.workers.push(worker); this.scene.add(worker.visual.root, worker.visual.path)
    }
    this.replanDay(starts)
    this.updateVisibility(); this.updateWorkfaces()
    if (this.stagingLabel) this.stagingLabel.visible = false
  }
  createHistoryTask(id, record) {
    const point = record.point.map((value, axis) => value - this.site.origin[axis])
    const angle = (id.split('').reduce((n, char) => n + char.charCodeAt(0), 0) % 16) * Math.PI / 8
    const object = { id: record.componentIds[0], unit: this.unit, line: record.line, label: record.weld, isWeld: true, diameter: record.diameter, fingerprint: record.id }
    const task = createWeldTask(object, point, [point[0] - Math.sin(angle) * 2, point[1], point[2] - Math.cos(angle) * 2])
    if (point[1] < .1) task.station[1] = point[1] - .65
    return { ...task, recordId: record.id, sourceUnit: record.unit, workArea: record.workArea }
  }
  replanDay(starts = new Map(this.workers.map(worker => [worker.id, [...worker.position]]))) {
    this.dayPlan = buildHistorySchedule(this.workers.map(worker => ({ id: worker.id, stops: worker.tasks.map(task => task.station), start: starts.get(worker.id) })), this.playbackSeconds, this.walkSpeed)
    this.dayDuration = this.dayPlan.duration; this.dateElapsed = 0; this.scheduleJustReset = true
    for (const worker of this.workers) { worker.route = this.dayPlan.routes.get(worker.id); worker.queueIndex = -1; this.updateWorkerSchedule(worker) }
  }
  updateWorkerSchedule(worker) {
    const sample = sampleHistorySchedule(worker.route, this.dateElapsed)
    const previousIndex = worker.queueIndex, previousWeld = worker.weldTask?.weldId
    worker.queueIndex = sample.index; worker.completedCount = sample.completed; worker.historyMoving = sample.phase === 'walking'
    worker.weldTask = { ...worker.tasks[sample.index], status: sample.phase === 'walking' ? 'approaching' : sample.phase, elapsed: sample.elapsed }
    worker.position = sample.position
    const slot = worker.route.slots[sample.index]
    worker.visual.root.rotation.y = worker.historyMoving ? Math.atan2(slot.to[0] - slot.from[0], slot.to[2] - slot.from[2]) : worker.weldTask.heading
    worker.visual.root.position.fromArray(worker.position)
    if (previousWeld && previousIndex !== sample.index && this.selected.has(worker.id) && this.ep3d.selected?.id === previousWeld) void this.ep3d.select(worker.weldTask.weldId)
  }
  setPlaybackSeconds(value) { this.playbackSeconds = Math.max(1, Number(value) || 4); this.replanDay(); this.emit() }
  setWalkSpeed(value) { this.walkSpeed = Math.max(1, Number(value) || 120); this.speed = this.walkSpeed; this.replanDay(); this.emit() }
  toggleDatePlayback() {
    this.playing = !this.playing
    if (this.playing && this.dateElapsed >= this.dayDuration) this.replanDay()
    this.emit()
  }
  historyState() {
    return { manifest: this.historyManifest, date: this.historyDate, loading: this.historyLoading, error: this.historyError,
      playing: this.playing, playbackSeconds: this.playbackSeconds, dayDuration: this.dayDuration, dayElapsed: this.dateElapsed, walkSpeed: this.walkSpeed, summary: this.historyGroups.summary,
      projectSummary: groupHistory(this.dayRecords).summary,
      unitCounts: Object.fromEntries((this.historyManifest?.units || []).map(unit => [unit, groupHistory(this.dayRecords, unit).summary.workers])),
      workers: this.historyGroups.workers.map(group => {
        const actor = this.workers.find(worker => worker.id === group.id)
        return { ...group, activeRecordId: actor?.weldTask?.status !== 'completed' ? actor?.weldTask?.recordId : '', phase: actor?.weldTask?.status,
          completedRecordIds: group.located.slice(0, actor?.completedCount || 0).map(record => record.id), omittedRecordIds: actor ? group.located.slice(actor.route.slots.length).map(record => record.id) : [], slotSeconds: actor?.route?.slotSeconds || 0, weldSeconds: actor?.route?.weldSeconds || 0 }
      }) }
  }
  select(ids, additive = false) { super.select(ids, additive); if (this.workfaces) this.updateWorkfaces() }
  updateWorkfaces() {
    this.clearGroup(this.workfaces)
    const records = this.historyGroups.records.filter(record => record.point && (!this.selected.size || record.welders.some(id => this.selected.has(id))))
    if (!records.length) return
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(records.flatMap(record => record.point.map((value, axis) => value - this.site.origin[axis])), 3))
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: this.selected.size ? 0x66f0dc : 0xffc56c, size: .22, depthTest: true, transparent: true, opacity: .9 }))
    points.raycast = () => {}; this.workfaces.add(points)
  }
  focusHistoricalWorker(id) {
    const worker = this.workers.find(worker => worker.id === id)
    if (!worker) { this.select([]); this.ep3d.clearSelection(); this.onMessage(`盖面焊工 ${id} 当日记录暂未匹配模型，不显示虚构人物位置`); return }
    this.setCameraMode('review'); this.select([id])
    const record = worker.queue[worker.queueIndex]
    if (record.componentIds.length) this.selectComponent(record.componentIds[0])
    const center = new THREE.Vector3(...worker.position).add(new THREE.Vector3(0, 1, 0))
    this.controls.focusBounds(new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(2, 2.5, 2)))
    this.onMessage(`盖面焊工 ${id} · ${record.workArea} · ${record.line} / ${record.weld}`)
  }
  focusHistoryRecord(id) { const record = this.historyGroups.records.find(record => record.id === id); if (record?.point && record.componentIds.length) this.focusComponent(record.componentIds[0]) }
  selectComponent(id) { super.selectComponent(id, { assign: false }) }
  applyDesignVisibility(root) {
    const known = this.ep3d.cache.get('ALL')?.byGeometry
    if (!known) return
    root.traverse(mesh => {
      const batch = getBatchAttribute(mesh.geometry), table = findBatchTable(mesh)
      if (!mesh.isMesh || !batch || !table) return
      let state = this.designMeshes.get(mesh)
      if (!state) {
        const geometry = mesh.geometry, original = geometry.getIndex(), count = original ? original.count : geometry.attributes.position.count
        const matches = new Map(), indices = []
        for (let offset = 0; offset + 2 < count; offset += 3) {
          const vertex = n => original ? original.getX(offset + n) : offset + n
          const id = Math.round(batch.getX(vertex(0)))
          if (!matches.has(id)) matches.set(id, known.has(normalizeGeometryId(table.getDataFromId(id)?.componentId)))
          if (matches.get(id)) indices.push(vertex(0), vertex(1), vertex(2))
        }
        state = { original, pipeIndex: new THREE.BufferAttribute(geometry.attributes.position.count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1), applied: null }
        this.designMeshes.set(mesh, state)
      }
      if (state.applied === this.showDesignModels) return
      mesh.geometry.dispose(); mesh.geometry.setIndex(this.showDesignModels ? state.original : state.pipeIndex)
      state.applied = this.showDesignModels
      const record = this.ep3d.meshRecords.get(mesh)
      if (record) { this.ep3d.removeOverlay(record); record.ranges = null }
    })
    if (this.ep3d.selected) this.ep3d.highlightRecords([...this.ep3d.meshRecords.values()])
  }
  bindSelectedToWeld() { this.onMessage('历史派工界面按台账展示，不修改焊工与焊缝绑定'); return false }
  command() { this.onMessage('历史派工界面仅供回放，不接受移动派工指令') }
  stop() { this.onMessage('可通过“暂停动作”暂停历史作业示意') }
  setCount() {}
  persist() {}
  restore() { return true }
  frame(time) {
    const dt = this.scheduleJustReset ? 0 : Math.max(0, (time - this.last) / 1000)
    this.scheduleJustReset = false
    if (this.tiles && this.showDesignModels !== this.lastDesignVisibility) {
      for (const root of this.ep3d.roots.keys()) this.applyDesignVisibility(root)
      this.lastDesignVisibility = this.showDesignModels
    }
    if (this.historyManifest && !this.historyLoading && !this.historyDisposed) {
      if (!this.paused) {
        this.dateElapsed = Math.min(this.dayDuration, this.dateElapsed + dt)
        for (const worker of this.workers) this.updateWorkerSchedule(worker)
      }
      if (this.playing && !this.paused && this.dateElapsed >= this.dayDuration) {
        const next = nextHistoryDate(this.historyManifest.dates, this.historyDate, 1)
        if (next === this.historyDate) { this.playing = false; this.emit() } else void this.setDate(next)
      }
    }
    super.frame(time)
    if (this.stagingLabel) this.stagingLabel.visible = false
  }
  dispose() { this.historyDisposed = true; this.historyVersion++; this.clearGroup(this.workfaces); this.scene.remove(this.workfaces); super.dispose() }
}
