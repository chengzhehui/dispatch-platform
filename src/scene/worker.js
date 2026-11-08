import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { createWeldingVisual } from './WeldingVisual.js'

let workerAsset = null
let assetPromise = null
export function preloadWorker() {
  if (!assetPromise) assetPromise = new GLTFLoader().loadAsync('/models/workers/worker.glb').then(asset => {
    asset.scene.traverse(object => {
      if (!object.isMesh) return
      object.frustumCulled = false
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) { material.metalness = 0; material.roughness = 0.78 }
    })
    workerAsset = asset
    return asset
  })
  return assetPromise
}

export function createWorker(id) {
  if (!workerAsset) return createFallbackWorker(id)
  const root = new THREE.Group(), body = new THREE.Group(), model = clone(workerAsset.scene)
  root.name = id; root.add(body); body.add(model)
  const mixer = new THREE.AnimationMixer(model)
  const findClip = name => workerAsset.animations.find(clip => clip.name.split('|').at(-1) === name)
  const actions = Object.fromEntries(['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right'].map(name => [name, mixer.clipAction(findClip(name) || findClip('Walk'))]))
  const idle = actions.Idle, walk = actions.Walk
  idle.play(); mixer.update(0)
  // Skinning bounds must use the evaluated pose, including all bone parents.
  // Stale bind-pose matrices can inflate bounds and shrink the cloned character.
  root.updateMatrixWorld(true)
  model.traverse(object => { if (object.isSkinnedMesh) object.skeleton.update() })
  const bounds = new THREE.Box3().setFromObject(model, true), height = bounds.max.y - bounds.min.y
  const scale = 1.85 / height
  body.scale.setScalar(scale)
  body.position.set(-(bounds.max.x + bounds.min.x) / 2 * scale, -bounds.min.y * scale, -(bounds.max.z + bounds.min.z) / 2 * scale)
  const welding = createWeldingVisual(root, body, model)
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.83, 40), new THREE.MeshBasicMaterial({ color: 0x5affbd, side: THREE.DoubleSide, depthTest: false }))
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.renderOrder = 10; ring.visible = false; root.add(ring)
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 2.1, 8), new THREE.MeshBasicMaterial({ visible: false }))
  hit.position.y = 1; hit.userData.workerId = id; root.add(hit)
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0x6be9bd, dashSize: 1.4, gapSize: 0.8, depthTest: false, transparent: true, opacity: 0.8 }))
  path.visible = false; path.renderOrder = 9
  const jumpAngles = { upperlegl: -0.4, upperlegr: -0.4, lowerlegl: 0.65, lowerlegr: 0.65, upperarml: -0.25, upperarmr: -0.25 }
  const jumpPose = []
  model.traverse(object => {
    const angle = jumpAngles[object.name.toLowerCase().replace(/[^a-z]/g, '')]
    if (object.isBone && angle !== undefined) jumpPose.push({ bone: object, angle, previous: 0, axis: new THREE.Vector3(1, 0, 0) })
  })
  const poseQuaternion = new THREE.Quaternion(), characterAxis = new THREE.Vector3()
  let currentAction = idle
  return { root, body, model, mixer, ring, hit, path, welding, assetName: 'Quaternius Worker', animate(time, moving, dt, speed, motion = {}) {
    if (motion.paused) return
    welding.beforeAnimation()
    for (const pose of jumpPose) { if (pose.previous) pose.bone.rotateOnAxis(pose.axis, -pose.previous); pose.previous = 0 }
    let action = moving ? walk : idle
    if (moving && motion.manual && speed >= 3) {
      const { forward = 0, strafe = 0 } = motion.intent || {}
      action = Math.abs(strafe) > Math.abs(forward) ? (strafe < 0 ? actions.Run_Left : actions.Run_Right) : (forward < 0 ? actions.Run_Back : actions.Run)
    }
    if (action !== currentAction) { action.reset().play(); currentAction.crossFadeTo(action, 0.16, true); currentAction = action }
    walk.timeScale = Math.max(0.8, Math.min(2.4, speed / 6))
    for (const name of ['Run', 'Run_Back', 'Run_Left', 'Run_Right']) actions[name].timeScale = THREE.MathUtils.clamp(speed / 4.5, 0.7, 1.8)
    mixer.update(dt)
    const strength = THREE.MathUtils.clamp((motion.jumpHeight || 0) / 0.65, 0, 1)
    if (strength) {
      characterAxis.set(1, 0, 0).applyQuaternion(root.getWorldQuaternion(poseQuaternion))
      for (const pose of jumpPose) {
        pose.axis.copy(characterAxis).applyQuaternion(pose.bone.getWorldQuaternion(poseQuaternion).invert()).normalize()
        pose.previous = pose.angle * strength
        pose.bone.rotateOnAxis(pose.axis, pose.previous)
      }
    }
    welding.afterAnimation(dt, motion)
  }, dispose() {
    welding.dispose()
    mixer.stopAllAction(); mixer.uncacheRoot(model)
    model.traverse(object => { if (object.isSkinnedMesh) object.skeleton.dispose() })
    for (const mesh of [ring, hit, path]) { mesh.geometry.dispose(); mesh.material.dispose() }
  } }
}

