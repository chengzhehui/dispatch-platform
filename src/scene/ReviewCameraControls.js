import * as THREE from 'three'
import CameraControls from 'camera-controls'

CameraControls.install({ THREE })

// Keep a code-editable target for overview/staging/zone navigation while using
// the same smooth dolly controller as three-demo for actual mouse interaction.
export class ReviewCameraControls {
  constructor(camera, element) {
    this.camera = camera
    this.element = element
    camera.position.set(0, 100, 150)
    this.target = new THREE.Vector3()
    this.controller = new CameraControls(camera, element)
    this.controller.smoothTime = 0.12
    this.controller.draggingSmoothTime = 0.08
    this.controller.dollyToCursor = true
    this.controller.infinityDolly = true
    this.controller.minDistance = 0.35
    this.controller.maxDistance = 5000
    this.controller.maxPolarAngle = Math.PI * 0.48
    this.controller.mouseButtons.left = CameraControls.ACTION.NONE
    this.controller.mouseButtons.right = CameraControls.ACTION.NONE
    this.controller.mouseButtons.middle = CameraControls.ACTION.TRUCK
    this.controller.mouseButtons.wheel = CameraControls.ACTION.DOLLY
    this.lastPosition = camera.position.clone()
    this.lastTarget = this.target.clone()
    this.modifier = event => {
      if (event.button === 1) this.controller.mouseButtons.middle = event.shiftKey ? CameraControls.ACTION.ROTATE : CameraControls.ACTION.TRUCK
    }
    element.addEventListener('pointerdown', this.modifier, true)
  }

  get enabled() { return this.controller.enabled }
  set enabled(value) {
    if (!value && this.controller.enabled) {
      this.controller.setFocalOffset(0, 0, 0, false)
      this.controller.setLookAt(...this.camera.position.toArray(), ...this.target.toArray(), false)
      this.controller.stop()
    }
    this.controller.enabled = value
  }

  update(delta = 1 / 60) {
    if (!this.enabled) return false
    if (!this.camera.position.equals(this.lastPosition) || !this.target.equals(this.lastTarget)) {
      this.controller.setFocalOffset(0, 0, 0, false)
      this.controller.setLookAt(...this.camera.position.toArray(), ...this.target.toArray(), false)
    }
    const changed = this.controller.update(delta)
    this.controller.getTarget(this.target, false)
    this.lastPosition.copy(this.camera.position)
    this.lastTarget.copy(this.target)
    return changed
  }

  reanchor(point) {
    this.controller.setOrbitPoint(...point.toArray())
    this.controller.update(0)
    this.controller.getTarget(this.target, false)
    this.lastPosition.copy(this.camera.position); this.lastTarget.copy(this.target)
  }

  focusBounds(bounds) {
    const center = bounds.getCenter(new THREE.Vector3())
    const size = bounds.getSize(new THREE.Vector3())
    // A tiny weld still needs context; use the same view direction when refocusing.
    const radius = Math.max(0.9, size.length() / 2)
    const halfFov = Math.min(THREE.MathUtils.degToRad(this.camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect))
    const distance = radius / Math.sin(halfFov) * 1.3
    const direction = this.camera.getWorldDirection(new THREE.Vector3()).negate()
    const position = center.clone().addScaledVector(direction, distance)
    this.controller.setFocalOffset(0, 0, 0, true)
    this.controller.setLookAt(...position.toArray(), ...center.toArray(), true)
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this.modifier, true)
    this.controller.dispose()
  }
}
