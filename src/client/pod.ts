import {
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  LightSource,
  Material,
  MaterialTransparencyMode,
  MeshRenderer,
  VisibilityComponent,
  Transform,
  TriggerArea,
  triggerAreaEventsSystem
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, LAUNCH_PAD } from '../layout'
import { burstImpact, puffTrail } from './fx'
import { ROOT } from './root'
import { attachLoop, playAt, playGlobal, SFX } from './sfx'
import { zoomUi } from './ui'

/**
 * The abduction pod: the lobby's Play interaction. An open-fronted capsule (models/abduction-pod.glb,
 * Meshy) on the launch pad spot, doorway toward the dome centre. Walk in and it seals behind you
 * with a force field, the ship's voice counts you down, the light inside builds to white and you
 * are transferred to the pasture. game.ts drives the phase: it calls seal() when the player steps
 * in, launch() when the charge is complete and release() when they come back.
 */

// Meshy model fit. The capsule is 1.08 wide x 1.9 tall, origin mid-height, bottom at y -0.953,
// inner radius ~0.31, interior floor at y -0.623 and ceiling at 0.474. The doorway (cut in Blender,
// 0.54 wide, up to y 0.5) faces model +Z; the shell is double-sided so the inside of the skin is
// the pod's interior. The pod is sunk so its interior floor is the dome floor: no step to climb.
const POD_SCALE = 7 // comically large: 11 m visible, 4.3 m across inside, 3.8 x 7.9 m doorway
const POD_FLOOR = -0.623
const BEAM_R = 0.5 * POD_SCALE // cylinder scale (unit cylinder is 1 m across): 3.5 m beam inside the 4.3 m interior
const BEAM_H = (0.474 - POD_FLOOR) * POD_SCALE - 0.2 // floor to ceiling
const RINGS = 4
const GREEN = Color3.create(0.35, 1, 0.5)
const WHITE = Color3.create(1, 1, 1)

export const POD_CHARGE_SECONDS = 3.9 // seal voice (1.7) + countdown (2.0)

type PodState = 'open' | 'charging' | 'flash' | 'closed'
const pod = { state: 'open' as PodState, t: 0, welcomeCooldown: 0, nearby: false, inside: false }

let beam: Entity
const rings: Entity[] = []
let innerLight: Entity
let ringLight: Entity
let setHum: (v: number) => void = () => {}
let onBoard: () => void = () => {}
let flashLeft = 0

/** Whether the player is standing in the pod right now. */
export const playerInPod = () => pod.inside