const materials = {
  orange: new THREE.MeshStandardMaterial({ color: 0xed8b36, roughness: 0.8 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x273744 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xd6aa83 }),
  helmet: new THREE.MeshStandardMaterial({ color: 0xffcf54 }),
  stripe: new THREE.MeshStandardMaterial({ color: 0xe3ead2 }),
}
function box(parent, dimensions, position, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material)
  mesh.position.set(...position); parent.add(mesh); return mesh
}
function createFallbackWorker(id) {
  const root = new THREE.Group(), body = new THREE.Group()
  root.add(body)
  box(body, [0.53, 0.66, 0.32], [0, 1.12, 0], materials.orange)
  box(body, [0.55, 0.08, 0.34], [0, 1.12, 0], materials.stripe)
  box(body, [0.12, 0.12, 0.12], [0, 1.48, 0], materials.skin)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 10), materials.skin)
  head.position.y = 1.65; body.add(head)
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.23, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), materials.helmet)
  helmet.position.y = 1.7; body.add(helmet)
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.045, 14), materials.helmet)
  brim.position.y = 1.71; body.add(brim)
  box(body, [0.26, 0.19, 0.05], [0, 1.63, 0.18], materials.dark)
  const limbs = []
  for (const sign of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sign * 0.15, 0.82, 0); body.add(leg)
    box(leg, [0.22, 0.65, 0.24], [0, -0.32, 0], materials.orange)
    box(leg, [0.23, 0.07, 0.25], [0, -0.44, 0], materials.stripe)
    box(leg, [0.25, 0.16, 0.4], [0, -0.73, 0.07], materials.dark)
    const arm = new THREE.Group(); arm.position.set(sign * 0.37, 1.38, 0); body.add(arm)
    box(arm, [0.19, 0.57, 0.21], [0, -0.26, 0], materials.orange)
    box(arm, [0.17, 0.15, 0.19], [0, -0.58, 0], materials.dark)
    limbs.push({ leg, arm, sign })
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.83, 40), new THREE.MeshBasicMaterial({ color: 0x5affbd, side: THREE.DoubleSide, depthTest: false }))
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.renderOrder = 10; ring.visible = false; root.add(ring)
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 2.1, 8), new THREE.MeshBasicMaterial({ visible: false }))
  hit.position.y = 1; hit.userData.workerId = id; root.add(hit)
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0x6be9bd, dashSize: 1.4, gapSize: 0.8, depthTest: false, transparent: true, opacity: 0.8 }))
  path.visible = false; path.renderOrder = 9
  return { root, body, ring, hit, path, animate(time, moving) {
    for (const { leg, arm, sign } of limbs) { leg.rotation.x = moving ? Math.sin(time * 9) * 0.48 * sign : 0; arm.rotation.x = -leg.rotation.x }
    body.position.y = moving ? Math.abs(Math.sin(time * 9)) * 0.045 : 0
  } }
}
