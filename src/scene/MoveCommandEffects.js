import * as THREE from 'three'

// One marker per order, rather than per person: a formation keeps its marker
// at the exact clicked point until every remaining member finishes moving.
export class MoveCommandEffects {
  constructor(scene) {
    this.scene = scene
    this.orders = new Map()
    this.nextId = 1
    this.reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
    const chevron = new THREE.BufferGeometry()
    chevron.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.15, 0, 0.15, 0, 0, -0.09, 0, 0, 0.06,
      0, 0, -0.09, 0.15, 0, 0.15, 0, 0, 0.06,
    ], 3))
    // A bright, narrow head with a transparent, wider tail creates light streaks
    // without textures or a post-processing bloom pass.
    const streak = new THREE.BufferGeometry()
    streak.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.025, 0, 0, 0.025, 0, 0, 0.08, 0, 1, -0.08, 0, 1,
    ], 3))
    streak.setAttribute('color', new THREE.Float32BufferAttribute([
      0.72, 1, 0.91, 1, 0.72, 1, 0.91, 1,
      0.15, 0.85, 0.65, 0, 0.15, 0.85, 0.65, 0,
    ], 4))
    streak.setIndex([0, 1, 2, 0, 2, 3])
    this.geometries = {
      ring: new THREE.RingGeometry(0.84, 0.92, 64),
      wave: new THREE.RingGeometry(0.95, 1, 64),
      arc: new THREE.RingGeometry(1.06, 1.12, 32, 1, 0, Math.PI * 0.58),
      dot: new THREE.CircleGeometry(0.12, 24),
      chevron,
      beam: new THREE.CylinderGeometry(0.018, 0.045, 0.9, 8),
      pointer: new THREE.ConeGeometry(0.13, 0.32, 4),
      streak,
      flash: new THREE.SphereGeometry(0.16, 16, 12),
      flashHalo: new THREE.CircleGeometry(0.5, 32),
    }
  }

  material(opacity, color = 0x65ffc1) {
    return new THREE.MeshBasicMaterial({
      color, opacity, transparent: true, side: THREE.DoubleSide,
      depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending,
    })
  }

  createVisual(point) {
    const root = new THREE.Group()
    root.name = 'move-command-effect'
    root.position.set(point[0], point[1] + 0.06, point[2])
    const mesh = (geometry, opacity, parent = root) => {
      const object = new THREE.Mesh(geometry, this.material(opacity))
      object.renderOrder = 20
      parent.add(object)
      return object
    }
    const groundRing = (geometry, opacity) => {
      const object = mesh(geometry, opacity)
      object.rotation.x = -Math.PI / 2
      return object
    }
    const ring = groundRing(this.geometries.ring, 0.85)
    const dot = groundRing(this.geometries.dot, 0.95)
    const waves = [groundRing(this.geometries.wave, 0.4), groundRing(this.geometries.wave, 0.4)]
    const burst = groundRing(this.geometries.wave, 0.9)
    const arcs = new THREE.Group()
    root.add(arcs)
    for (const angle of [0, Math.PI]) {
      const arc = mesh(this.geometries.arc, 0.8, arcs)
      arc.rotation.set(-Math.PI / 2, 0, angle)
    }
    const chevrons = new THREE.Group()
    root.add(chevrons)
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2, arrow = mesh(this.geometries.chevron, 0.95, chevrons)
      arrow.position.set(Math.sin(angle) * 0.65, 0.015, Math.cos(angle) * 0.65)
      arrow.rotation.y = angle
    }
    const beam = mesh(this.geometries.beam, 0.32)
    beam.position.y = 0.65
    const pointer = mesh(this.geometries.pointer, 0.95)
    pointer.rotation.z = Math.PI
    pointer.position.y = 1.26
    const convergence = new THREE.Group(), flash = new THREE.Group(), rays = []
    convergence.name = 'click-convergence'
    root.add(convergence, flash)
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI * 2 / 16
      const direction = new THREE.Vector3(Math.sin(angle), i % 3 === 0 ? 0.45 : 0.025, Math.cos(angle)).normalize()
      const ray = new THREE.Group()
      ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction)
      convergence.add(ray)
      for (const [width, opacity] of [[3.2, 0.22], [1, 1]]) {
        const trail = mesh(this.geometries.streak, opacity, ray)
        trail.material.color.set(0xffffff)
        trail.material.vertexColors = true
        trail.scale.x = width
        trail.userData.baseOpacity = opacity
      }
      rays.push({ ray, direction, delay: (i % 4) * 0.025, duration: 0.43 + (i % 3) * 0.035, radius: 3.3 + (i % 2) * 0.45 })
    }
    const flashCore = mesh(this.geometries.flash, 0.95, flash)
    flashCore.material.color.set(0xd9fff2)
    flashCore.position.y = 0.12
    const flashHalo = mesh(this.geometries.flashHalo, 0.5, flash)
    flashHalo.rotation.x = -Math.PI / 2
    convergence.visible = false; flash.visible = false
    this.scene.add(root)
    return { root, ring, dot, waves, burst, arcs, chevrons, pointer, convergence, rays, flash, flashHalo }
  }

  animateConvergence(visual, age) {
    visual.convergence.visible = !this.reducedMotion && age < 0.7
    if (visual.convergence.visible) for (const { ray, direction, delay, duration, radius } of visual.rays) {
      const progress = THREE.MathUtils.clamp((age - delay) / duration, 0, 1)
      ray.visible = progress > 0 && progress < 1
      if (!ray.visible) continue
      // Accelerate toward the click; tails shorten as each beam reaches it.
      ray.position.copy(direction).multiplyScalar(radius * (1 - progress ** 2))
      ray.scale.z = (0.4 + Math.sin(progress * Math.PI) * 1.1) * (1 - progress)
      const opacity = Math.min(1, progress * 10) * Math.min(1, (1 - progress) * 7)
      for (const trail of ray.children) trail.material.opacity = trail.userData.baseOpacity * opacity
    }
    const flashPhase = (age - 0.34) / 0.34
    visual.flash.visible = !this.reducedMotion && flashPhase > 0 && flashPhase < 1
    if (visual.flash.visible) {
      const strength = Math.sin(flashPhase * Math.PI)
      visual.flash.scale.setScalar(0.65 + strength * 1.3)
      for (const object of visual.flash.children) object.material.opacity = strength * 0.9
      visual.flashHalo.scale.setScalar(0.7 + flashPhase * 1.1)
    }
  }

  issue(unit, point, workerIds) {
    if (!workerIds.length) return
    const members = new Set(workerIds)
    for (const [id, order] of this.orders) {
      for (const workerId of members) order.members.delete(workerId)
      if (!order.members.size) this.remove(id)
    }
    const id = this.nextId++
    this.orders.set(id, {
      unit, point: [...point], members, createdAt: performance.now() / 1000,
      visual: this.createVisual(point),
    })
  }

  prune(workers) {
    const moving = new Map(workers.filter(worker => worker.target).map(worker => [worker.id, worker.unit]))
    for (const [id, order] of this.orders) {
      for (const workerId of order.members) if (moving.get(workerId) !== order.unit) order.members.delete(workerId)
      if (!order.members.size) this.remove(id)
    }
  }

  update(workers, activeUnit, camera, viewportHeight, time) {
    this.prune(workers)
    for (const order of this.orders.values()) {
      const { visual, createdAt } = order
      const depth = -visual.root.position.clone().applyMatrix4(camera.matrixWorldInverse).z
      visual.root.visible = order.unit === activeUnit && depth > camera.near
      if (!visual.root.visible) continue
      // Keep the destination legible both in a site overview and a close-up.
      const worldPerPixel = 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(1, viewportHeight)
      visual.root.scale.setScalar(THREE.MathUtils.clamp(worldPerPixel * 25, 0.12, 24))
      const age = Math.max(0, time - createdAt), t = this.reducedMotion ? 0 : age
      this.animateConvergence(visual, age)
      visual.ring.material.opacity = 0.76 + Math.sin(t * 4) * 0.14
      visual.dot.material.opacity = 0.72 + Math.sin(t * 4) * 0.2
      visual.arcs.rotation.y = -t * 1.2
      visual.chevrons.scale.setScalar(0.92 + Math.sin(t * 4) * 0.08)
      visual.pointer.position.y = 1.25 + Math.sin(t * 4) * 0.1
      visual.pointer.rotation.y = t * 0.7
      visual.waves.forEach((wave, i) => {
        const phase = (t / 1.35 + i * 0.5) % 1
        wave.scale.setScalar(0.55 + phase * 1.15)
        wave.material.opacity = this.reducedMotion ? 0.16 : 0.55 * (1 - phase) ** 2
      })
      visual.burst.visible = !this.reducedMotion && age < 0.6
      if (visual.burst.visible) {
        visual.burst.scale.setScalar(0.65 + age * 2.6)
        visual.burst.material.opacity = 0.9 * (1 - age / 0.6)
      }
    }
  }

  snapshot() {
    return [...this.orders.values()].map(order => ({ unit: order.unit, point: [...order.point], workerIds: [...order.members] }))
  }

  restore(records, workers) {
    for (const id of this.orders.keys()) this.remove(id)
    const moving = new Map(workers.filter(worker => worker.target).map(worker => [worker.id, worker]))
    if (Array.isArray(records)) for (const record of records) {
      if (!record || !Array.isArray(record.point) || record.point.length !== 3 || !record.point.every(Number.isFinite) || !Array.isArray(record.workerIds)) continue
      const members = record.workerIds.filter(id => moving.get(id)?.unit === record.unit)
      this.issue(record.unit, record.point, members)
    }
    const covered = new Set([...this.orders.values()].flatMap(order => [...order.members]))
    // Existing saved dispatches predate order markers; recover those at their goals.
    for (const worker of moving.values()) if (!covered.has(worker.id)) this.issue(worker.unit, worker.target, [worker.id])
  }

  remove(id) {
    const order = this.orders.get(id)
    if (!order) return
    this.scene.remove(order.visual.root)
    order.visual.root.traverse(object => object.material?.dispose())
    order.visual.root.clear()
    this.orders.delete(id)
  }

  dispose() {
    for (const id of this.orders.keys()) this.remove(id)
    for (const geometry of Object.values(this.geometries)) geometry.dispose()
  }
}