export function createPod(board: () => void) {
  onBoard = board
  const yaw = (Math.atan2(CENTER.x - LAUNCH_PAD.x, CENTER.z - LAUNCH_PAD.z) * 180) / Math.PI // doorway (+Z) toward the centre
  const root = engine.addEntity()
  Transform.create(root, { parent: ROOT, position: Vector3.create(LAUNCH_PAD.x, 0, LAUNCH_PAD.z), rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })

  const shell = engine.addEntity()
  Transform.create(shell, { parent: root, position: Vector3.create(0, 0.02 - POD_FLOOR * POD_SCALE, 0), scale: Vector3.create(POD_SCALE, POD_SCALE, POD_SCALE) })
  GltfContainer.create(shell, { src: 'models/abduction-pod.glb', visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })

  // The transfer beam: a column of light filling the capsule with rings climbing it, only while sealed.
  beam = engine.addEntity()
  Transform.create(beam, { parent: root, position: Vector3.create(0, BEAM_H / 2 + 0.1, 0), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(beam)
  VisibilityComponent.create(beam, { visible: false })
  for (let i = 0; i < RINGS; i++) {
    const ring = engine.addEntity()
    Transform.create(ring, { parent: root, position: Vector3.create(0, 0.1, 0), scale: Vector3.Zero() })
    MeshRenderer.setCylinder(ring)
    VisibilityComponent.create(ring, { visible: false })
    Material.setPbrMaterial(ring, { albedoColor: Color4.create(0.6, 1, 0.75, 0.85), emissiveColor: WHITE, emissiveIntensity: 5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false })
    rings.push(ring)
  }
  setBeam(0)

  innerLight = engine.addEntity()
  Transform.create(innerLight, { parent: root, position: Vector3.create(0, 0.6 * POD_SCALE, 0) })
  LightSource.create(innerLight, { active: true, color: GREEN, intensity: 300, range: 9, shadow: false, type: LightSource.Type.Point({}) })
  ringLight = engine.addEntity()
  Transform.create(ringLight, { parent: root, position: Vector3.create(0, 0.6, 0.3 * POD_SCALE) })
  LightSource.create(ringLight, { active: true, color: GREEN, intensity: 250, range: 6, shadow: false, type: LightSource.Type.Point({}) })
  setHum = attachLoop(root, SFX.beamHum, 0.1)
  createDressing(root, yaw)

  // Approach zone: the pod invites you once per visit.
  const near = engine.addEntity()
  Transform.create(near, { parent: root, position: Vector3.create(0, 1.5, 0.7 * POD_SCALE), scale: Vector3.create(12, 3, 12) })
  TriggerArea.setBox(near)
  triggerAreaEventsSystem.onTriggerEnter(near, () => {
    pod.nearby = true
    if (pod.state === 'open' && pod.welcomeCooldown <= 0) {
      pod.welcomeCooldown = 30
      playAt(SFX.podWelcome, podPoint(2), 1)
    }
  })
  triggerAreaEventsSystem.onTriggerExit(near, () => (pod.nearby = false))

  // Inside the capsule.
  const inside = engine.addEntity()
  Transform.create(inside, { parent: root, position: Vector3.create(0, 0.5 * POD_SCALE, 0), scale: Vector3.create(0.4 * POD_SCALE, POD_SCALE, 0.4 * POD_SCALE) })
  TriggerArea.setBox(inside)
  triggerAreaEventsSystem.onTriggerEnter(inside, () => {
    pod.inside = true
    if (pod.state === 'open') onBoard()
  })
  triggerAreaEventsSystem.onTriggerExit(inside, () => (pod.inside = false))

  engine.addSystem(podSystem)
  engine.addSystem(dressingSystem)
  return root
}

// ---- dressing: pulsing green interior + animated coolant packs on the hull ----
const CYAN = Color3.create(0.3, 0.95, 1)
const glowEntities: { entity: Entity; phase: number; alpha: number; color: Color3 }[] = []
const fans: Entity[] = []
const vents: { pos: Vector3; next: number }[] = []
let dressClock = 0
let dressTick = 0

function glow(entity: Entity, color: Color3, alpha: number, phase: number) {
  glowEntities.push({ entity, phase, alpha, color })
  Material.setPbrMaterial(entity, {
    albedoColor: Color4.create(color.r, color.g, color.b, alpha),
    emissiveColor: color,
    emissiveIntensity: 2,
    transparencyMode: alpha < 1 ? MaterialTransparencyMode.MTM_ALPHA_BLEND : MaterialTransparencyMode.MTM_OPAQUE,
    castShadows: false
  })
}

function createDressing(root: Entity, yaw: number) {
  const S = POD_SCALE
  // Interior: glowing floor disc, ceiling disc and three wall strips that breathe green.
  const floor = engine.addEntity()
  Transform.create(floor, { parent: root, position: Vector3.create(0, 0.06, 0), scale: Vector3.create(0.56 * S, 0.08, 0.56 * S) })
  MeshRenderer.setCylinder(floor)
  glow(floor, GREEN, 0.85, 0)
  const ceiling = engine.addEntity()
  Transform.create(ceiling, { parent: root, position: Vector3.create(0, (0.474 - POD_FLOOR) * S - 0.1, 0), scale: Vector3.create(0.5 * S, 0.08, 0.5 * S) })
  MeshRenderer.setCylinder(ceiling)
  glow(ceiling, GREEN, 0.85, 0.5)
  for (let i = 0; i < 3; i++) {
    const a = Math.PI + ((i - 1) * Math.PI) / 2.2 // on the back half of the inner wall
    const strip = engine.addEntity()
    Transform.create(strip, {
      parent: root,
      position: Vector3.create(Math.sin(a) * 0.29 * S, 0.55 * S, Math.cos(a) * 0.29 * S),
      rotation: Quaternion.fromEulerDegrees(0, (a * 180) / Math.PI, 0),
      scale: Vector3.create(0.05 * S, 0.8 * S, 0.02 * S)
    })
    MeshRenderer.setBox(strip)
    glow(strip, GREEN, 0.9, 1 + i * 0.7)
  }

  // Exterior: four coolant packs clamped to the hull, each a housing, a glowing tank, a spinning fan and a vent.
  const rad = (deg: number) => (deg * Math.PI) / 180
  for (const deg of [-125, -65, 65, 125]) {
    const a = rad(deg) + Math.PI // measured from the back (door is +Z)
    const r = 0.4 * S
    const pack = engine.addEntity()
    Transform.create(pack, {
      parent: root,
      position: Vector3.create(Math.sin(a) * r, 0.45 * S, Math.cos(a) * r),
      rotation: Quaternion.fromEulerDegrees(0, (a * 180) / Math.PI, 0)
    })
    const housing = engine.addEntity()
    Transform.create(housing, { parent: pack, position: Vector3.create(0, 0, 0.06 * S), scale: Vector3.create(0.16 * S, 0.5 * S, 0.12 * S) })
    MeshRenderer.setBox(housing)
    Material.setPbrMaterial(housing, { albedoColor: Color4.create(0.08, 0.1, 0.11, 1), metallic: 0.9, roughness: 0.35, castShadows: false })
    const tank = engine.addEntity()
    Transform.create(tank, { parent: pack, position: Vector3.create(0, 0, 0.13 * S), scale: Vector3.create(0.09 * S, 0.42 * S, 0.09 * S) })
    MeshRenderer.setCylinder(tank)
    glow(tank, CYAN, 0.7, deg / 40)
    const fan = engine.addEntity()
    Transform.create(fan, { parent: pack, position: Vector3.create(0, 0.3 * S, 0.1 * S), scale: Vector3.create(0.12 * S, 0.012 * S, 0.12 * S) })
    MeshRenderer.setCylinder(fan)
    Material.setPbrMaterial(fan, { albedoColor: Color4.create(0.6, 0.65, 0.7, 1), metallic: 1, roughness: 0.2, castShadows: false })
    fans.push(fan)
    const blade = engine.addEntity()
    Transform.create(blade, { parent: fan, scale: Vector3.create(1.9, 1, 0.12) })
    MeshRenderer.setBox(blade)
    Material.setPbrMaterial(blade, { albedoColor: Color4.create(0.2, 0.22, 0.25, 1), metallic: 1, roughness: 0.3, castShadows: false })
    const blade2 = engine.addEntity()
    Transform.create(blade2, { parent: fan, rotation: Quaternion.fromEulerDegrees(0, 90, 0), scale: Vector3.create(1.9, 1, 0.12) })
    MeshRenderer.setBox(blade2)
    Material.setPbrMaterial(blade2, { albedoColor: Color4.create(0.2, 0.22, 0.25, 1), metallic: 1, roughness: 0.3, castShadows: false })
    // vent position in scene space, for steam puffs
    const lx = Math.sin(a) * (r + 0.1 * S), lz = Math.cos(a) * (r + 0.1 * S)
    const wy = rad(yaw)
    vents.push({ pos: Vector3.create(LAUNCH_PAD.x + lx * Math.cos(wy) + lz * Math.sin(wy), 0.78 * S, LAUNCH_PAD.z - lx * Math.sin(wy) + lz * Math.cos(wy)), next: Math.random() * 3 })
  }
}

function dressingSystem(dt: number) {
  dressClock += dt
  const charging = pod.state === 'charging'
  const spin = charging ? 1400 : 420
  for (const fan of fans) {
    const t = Transform.getMutable(fan)
    t.rotation = Quaternion.multiply(t.rotation, Quaternion.fromEulerDegrees(0, spin * dt, 0))
  }
  for (const v of vents) {
    v.next -= dt
    if (v.next <= 0) {
      v.next = charging ? 0.25 : 1.8 + Math.random() * 2.5
      for (let i = 0; i < 3; i++) puffTrail(Vector3.create(v.pos.x, v.pos.y + i * 0.3, v.pos.z), Color3.create(0.85, 1, 1), 0.7)
    }
  }
  dressTick += dt
  if (dressTick < 0.08) return
  dressTick = 0
  const rate = charging ? 9 : 2.4
  for (const g of glowEntities) {
    const k = 0.5 + Math.sin(dressClock * rate + g.phase) * 0.5
    const m = Material.getMutable(g.entity)
    if (m.material?.$case === 'pbr') {
      m.material.pbr.emissiveIntensity = 1 + k * (charging ? 7 : 3.5)
      m.material.pbr.albedoColor = Color4.create(g.color.r, g.color.g, g.color.b, g.alpha * (0.7 + 0.3 * k))
    }
  }
}

/** World-space point above the pod floor, for spatial sounds and sparks. */
function podPoint(y: number) {
  return Vector3.create(LAUNCH_PAD.x, y, LAUNCH_PAD.z)
}

/** k = 0 off; otherwise the beam's strength: radius, glow and how fast the rings climb. */
function setBeam(k: number) {
  const on = k > 0
  VisibilityComponent.getMutable(beam).visible = on
  const r = BEAM_R * Math.min(1, k * 1.3)
  Transform.getMutable(beam).scale = Vector3.create(r, BEAM_H, r)
  Material.setPbrMaterial(beam, {
    albedoColor: Color4.create(0.5, 1, 0.65, 0.12 + 0.2 * k),
    emissiveColor: Color3.lerp(GREEN, WHITE, Math.max(0, k - 0.6) * 2.5),
    emissiveIntensity: 0.6 + 4 * k,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  for (let i = 0; i < RINGS; i++) {
    VisibilityComponent.getMutable(rings[i]).visible = on
    const t = Transform.getMutable(rings[i])
    const u = ((pod.t * (0.35 + k * 0.9) + i / RINGS) % 1 + 1) % 1 // climbs faster as the charge builds
    t.position = Vector3.create(0, 0.1 + u * BEAM_H, 0)
    const rr = r * (1.08 + 0.1 * Math.sin(u * Math.PI))
    t.scale = Vector3.create(rr, 0.06 + 0.1 * k, rr)
  }
}

/** The player stepped in: seal the doorway and start the countdown. */
export function sealPod() {
  if (pod.state !== 'open') return
  pod.state = 'charging'
  pod.t = 0
  playAt(SFX.podSeal, podPoint(1.5), 0.9)
  playGlobal(SFX.podSecured, 1)
  playAt(SFX.beamCharge, podPoint(1.5), 0.7)
}

/** Charge complete: white-out, the launch line, sparks; the pod stays shut until release(). */
export function launchPod() {
  pod.state = 'flash'
  pod.t = 0
  flashLeft = 1
  zoomUi.white = 1
  playGlobal(SFX.podLaunch, 1)
  playAt(SFX.lift, podPoint(1.5), 1)
  burstImpact(podPoint(1.4), GREEN, 1.6)
  for (let i = 0; i < 6; i++) puffTrail(podPoint(0.4 + i * 0.4), WHITE, 0.5)
}

/** The player is back in the dome: reopen the pod. */
export function releasePod(announce = true) {
  if (pod.state === 'open') return
  pod.state = 'open'
  pod.t = 0
  pod.welcomeCooldown = 30
  if (announce) playGlobal(SFX.podReturn, 1)
}

function podSystem(dt: number) {
  pod.t += dt
  pod.welcomeCooldown -= dt
  if (flashLeft > 0) {
    flashLeft -= dt
    zoomUi.white = Math.max(0, zoomUi.white - dt * 1.4)
  }
  const inner = LightSource.getMutable(innerLight)
  const ring = LightSource.getMutable(ringLight)
  if (pod.state === 'open') {
    const breathe = 0.5 + Math.sin(pod.t * 2.2) * 0.5
    inner.color = GREEN
    inner.intensity = 250 + breathe * 150
    ring.intensity = 200 + breathe * 200
    setBeam(0)
    setHum(0.1 + breathe * 0.04)
  } else if (pod.state === 'charging') {
    const k = Math.min(1, pod.t / POD_CHARGE_SECONDS)
    const flicker = 0.5 + Math.sin(pod.t * (8 + k * 30)) * 0.5
    inner.color = Color3.lerp(GREEN, WHITE, k * k)
    inner.intensity = 400 + k * 3600 + flicker * 300 * k
    ring.intensity = 300 + k * 1200
    setBeam(0.6 + flicker * 0.4)
    setHum(0.2 + k * 0.8)
    // the countdown line picks up when the seal line ends
    if (pod.t >= 1.8 && pod.t - dt < 1.8) playGlobal(SFX.podCount, 1)
    if (Math.floor(pod.t * 6) !== Math.floor((pod.t - dt) * 6)) puffTrail(podPoint(0.3 + Math.random() * 2.2), GREEN, 0.35)
  } else {
    // flash then closed: bright white dying back to a sealed green glow until release()
    const k = Math.min(1, pod.t / 1.5)
    inner.color = Color3.lerp(WHITE, GREEN, k)
    inner.intensity = 4000 * (1 - k) + 300
    ring.intensity = 1500 * (1 - k) + 250
    setBeam(1 - 0.4 * k)
    setHum(1 - 0.85 * k)
    if (pod.state === 'flash' && pod.t > 1.5) pod.state = 'closed'
  }
}
