import * as THREE from 'three'

export const JUMP_GRAVITY = 18
export const JUMP_SPEED = 6.5

export function movementIntent(keys, buttons = 0) {
  let forward = (buttons & 3) === 3 ? 1 : Number(keys.has('KeyW')) - Number(keys.has('KeyS'))
  let strafe = Number(keys.has('KeyD')) - Number(keys.has('KeyA'))
  const length = Math.hypot(forward, strafe)
  if (length > 1) { forward /= length; strafe /= length }
  return { forward, strafe, moving: length > 0 }
}

export function advanceJump(jump, delta) {
  if (delta <= 0) return { ...jump }
  const height = jump.height + jump.velocity * delta - 0.5 * JUMP_GRAVITY * delta * delta
  return height <= 0 ? null : { height, velocity: jump.velocity - JUMP_GRAVITY * delta }
}

export class WorkerController {
  constructor(camera, element, { getWorker, onTakeover, onSave, onPick }) {
    this.camera = camera; this.element = element
    if (element.tabIndex < 0) element.tabIndex = 0
    this.getWorker = getWorker; this.onTakeover = onTakeover; this.onSave = onSave; this.onPick = onPick
    this.clickStart = null
    this.active = false; this.keys = new Set(); this.buttons = 0
    this.yaw = 0; this.pitch = 0.3; this.distance = 6; this.targetDistance = 6
    this.moveSpeed = 4.5; this.isMoving = false; this.intent = movementIntent(this.keys)
    this.lastX = 0; this.lastY = 0
    this.cameraTarget = new THREE.Vector3()
    this.desiredPosition = new THREE.Vector3()
    this.viewDirection = new THREE.Vector3()
    this.down = event => this.mouseDown(event)
    this.move = event => this.mouseMove(event)
    this.up = event => this.mouseUp(event)
    this.wheel = event => {
      if (!this.active) return
      event.preventDefault(); event.stopImmediatePropagation()
      const amount = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      this.setDistance(this.targetDistance + amount * 0.012)
    }
    this.reset = () => this.clearInput()
    this.visibility = () => { if (document.hidden) this.clearInput() }
    this.focus = event => { if (isEditing(event.target)) this.clearInput() }
    element.addEventListener('mousedown', this.down)
    element.addEventListener('wheel', this.wheel, { passive: false, capture: true })
    window.addEventListener('mousemove', this.move)
    window.addEventListener('mouseup', this.up)
    window.addEventListener('blur', this.reset)
    window.addEventListener('pointercancel', this.reset)
    document.addEventListener('visibilitychange', this.visibility)
    document.addEventListener('focusin', this.focus)
  }

  enter(worker) {
    this.clearInput()
    this.active = true
    this.yaw = worker.visual.root.rotation.y
    this.pitch = 0.3
    this.distance = this.targetDistance
    this.updateCamera(worker, 0, true)
  }

  exit() { this.active = false; this.clearInput() }
  setDistance(value) { this.targetDistance = THREE.MathUtils.clamp(Number(value) || 0, 0, 25) }
  resetView() { const worker = this.getWorker(); if (worker) { this.yaw = worker.visual.root.rotation.y; this.pitch = 0.3; this.setDistance(6) } }
  clearInput() {
    const hadInput = this.keys.size || this.buttons || this.isMoving
    this.keys.clear(); this.buttons = 0; this.isMoving = false; this.clickStart = null
    this.intent = movementIntent(this.keys)
    this.element.classList.remove('worker-looking')
    if (hadInput) this.onSave()
  }

  keyDown(event) {
    if (!this.active || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(event.code)) return false
    event.preventDefault()
    if (this.readOnly) return true
    const worker = this.getWorker()
    if (!worker) return true
    if (event.code === 'Space') {
      if (!event.repeat && !worker.jump) { this.onTakeover(worker); worker.jump = { height: 0, velocity: JUMP_SPEED } }
    } else {
      this.keys.add(event.code)
      this.onTakeover(worker)
    }
    return true
  }

  keyUp(event) {
    const removed = this.keys.delete(event.code)
    if (removed && !movementIntent(this.keys, this.buttons).moving) this.onSave()
  }

  mouseDown(event) {
    if (!this.active || ![0, 2].includes(event.button)) return
    event.preventDefault()
    this.element.focus({ preventScroll: true })
    this.buttons = event.buttons & 3
    if (event.button === 0 && this.buttons === 1) this.clickStart = { x: event.clientX, y: event.clientY }
    else this.clickStart = null
    this.lastX = event.clientX; this.lastY = event.clientY
    this.element.classList.add('worker-looking')
    const worker = this.getWorker()
    if (!this.readOnly && worker && (this.buttons & 2)) { this.onTakeover(worker); worker.visual.root.rotation.y = this.yaw }
  }

