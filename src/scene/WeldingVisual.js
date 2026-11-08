import * as THREE from 'three'

export function weldingPose(time, crouch = false) {
  const rub = Math.sin(time * 4.2), twist = Math.cos(time * 4.2)
  const upper = crouch ? -0.6 : -1, lower = crouch ? -0.6 : -0.9
  return {
    chest: { x: 0.16 }, head: { x: 0.2 },
    upperarml: { x: upper + rub * 0.05, y: -0.24 }, upperarmr: { x: upper - rub * 0.05, y: 0.24 },
    lowerarml: { x: lower + rub * 0.12, y: -0.18 }, lowerarmr: { x: lower - rub * 0.12, y: 0.18 },
    wristl: { x: twist * 0.13, z: rub * 0.12 }, wristr: { x: -twist * 0.13, z: -rub * 0.12 },
    upperlegl: { x: crouch ? -0.72 : 0 }, upperlegr: { x: crouch ? -0.72 : 0 },
    lowerlegl: { x: crouch ? 1.15 : 0 }, lowerlegr: { x: crouch ? 1.15 : 0 },
  }
}

export function createWeldingVisual(root, body, model) {
  const bones = new Map()
  model.traverse(object => { if (object.isBone) bones.set(object.name.toLowerCase().replace(/[^a-z]/g, ''), object) })
  const applied = [], baseY = body.position.y, quaternion = new THREE.Quaternion(), rootQuaternion = new THREE.Quaternion()
  const tools = new THREE.Group(); tools.name = 'welder-working-tools'; tools.visible = false; root.add(tools)
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: 0xbcefff, toneMapped: false }))
  const sparkGeometry = new THREE.BufferGeometry()
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(36), 3))
  const sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({ color: 0xffc879, size: 0.04, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }))
  tools.add(glow, sparks)
  const hand = new THREE.Vector3(), target = new THREE.Vector3(), direction = new THREE.Vector3()
  let blend = 0
  return {
    tools,
    beforeAnimation() {
      for (let i = applied.length - 1; i >= 0; i--) applied[i].bone.rotateOnAxis(applied[i].axis, -applied[i].angle)
      applied.length = 0
      body.position.y = baseY
    },
    afterAnimation(delta, motion) {
      blend = THREE.MathUtils.damp(blend, motion.welding ? 1 : 0, 12, delta)
      if (blend < 0.002) blend = 0
      tools.visible = !!motion.welding
      if (!blend) return
      const angles = weldingPose(motion.weldTime || 0, !!motion.crouch)
      root.getWorldQuaternion(rootQuaternion)
      for (const [name, rotations] of Object.entries(angles)) {
        const bone = bones.get(name)
        if (!bone) continue
        for (const [axisName, value] of Object.entries(rotations)) {
          const angle = value * blend
          if (!angle) continue
          const axis = new THREE.Vector3(axisName === 'x' ? 1 : 0, axisName === 'y' ? 1 : 0, axisName === 'z' ? 1 : 0)
            .applyQuaternion(rootQuaternion).applyQuaternion(bone.getWorldQuaternion(quaternion).invert()).normalize()
          bone.rotateOnAxis(axis, angle); applied.push({ bone, axis, angle })
        }
      }
      body.position.y = baseY - (motion.crouch ? 0.14 : 0) * blend
      if (!motion.welding) return
      const wrist = bones.get('wristr')
      if (wrist) root.worldToLocal(wrist.getWorldPosition(hand))
      else hand.set(0.1, 1.05, 0.55)
      if (motion.weldPoint) root.worldToLocal(target.fromArray(motion.weldPoint))
      else target.copy(hand).add(new THREE.Vector3(0, 0, 0.5))
      direction.subVectors(target, hand).normalize()
      glow.position.copy(hand).addScaledVector(direction, 0.29)
      glow.scale.setScalar(0.9 + Math.sin((motion.weldTime || 0) * 5) * 0.1)
      sparks.position.copy(glow.position)
      const positions = sparkGeometry.attributes.position, time = motion.weldTime || 0
      for (let i = 0; i < positions.count; i++) {
        const phase = (time * 1.6 + i / positions.count) % 1, angle = i * 2.4
        positions.setXYZ(i, Math.cos(angle) * phase * 0.19, phase * 0.16 - phase * phase * 0.28, Math.sin(angle) * phase * 0.19)
      }
      positions.needsUpdate = true
    },
    dispose() {
      root.remove(tools)
      tools.traverse(object => { object.geometry?.dispose(); object.material?.dispose() })
      tools.clear()
    },
  }
}
