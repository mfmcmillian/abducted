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
const DOOR_W = 0.54 * POD_SCALE
const DOOR_H = (0.5 - POD_FLOOR) * POD_SCALE
const DOOR_Z = 0.3 * POD_SCALE // force field plane, flush with the inner wall at the doorway (+Z local = toward the dome centre)
const GREEN = Color3.create(0.35, 1, 0.5)
const WHITE = Color3.create(1, 1, 1)

export const POD_CHARGE_SECONDS = 3.9 // seal voice (1.7) + countdown (2.0)

type PodState = 'open' | 'charging' | 'flash' | 'closed'
const pod = { state: 'open' as PodState, t: 0, welcomeCooldown: 0, nearby: false, inside: false }

let field: Entity
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

  // Force field across the doorway: invisible while open, a green shimmer when sealed.
  field = engine.addEntity()
  Transform.create(field, { parent: root, position: Vector3.create(0, DOOR_H / 2 + 0.02, DOOR_Z), scale: Vector3.create(DOOR_W, DOOR_H, 1) })
  MeshRenderer.setPlane(field)
  VisibilityComponent.create(field, { visible: false })
  setField(0)

  innerLight = engine.addEntity()
  Transform.create(innerLight, { parent: root, position: Vector3.create(0, 0.6 * POD_SCALE, 0) })
  LightSource.create(innerLight, { active: true, color: GREEN, intensity: 300, range: 9, shadow: false, type: LightSource.Type.Point({}) })
  ringLight = engine.addEntity()
  Transform.create(ringLight, { parent: root, position: Vector3.create(0, 0.6, 0.3 * POD_SCALE) })
  LightSource.create(ringLight, { active: true, color: GREEN, intensity: 250, range: 6, shadow: false, type: LightSource.Type.Point({}) })
  setHum = attachLoop(root, SFX.beamHum, 0.1)

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
  return root
}

/** World-space point above the pod floor, for spatial sounds and sparks. */
function podPoint(y: number) {
  return Vector3.create(LAUNCH_PAD.x, y, LAUNCH_PAD.z)
}

function setField(k: number) {
  VisibilityComponent.getMutable(field).visible = k > 0
  Material.setPbrMaterial(field, {
    albedoColor: Color4.create(0.4, 1, 0.55, 0.05 + 0.3 * k),
    emissiveColor: GREEN,
    emissiveIntensity: 0.4 + 3 * k,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
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
    setField(0)
    setHum(0.1 + breathe * 0.04)
  } else if (pod.state === 'charging') {
    const k = Math.min(1, pod.t / POD_CHARGE_SECONDS)
    const flicker = 0.5 + Math.sin(pod.t * (8 + k * 30)) * 0.5
    inner.color = Color3.lerp(GREEN, WHITE, k * k)
    inner.intensity = 400 + k * 3600 + flicker * 300 * k
    ring.intensity = 300 + k * 1200
    setField(0.6 + flicker * 0.4)
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
    setField(1 - 0.4 * k)
    setHum(1 - 0.85 * k)
    if (pod.state === 'flash' && pod.t > 1.5) pod.state = 'closed'
  }
}