  mouseMove(event) {
    if (!this.active || !this.buttons) return
    if (!(event.buttons & 3)) { this.buttons = 0; this.element.classList.remove('worker-looking'); return }
    this.buttons = event.buttons & 3
    if (this.clickStart && (this.buttons !== 1 || Math.hypot(event.clientX - this.clickStart.x, event.clientY - this.clickStart.y) > 6)) this.clickStart = null
    this.yaw -= (event.clientX - this.lastX) * 0.004
    this.pitch = THREE.MathUtils.clamp(this.pitch + (event.clientY - this.lastY) * 0.004, -0.12, 1.25)
    this.lastX = event.clientX; this.lastY = event.clientY
    const worker = this.getWorker()
    if (!this.readOnly && worker && (this.buttons & 2)) worker.visual.root.rotation.y = this.yaw
  }

  mouseUp(event) {
    if (!this.active || ![0, 2].includes(event.button)) return
    const click = event.button === 0 && this.clickStart && !event.buttons && Math.hypot(event.clientX - this.clickStart.x, event.clientY - this.clickStart.y) <= 6
    this.clickStart = null
    this.buttons &= event.buttons & 3
    if (!this.buttons) this.element.classList.remove('worker-looking')
    if (!movementIntent(this.keys, this.buttons).moving) this.onSave()
    if (click) this.onPick?.(event)
  }

  lookAt(point) {
    const worker = this.getWorker()
    if (!worker) return
    const direction = point.clone().sub(this.cameraTarget)
    this.yaw = Math.atan2(direction.x, direction.z)
    this.pitch = THREE.MathUtils.clamp(Math.atan2(-direction.y, Math.hypot(direction.x, direction.z)), -0.12, 1.25)
    this.clearInput()
  }

  updateMovement(delta, paused) {
    this.intent = movementIntent(this.keys, this.buttons)
    this.isMoving = this.active && this.intent.moving && !paused && !this.readOnly
    const worker = this.getWorker()
    if (!this.active || !worker) return
    if (!this.readOnly && (this.buttons & 2)) worker.visual.root.rotation.y = this.yaw
    if (!this.isMoving) return
    const yaw = worker.visual.root.rotation.y, { forward, strafe } = this.intent
    const step = this.moveSpeed * delta
    worker.position[0] += (Math.sin(yaw) * forward - Math.cos(yaw) * strafe) * step
    worker.position[2] += (Math.cos(yaw) * forward + Math.sin(yaw) * strafe) * step
  }

  updateCamera(worker, delta, snap = false) {
    const blend = snap ? 1 : 1 - Math.exp(-delta / 0.09)
    this.distance += (this.targetDistance - this.distance) * (snap ? 1 : 1 - Math.exp(-delta / 0.12))
    if (Math.abs(this.targetDistance - this.distance) < 0.002) this.distance = this.targetDistance
    const eyeBlend = THREE.MathUtils.clamp(this.distance / 1.5, 0, 1)
    const height = THREE.MathUtils.lerp(1.67, 1.25, eyeBlend) + (worker.jump?.height || 0)
    this.desiredPosition.set(worker.position[0], worker.position[1] + height, worker.position[2])
    if (snap) this.cameraTarget.copy(this.desiredPosition)
    else this.cameraTarget.lerp(this.desiredPosition, blend)
    this.viewDirection.set(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch))
    this.desiredPosition.copy(this.cameraTarget).addScaledVector(this.viewDirection, -this.distance)
    this.desiredPosition.y = Math.max(worker.position[1] + 0.2, this.desiredPosition.y)
    this.camera.position.copy(this.desiredPosition)
    this.camera.lookAt(this.desiredPosition.copy(this.camera.position).addScaledVector(this.viewDirection, 10))
    worker.visual.root.visible = this.distance >= 0.55
  }

  dispose() {
    this.exit()
    this.element.removeEventListener('mousedown', this.down)
    this.element.removeEventListener('wheel', this.wheel, true)
    window.removeEventListener('mousemove', this.move)
    window.removeEventListener('mouseup', this.up)
    window.removeEventListener('blur', this.reset)
    window.removeEventListener('pointercancel', this.reset)
    document.removeEventListener('visibilitychange', this.visibility)
    document.removeEventListener('focusin', this.focus)
  }
}

export function isEditing(element) {
  return /INPUT|SELECT|TEXTAREA/.test(element?.tagName) || Boolean(element?.isContentEditable)
}
