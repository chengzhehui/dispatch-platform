import * as THREE from 'three'
import { ReviewCameraControls } from './ReviewCameraControls.js'
import { WorkerController, advanceJump, isEditing } from './WorkerController.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { TilesRenderer } from '3d-tiles-renderer'
import { GLTFExtensionsPlugin } from '3d-tiles-renderer/plugins'
import { createSite, zoneAt, zonesFor, stagingPosition, moveTowards, formationTargets, MAX_WORKERS, GROUND_ELEVATIONS } from '../domain.js'
import { createWorker, preloadWorker } from './worker.js'
import { MoveCommandEffects } from './MoveCommandEffects.js'
import { Ep3dModel, localBounds } from './Ep3dModel.js'
import { createWeldTask, restoreWeldTask, weldOwner } from '../welding.js'

export class DispatchScene {
  constructor(host, onState, onMessage) {
    this.host = host; this.onState = onState; this.onMessage = onMessage
    this.workers = []; this.selected = new Set(); this.unit = '213'; this.size = 50; this.layer = 0; this.speed = 16; this.paused = false; this.sites = {}; this.loaded = 0; this.generation = 0; this.errors = 0; this.gridVisible = true
    this.nextWorkerNumber = 1; this.cameraMode = 'review'; this.followedId = null; this.reviewView = null; this.workerAssetReady = false; this.showDesignModels = true
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color('#101c28')
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25
    host.appendChild(this.renderer.domElement)
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.2, 10000)
    this.controls = new ReviewCameraControls(this.camera, this.renderer.domElement)
    this.contextMenu = event => event.preventDefault()
    this.host.addEventListener('contextmenu', this.contextMenu)
    this.scene.add(new THREE.HemisphereLight(0xd9eeff, 0x5a6671, 2.8))
    const light = new THREE.DirectionalLight(0xfff0da, 3); light.position.set(100, 250, 150); this.scene.add(light)
    this.world = new THREE.Group(); this.scene.add(this.world)
    this.moveEffects = new MoveCommandEffects(this.scene)
    this.ep3d = new Ep3dModel(() => this.emit())
    this.workerController = new WorkerController(this.camera, this.renderer.domElement, {
      getWorker: () => this.getControlledWorker(),
      onTakeover: worker => {
        if (!worker.target && !worker.weldTask) return
        worker.target = null; worker.weldTask = null; this.moveEffects.prune(this.workers); this.persist(); this.emit()
        this.onMessage(`手动操控 ${worker.id} · 已取消该焊工的自动派工目标`)
      },
      onSave: () => this.persist(),
      onPick: event => this.pickComponentAt(event, true),
    })
    this.raycaster = new THREE.Raycaster(); this.pointer = new THREE.Vector2()
    this.draco = new DRACOLoader(); this.draco.setDecoderPath('/draco/')
    this.dragBox = document.createElement('div'); this.dragBox.className = 'selection-box'; host.appendChild(this.dragBox)
    this.down = e => this.pointerDown(e); this.up = e => this.pointerUp(e); this.move = e => this.pointerMove(e)
    this.key = e => {
      if (e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape') { e.preventDefault(); this.clearSelection(); return }
      if (isEditing(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return
      if (this.workerController.keyDown(e)) return
      if (e.key === 'PageDown') { e.preventDefault(); this.focusComponent(); return }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.switchWorker(e.key === 'ArrowRight' ? 1 : -1) }
      if (e.key.toLowerCase() === 'a') { e.preventDefault(); this.select(this.workers.filter(w => w.unit === this.unit).map(w => w.id)) }
    }
    this.keyUp = e => this.workerController.keyUp(e)
    this.cancel = () => { this.start = null; this.dragBox.style.display = 'none'; this.workerController.clearInput() }
    this.saveOnHide = () => this.persist(); window.addEventListener('pagehide', this.saveOnHide)
    this.host.addEventListener('pointerdown', this.down); window.addEventListener('pointerup', this.up); window.addEventListener('pointermove', this.move); window.addEventListener('pointercancel', this.cancel); window.addEventListener('keydown', this.key); window.addEventListener('keyup', this.keyUp); window.addEventListener('blur', this.cancel)
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(host); this.resize()
    this.last = performance.now(); this.lastEmit = 0; this.lastSave = 0
    this.renderer.setAnimationLoop(time => this.frame(time))
  }
  async init() {
    const response = await fetch('/models/uae/tileset.json'); if (!response.ok) throw new Error('模型目录读取失败')
    const manifest = await response.json()
    for (const child of manifest.root.children) { const unit = child.content.uri.split('/')[1]; this.sites[unit] = createSite(child.boundingVolume.box, this.size, GROUND_ELEVATIONS[unit]) }
    try { await preloadWorker(); this.workerAssetReady = true }
    catch { this.onMessage('精细工人模型加载失败，暂用简化人物；请检查本地 worker.glb') }
    await this.loadUnit('213')
  }
  resize() { const { clientWidth: w, clientHeight: h } = this.host; this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix(); this.renderer.setSize(w, h); this.tiles?.setResolutionFromRenderer(this.camera, this.renderer) }
  async loadUnit(unit, { force = false } = {}) {
    if (!this.sites[unit] || (!force && this.tiles && this.unit === unit)) return false
    this.setCameraMode('review')
    this.followedId = null
    if (this.unit !== unit) this.showDesignModels = true
    this.generation++; this.unit = unit; this.loaded = 0; this.errors = 0; this.layer = 0; this.selected.clear()
    this.ep3d.clearTiles()
    const metadata = this.ep3d.loadUnit(unit)
    if (this.tiles) { this.scene.remove(this.tiles.group); this.tiles.dispose() }
    this.site = this.sites[unit]
    // The source unit manifest uses ADD at the root, so independent branches can
    // appear progressively. The standard REPLACE root waits for every sibling.
    const tiles = new TilesRenderer(`/models/uae/units/${unit}/tileset.json`); this.tiles = tiles
    tiles.errorTarget = 64; tiles.lruCache.maxSize = 2500; tiles.lruCache.minSize = 1800
    tiles.lruCache.maxBytesSize = 1024 * 1024 * 1024; tiles.lruCache.minBytesSize = 768 * 1024 * 1024
    // Keep design branches at overview LOD; refine EP3D to expose real weld geometry.
    tiles.registerPlugin({ name: 'DISPATCH_OVERVIEW_LOD', preprocessNode(tile) {
      if (!/(^|[/\\])ep3d[/\\]/i.test(tile.content?.uri || '') && tile.internal.hasRenderableContent && tile.children?.length) tile.children.length = 0
    } })
    tiles.downloadQueue.maxJobs = 4; tiles.parseQueue.maxJobs = 1
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: this.draco, autoDispose: false }))
    tiles.group.rotation.x = -Math.PI / 2; tiles.group.position.set(-this.site.origin[0], -this.site.origin[1], -this.site.origin[2]); tiles.group.updateMatrixWorld(true)
    tiles.setCamera(this.camera); tiles.setResolutionFromRenderer(this.camera, this.renderer)
    tiles.addEventListener('load-model', event => { if (this.tiles === tiles) { this.loaded++; event.scene.userData.dispatchEp3d = /(^|[/\\])ep3d[/\\]/i.test(event.url || ''); this.ep3d.attachTile(event.scene, event.url || '') } })
    tiles.addEventListener('dispose-model', event => this.ep3d.detachTile(event.scene))
    tiles.addEventListener('load-error', () => { if (this.tiles === tiles) { this.errors++; this.onMessage('部分模型加载失败，请点击“重新加载”重试') } })
    this.scene.add(tiles.group); this.rebuildSite(); this.overview(); this.updateVisibility(); this.emit()
    await metadata
    return true
  }
  rebuildSite() {
    this.clearGroup(this.world)
    const s = this.site, span = Math.max(s.width, s.depth) + 250
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, span * 2), new THREE.MeshStandardMaterial({ color: 0x1c2c39, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; this.world.add(ground)
    const grid = new THREE.GridHelper(span * 2, Math.round(span * 2 / 10), 0x385465, 0x293f4e); grid.position.y = -0.08; this.world.add(grid)
    this.cubes = new THREE.Group(); this.world.add(this.cubes)
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(s.size, s.size, s.size))
    // One layer at a time keeps dense models readable; all layers are still counted.
    for (let z = 0; z < s.nz; z++) for (let x = 0; x < s.nx; x++) {
      const c = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x48b5c5, transparent: true, opacity: 0.25 }))
      c.position.set(s.minX + (x + 0.5) * s.size, (this.layer + 0.5) * s.size, s.minZ + (z + 0.5) * s.size); this.cubes.add(c)
    }
    this.cubes.visible = this.gridVisible
    this.workPlane = new THREE.Mesh(new THREE.PlaneGeometry(s.width, s.depth), new THREE.MeshBasicMaterial({ color: 0x46c6ca, transparent: true, opacity: this.layer ? 0.07 : 0.025, side: THREE.DoubleSide, depthWrite: false }))
    this.workPlane.rotation.x = -Math.PI / 2; this.workPlane.position.y = this.layer * s.size + 0.08; this.world.add(this.workPlane)
    const staging = new THREE.Mesh(new THREE.PlaneGeometry(64, 34), new THREE.MeshBasicMaterial({ color: 0x3ed5cf, transparent: true, opacity: 0.12, side: THREE.DoubleSide }))
    staging.name = 'dispatch-staging-ground'; staging.rotation.x = -Math.PI / 2; staging.position.set(s.minX - 34, 0.02, s.minZ + 20); this.world.add(staging)
    const border = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(s.minX - 66, 0, s.minZ + 3), new THREE.Vector3(s.minX - 2, 0.1, s.minZ + 37)), 0x40c9c3); border.name = 'dispatch-staging-border'; this.world.add(border)
    const label = this.label('预 备 区', '#7ce9dc'); label.position.set(s.minX - 34, 5, s.minZ + 40); this.world.add(label); this.stagingLabel = label
  }
  label(text, color) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgba(13,30,43,.9)'; ctx.fillRect(0, 0, 256, 64); ctx.fillStyle = color; ctx.font = '32px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(text, 128, 44)
    const texture = new THREE.CanvasTexture(canvas), sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false })); sprite.scale.set(14, 3.5, 1); return sprite
  }
  setGridSize(size) {
    this.size = size
    for (const [unit, site] of Object.entries(this.sites)) { site.size = size; site.nx = Math.ceil(site.width / size); site.nz = Math.ceil(site.depth / size); site.ny = Math.ceil(site.height / size) }
    this.layer = Math.min(this.layer, this.site.ny - 1); this.rebuildSite(); this.emit()
  }
  setLayer(layer) { this.layer = layer; this.rebuildSite(); this.emit() }
  setGroundElevation(value) {
    const box = this.site.sourceBox
    if (!Number.isFinite(value) || value < box[2] - box[11] || value >= box[2] + box[11]) throw new Error(`地面标高须在 ${(box[2] - box[11]).toFixed(2)}–${(box[2] + box[11]).toFixed(2)} m 之间`)
    const shift = this.site.groundElevation - value
    this.site = this.sites[this.unit] = createSite(box, this.size, value)
    for (const worker of this.workers) if (worker.unit === this.unit && worker.weldTask) {
      worker.weldTask.point[1] += shift; worker.weldTask.station[1] += shift; worker.position[1] += shift
      if (worker.target) worker.target[1] += shift
    }
    this.layer = Math.min(this.layer, this.site.ny - 1)
    this.tiles.group.position.y = -value; this.tiles.group.updateMatrixWorld(true)
    this.rebuildSite(); this.emit(); this.persist()
  }
  overview() { this.setCameraMode('review'); const s = this.site, span = Math.max(s.width + 100, s.depth + 70); this.controls.target.set(-20, s.height * 0.2, 0); this.camera.position.set(-span * 0.62, span * 0.65, span * 0.64); this.controls.update() }
  focusStaging() { this.setCameraMode('review'); const s = this.site; this.controls.target.set(s.minX - 23, 1, s.minZ + 20); this.camera.position.set(s.minX - 49, 23, s.minZ + 50); this.controls.update() }
  focusZone(zone) { this.setCameraMode('review'); const s = this.site, center = new THREE.Vector3(s.minX + (zone.x + 0.5) * s.size, zone.layer * s.size, s.minZ + (zone.z + 0.5) * s.size); this.controls.target.copy(center); this.camera.position.copy(center).add(new THREE.Vector3(-s.size, s.size * 1.3, s.size)); this.setLayer(zone.layer); this.controls.update() }
  selectComponent(id, { assign = false } = {}) {
    const object = this.ep3d.getObject(this.unit, id)
    if (!object) return
    void this.ep3d.select(id)
    if (this.cameraMode === 'review' && object.bounds) this.controls.reanchor(localBounds(object.bounds, this.site).getCenter(new THREE.Vector3()))
    if (assign && object.isWeld) this.bindSelectedToWeld(id)
    else this.onMessage(`已选中 EP3D ${object.isWeld ? '焊缝' : '元件'} ${object.label || object.kind} · 合并 ${object.geometryIds.length} 个子几何`)
  }
  focusComponent(id = this.ep3d.selected?.id) {
    const object = this.ep3d.getObject(this.unit, id), bounds = object && localBounds(object.bounds, this.site)
    if (!bounds) { this.onMessage('请先选中有定位信息的焊缝或元件'); return }
    this.selectComponent(id); this.showDesignModels = false
    if (this.cameraMode === 'worker') this.workerController.lookAt(bounds.getCenter(new THREE.Vector3()))
    else this.controls.focusBounds(bounds)
    this.onMessage(this.cameraMode === 'worker' ? '已看向选中对象，保持焊工视角' : '正在定位到选中对象 · 可围绕该对象旋转')
    this.emit()
  }
  bindSelectedToWeld(id = this.ep3d.selected?.id) {
    const selected = this.workers.filter(worker => worker.unit === this.unit && this.selected.has(worker.id))
    const object = this.ep3d.getObject(this.unit, id)
    if (!object?.isWeld || !object.bounds) { this.onMessage('请选择有定位信息的 EP3D 焊缝'); return false }
    if (selected.length !== 1) { this.onMessage('请只选中 1 名焊工，再绑定焊缝'); return false }
    const worker = selected[0], owner = weldOwner(this.workers, this.unit, id, worker.id)
    if (owner) { this.onMessage(`该焊缝已绑定 ${owner.id}，请先停止其作业`); return false }
    if (worker.weldTask?.weldId === id && worker.weldTask.fingerprint === object.fingerprint) { this.onMessage(`${worker.id} 已绑定该焊缝，继续当前作业`); return true }
    const point = localBounds(object.bounds, this.site).getCenter(new THREE.Vector3()).toArray()
    if (point[1] < 0) { this.onMessage('该焊缝位于当前地面以下，请先核对地面标高和模型定位'); return false }
    if (worker === this.getControlledWorker()) this.workerController.clearInput()
    worker.weldTask = createWeldTask(object, point, worker.position)
    worker.target = [...worker.weldTask.station]; worker.jump = null
    this.moveEffects.issue(this.unit, worker.target, [worker.id])
    this.onMessage(`${worker.id} 已绑定焊缝 ${object.label} · 到达作业点后进入焊接状态`)
    this.persist(); this.emit(); return true
  }
  setCameraMode(mode, workerId = null) {
    if (mode === 'worker') {
      const candidates = this.workers.filter(w => w.unit === this.unit)
      const worker = candidates.find(w => w.id === workerId) || candidates.find(w => this.selected.has(w.id)) || candidates.find(w => w.id === this.followedId) || candidates[0]
      if (!worker) { this.onMessage('当前单元没有焊工，请先设置人数'); return }
      if (this.cameraMode !== 'worker') this.reviewView = { position: this.camera.position.clone(), target: this.controls.target.clone() }
      const changedWorker = this.cameraMode !== 'worker' || this.followedId !== worker.id
      this.cameraMode = 'worker'; this.followedId = worker.id; this.controls.enabled = false
      if (changedWorker) this.workerController.enter(worker)
      this.select([worker.id]); this.followWorkerCamera(0, changedWorker)
    } else if (this.cameraMode !== 'review') {
      this.workerController.exit()
      this.cameraMode = 'review'; this.controls.enabled = true
      if (this.reviewView) { this.camera.position.copy(this.reviewView.position); this.controls.target.copy(this.reviewView.target) }
      this.controls.update(); this.updateVisibility(); this.emit()
    }
  }
  switchWorker(direction) {
    const crew = this.workers.filter(w => w.unit === this.unit)
    if (!crew.length) { this.onMessage('当前单元没有焊工，请先设置人数'); return }
    const currentId = this.cameraMode === 'worker' ? this.followedId : [...this.selected][0]
    const index = crew.findIndex(w => w.id === currentId)
    const nextIndex = index < 0 ? (direction > 0 ? 0 : crew.length - 1) : (index + direction + crew.length) % crew.length
    this.setCameraMode('worker', crew[nextIndex].id)
    this.onMessage(`焊工视角 · ${crew[nextIndex].id} · ← → 切换，Esc 返回审阅`)
  }
  getControlledWorker() { return this.cameraMode === 'worker' ? this.workers.find(w => w.id === this.followedId && w.unit === this.unit) : null }
  followWorkerCamera(delta = 0, snap = false) {
    const worker = this.getControlledWorker()
    if (!worker) { this.setCameraMode('review'); return }
    this.workerController.updateCamera(worker, delta, snap)
  }
  setCount(count) {
    if (!Number.isInteger(count) || count < 0 || count > MAX_WORKERS) throw new Error(`请输入 0–${MAX_WORKERS} 的整数`)
    const crew = this.workers.filter(w => w.unit === this.unit), removed = new Set(crew.slice(count))
    for (const worker of removed) { this.scene.remove(worker.visual.root, worker.visual.path); this.disposeWorker(worker); this.selected.delete(worker.id) }
    this.workers = this.workers.filter(w => !removed.has(w))
    if (this.followedId && !this.workers.some(w => w.id === this.followedId)) { this.setCameraMode('review'); this.followedId = null }
    while (this.workers.filter(w => w.unit === this.unit).length < count) {
      const id = `W-${String(this.nextWorkerNumber++).padStart(3, '0')}`, index = this.workers.filter(w => w.unit === this.unit).length
      const worker = { id, unit: this.unit, position: stagingPosition(index, this.site), target: null, visual: createWorker(id) }; this.workers.push(worker); this.scene.add(worker.visual.root, worker.visual.path)
    }
    this.updateVisibility(); this.emit(); this.persist()
  }
  updateVisibility() { for (const w of this.workers) { w.visual.root.visible = w.unit === this.unit && !(this.cameraMode === 'worker' && w.id === this.followedId && this.workerController.distance < 0.55); w.visual.root.position.set(w.position[0], w.position[1] + (w.jump?.height || 0), w.position[2]); w.visual.ring.visible = this.selected.has(w.id) } }
  select(ids, additive = false) { if (!additive) this.selected.clear(); for (const id of ids) { if (additive && this.selected.has(id)) this.selected.delete(id); else this.selected.add(id) } this.updateVisibility(); this.emit() }
  command(point, staging = false) {
    const selected = this.workers.filter(w => this.selected.has(w.id) && w.unit === this.unit)
    const unitWorkers = this.workers.filter(w => w.unit === this.unit)
    const targets = staging ? selected.map(w => stagingPosition(unitWorkers.indexOf(w), this.site)) : formationTargets(point, selected.length, this.site)
    selected.forEach((w, i) => { w.target = targets[i]; w.weldTask = null })
    if (selected.length) {
      const markerPoint = staging ? targets.reduce((sum, target) => sum.map((value, i) => value + target[i] / targets.length), [0, 0, 0]) : point
      this.moveEffects.issue(this.unit, markerPoint, selected.map(w => w.id))
      this.onMessage(`已下达移动指令 · ${selected.length} 人${staging ? '返回预备区' : ''}`); this.persist(); this.emit()
    }
  }
  stop() { for (const w of this.workers) if (this.selected.has(w.id)) { w.target = null; w.weldTask = null } if (this.selected.has(this.followedId)) this.workerController.clearInput(); this.moveEffects.prune(this.workers); this.emit(); this.persist() }
  clearSelection() {
    this.cancel(); this.setCameraMode('review'); this.select([]); this.ep3d.clearSelection()
    this.onMessage('已取消焊工、焊缝及元件选择')
  }
  pickComponentAt(event, workerMode = false) {
    if (!this.site || !this.tiles) return false
    const rect = this.host.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return false
    this.camera.updateMatrixWorld()
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const component = this.ep3d.pick(this.raycaster, this.tiles.group)
    if (component?.loading) { this.onMessage('EP3D 属性索引加载中，请稍后再试'); return true }
    if (!component) return false
    if (workerMode) this.select([this.followedId])
    this.selectComponent(component.object.id, { assign: workerMode || this.selected.size > 0 })
    return true
  }
  pointerDown(e) { if (this.cameraMode === 'worker' || e.button !== 0 || e.target !== this.renderer.domElement || !this.site) return; this.start = { x: e.clientX, y: e.clientY, shift: e.shiftKey }; this.host.setPointerCapture(e.pointerId) }
  pointerMove(e) {
    if (!this.start) return
    const rect = this.host.getBoundingClientRect(), dx = e.clientX - this.start.x, dy = e.clientY - this.start.y
    if (Math.hypot(dx, dy) > 6) Object.assign(this.dragBox.style, { display: 'block', left: `${Math.min(e.clientX, this.start.x) - rect.left}px`, top: `${Math.min(e.clientY, this.start.y) - rect.top}px`, width: `${Math.abs(dx)}px`, height: `${Math.abs(dy)}px` })
  }
  pointerUp(e) {
    if (!this.start || e.button !== 0) return
    const start = this.start; this.start = null; this.dragBox.style.display = 'none'
    const rect = this.host.getBoundingClientRect()
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
      this.camera.updateMatrixWorld()
      const ids = this.workers.filter(w => {
        if (w.unit !== this.unit) return false
        const p = w.visual.root.position.clone().add(new THREE.Vector3(0, 1, 0)).project(this.camera), x = rect.left + (p.x + 1) / 2 * rect.width, y = rect.top + (1 - p.y) / 2 * rect.height
        return p.z > -1 && p.z < 1 && x >= Math.min(start.x, e.clientX) && x <= Math.max(start.x, e.clientX) && y >= Math.min(start.y, e.clientY) && y <= Math.max(start.y, e.clientY)
      }).map(w => w.id)
      this.select(ids, start.shift); return
    }
    this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1); this.raycaster.setFromCamera(this.pointer, this.camera)
    const hits = this.raycaster.intersectObjects(this.workers.filter(w => w.unit === this.unit && w.visual.root.visible).map(w => w.visual.hit), false)
    if (hits.length) { this.select([hits[0].object.userData.workerId], start.shift); return }
    if (this.pickComponentAt(e)) return
    if (!this.selected.size) { this.onMessage('请先点击人物或拖动框选焊工，再点击工区地面'); return }
    const point = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.layer * this.size + 0.1)), new THREE.Vector3())
    if (point && zoneAt(point.toArray(), this.site)) this.command(point.toArray())
    else this.onMessage('目标超出模型工区，请在青色网格内点击；可用“返回预备区”召回')
  }
  frame(time) {
    const dt = Math.min((time - this.last) / 1000, 0.08); this.last = time
    this.ep3d.updatePulse(time, this.moveEffects.reducedMotion)
    this.workerController.updateMovement(dt, this.paused)
    const controlled = this.getControlledWorker()
    for (const w of this.workers) {
      if (w.target && !this.paused) {
        const next = moveTowards(w.position, w.target, dt * this.speed), dx = w.target[0] - w.position[0], dz = w.target[2] - w.position[2]
        w.visual.root.rotation.y = Math.atan2(dx, dz); w.position = next.position
        if (next.arrived) {
          w.target = null
          if (w.weldTask) { w.weldTask.status = 'welding'; w.visual.root.rotation.y = w.weldTask.heading }
          this.persist()
        }
      }
      if (w.weldTask?.status === 'welding' && !w.route && !this.paused) w.weldTask.elapsed += dt
      if (w.jump && !this.paused) w.jump = advanceJump(w.jump, dt)
      const manualMoving = w === controlled && this.workerController.isMoving
      w.visual.root.position.set(w.position[0], w.position[1] + (w.jump?.height || 0), w.position[2])
      w.visual.ring.position.y = 0.03 - (w.jump?.height || 0)
      if (w.unit === this.unit) w.visual.animate(time / 1000, ((!!w.target || w.historyMoving) && !this.paused) || manualMoving, dt, manualMoving ? this.workerController.moveSpeed : this.speed, { paused: this.paused, manual: manualMoving, intent: this.workerController.intent, jumpHeight: w.jump?.height || 0, welding: w.weldTask?.status === 'welding', weldTime: w.weldTask?.elapsed || 0, crouch: w.weldTask?.crouch, weldPoint: w.weldTask?.point })
      w.visual.path.visible = w.unit === this.unit && this.selected.has(w.id) && !!w.target
      if (w.visual.path.visible) { const a = w.visual.path.geometry.attributes.position; a.setXYZ(0, w.position[0], w.position[1] + 0.15, w.position[2]); a.setXYZ(1, w.target[0], w.target[1] + 0.15, w.target[2]); a.needsUpdate = true; w.visual.path.computeLineDistances(); w.visual.path.geometry.computeBoundingSphere() }
    }
    if (this.cameraMode === 'worker') this.followWorkerCamera(dt)
    else this.controls.update(dt)
    if (this.stagingLabel) this.stagingLabel.visible = this.cameraMode === 'review' && !this.hideStaging
    this.camera.updateMatrixWorld()
    this.moveEffects.update(this.workers, this.unit, this.camera, this.host.clientHeight, time / 1000)
    this.tiles?.update()
    if (this.tiles) for (const root of this.tiles.group.children) root.visible = this.showDesignModels || !!root.userData.dispatchEp3d
    this.renderer.render(this.scene, this.camera)
    if (time - this.lastEmit > 200) { this.emit(); this.lastEmit = time }
    if (time - this.lastSave > 2000) { if (this.workerController.isMoving || this.workers.some(w => w.target || w.jump || w.weldTask)) this.persist(); this.lastSave = time }
  }
  emit() {
    if (!this.site) return
    const zones = zonesFor(this.site), byId = new Map(zones.map(z => [z.id, z]))
    const list = this.workers.map(w => ({ id: w.id, unit: w.unit, position: [...w.position], target: w.target ? [...w.target] : null, zone: zoneAt(w.position, this.sites[w.unit]), selected: this.selected.has(w.id), jumping: !!w.jump, historicalMoving: !!w.historyMoving, manualMoving: w.id === this.followedId && this.workerController.isMoving, weldTask: w.weldTask ? { ...w.weldTask, point: [...w.weldTask.point], station: [...w.weldTask.station] } : null }))
    for (const w of list) if (w.unit === this.unit && w.zone) byId.get(w.zone).count++
    this.onState({ workers: list, zones, unit: this.unit, site: { ...this.site }, layer: this.layer, loaded: this.loaded, errors: this.errors, paused: this.paused, speed: this.speed, cameraMode: this.cameraMode, followedId: this.followedId, workerAssetReady: this.workerAssetReady, workerDistance: this.workerController.distance, workerDistanceTarget: this.workerController.targetDistance, manualSpeed: this.workerController.moveSpeed, ep3d: this.ep3d.state(), showDesignModels: this.showDesignModels })
  }
  persist() { try { this.moveEffects.prune(this.workers); localStorage.setItem('welder-dispatch-v1', JSON.stringify({ version: 2, moveCommands: this.moveEffects.snapshot(), nextWorkerNumber: this.nextWorkerNumber, groundElevations: Object.fromEntries(Object.entries(this.sites).map(([unit, site]) => [unit, site.groundElevation])), date: new Date().toLocaleDateString('en-CA'), workers: this.workers.map(({ id, unit, position, target, weldTask }) => ({ id, unit, position, target, weldTask })) })) } catch { /* Storage may be unavailable in private mode. */ } }
  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem('welder-dispatch-v1'))
      if (!saved || saved.date !== new Date().toLocaleDateString('en-CA') || !Array.isArray(saved.workers) || saved.workers.length > MAX_WORKERS * Object.keys(this.sites).length) return false
      const valid = saved.workers.every(w => /^W-\d{3,6}$/.test(w.id) && this.sites[w.unit] && Array.isArray(w.position) && w.position.length === 3 && w.position.every(Number.isFinite) && (!w.target || (Array.isArray(w.target) && w.target.length === 3 && w.target.every(Number.isFinite)))) && new Set(saved.workers.map(w => w.id)).size === saved.workers.length && Object.keys(this.sites).every(unit => saved.workers.filter(w => w.unit === unit).length <= MAX_WORKERS)
      if (!valid) return false
      for (const [unit, value] of Object.entries(saved.groundElevations || {})) {
        const site = this.sites[unit], box = site?.sourceBox
        if (box && Number.isFinite(value) && value >= box[2] - box[11] && value < box[2] + box[11]) this.sites[unit] = createSite(box, this.size, value)
      }
      this.site = this.sites[this.unit]; this.tiles.group.position.y = -this.site.groundElevation; this.tiles.group.updateMatrixWorld(true); this.rebuildSite()
      this.nextWorkerNumber = Math.max(1, ...saved.workers.map(w => Number(w.id.slice(2)) + 1), Number.isSafeInteger(saved.nextWorkerNumber) ? saved.nextWorkerNumber : 1)
      for (const w of saved.workers) {
        let task = restoreWeldTask(w.weldTask, this.ep3d.getObject(w.unit, w.weldTask?.weldId))
        if (task && weldOwner(this.workers, w.unit, task.weldId)) task = null
        const worker = { ...w, weldTask: task, target: w.weldTask && !task ? null : w.target, visual: createWorker(w.id) }
        if (task) worker.visual.root.rotation.y = task.heading
        this.workers.push(worker); this.scene.add(worker.visual.root, worker.visual.path)
      }
      this.moveEffects.restore(saved.moveCommands, this.workers)
      this.updateVisibility(); this.emit(); return true
    } catch { return false }
  }
  clearGroup(group) { const geometries = new Set(), materials = new Set(); group.traverse(o => { if (o.geometry) geometries.add(o.geometry); for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) materials.add(m) }); geometries.forEach(g => g.dispose()); materials.forEach(m => { m.map?.dispose(); m.dispose() }); group.clear() }
  disposeWorker(w) { if (w.visual.dispose) { w.visual.dispose(); return } w.visual.root.traverse(o => o.geometry?.dispose()); w.visual.ring.material.dispose(); w.visual.hit.material.dispose(); w.visual.path.geometry.dispose(); w.visual.path.material.dispose() }
  dispose() { this.persist(); this.renderer.setAnimationLoop(null); this.resizeObserver.disconnect(); this.host.removeEventListener('pointerdown', this.down); this.host.removeEventListener('contextmenu', this.contextMenu); window.removeEventListener('pointerup', this.up); window.removeEventListener('pointermove', this.move); window.removeEventListener('pointercancel', this.cancel); window.removeEventListener('keydown', this.key); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.cancel); window.removeEventListener('pagehide', this.saveOnHide); this.workerController.dispose(); this.controls.dispose(); this.ep3d.dispose(); this.tiles?.dispose(); this.draco.dispose(); this.clearGroup(this.world); this.moveEffects.dispose(); this.workers.forEach(w => this.disposeWorker(w)); this.renderer.dispose(); this.renderer.domElement.remove(); this.dragBox.remove() }
}
