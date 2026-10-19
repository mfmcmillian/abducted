import { engine, Entity, LightSource, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { puffTrail } from './fx'
import { ROOT } from './root'
import { playAt, SFX } from './sfx'

/**
 * The launch portal: a swirling vortex (images/fx-portal-sheet.png, a 4x4 PNG flipbook) that tears
 * open in front of the cow launcher before a shot, so the cow visibly leaves the ship through
 * something rather than just flying off. Opens with a wobble, spins while held, snaps shut.
 */

const COLS = 4, ROWS = 4, FRAMES = 16
const FPS = 18
const OPEN_T = 0.9
const CLOSE_T = 0.45
const SIZE = 6 // metres across when fully open
const PINK = Color3.create(1, 0.45, 0.9)

type Portal = { t: number; hold: number; frame: number; frameT: number } | null

let plane: Entity
let glow: Entity
let light: Entity
let portal: Portal = null

function frameUvs(frame: number) {
  const col = frame % COLS, row = Math.floor(frame / COLS)
  const u0 = col / COLS, u1 = (col + 1) / COLS
  const v1 = 1 - row / ROWS, v0 = 1 - (row + 1) / ROWS
  return [u0, v0, u1, v0, u1, v1, u0, v1, u0, v0, u1, v0, u1, v1, u0, v1]
}

export function createLaunchPortal() {
  plane = engine.addEntity()
  Transform.create(plane, { parent: ROOT, position: Vector3.create(0, -50, 0), scale: Vector3.Zero() })
  MeshRenderer.setPlane(plane, frameUvs(0))
  const tex = Material.Texture.Common({ src: 'images/fx-portal-sheet.png' })
  Material.setPbrMaterial(plane, {
    texture: tex,
    alphaTexture: tex,
    emissiveTexture: tex,
    albedoColor: Color4.White(),
    emissiveColor: Color3.White(),
    emissiveIntensity: 3,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
    metallic: 0,
    roughness: 1
  })
  // a second, larger and fainter copy behind it, counter-rotating: depth and a soft halo
  glow = engine.addEntity()
  Transform.create(glow, { parent: plane, position: Vector3.create(0, 0, -0.05), scale: Vector3.create(1.25, 1.25, 1) })
  MeshRenderer.setPlane(glow, frameUvs(8))
  Material.setPbrMaterial(glow, {
    texture: tex,
    alphaTexture: tex,
    emissiveTexture: tex,
    albedoColor: Color4.create(1, 1, 1, 0.45),
    emissiveColor: PINK,
    emissiveIntensity: 1.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  light = engine.addEntity()
  Transform.create(light, { parent: plane, position: Vector3.create(0, 0, -1) })
  LightSource.create(light, { active: false, color: PINK, intensity: 1200, range: 14, shadow: false, type: LightSource.Type.Point({}) })
  engine.addSystem(portalSystem)
}

export const portalOpen = () => portal !== null

/** Tear a portal open at `position`, facing along `dir`; it stays open `hold` seconds after opening. */
export function openPortal(position: Vector3, dir: Vector3, hold: number) {
  if (portal) {
    portal.hold = Math.max(portal.hold, hold)
    return
  }
  portal = { t: 0, hold, frame: 0, frameT: 0 }
  const tr = Transform.getMutable(plane)
  tr.position = Vector3.clone(position)
  tr.rotation = Quaternion.lookRotation(dir, Vector3.Up())
  tr.scale = Vector3.Zero()
  LightSource.getMutable(light).active = true
  playAt(SFX.portalOpen, position, 1)
  for (let i = 0; i < 8; i++) puffTrail(position, PINK, 1.2)
}

const ease = (k: number) => 1 - Math.pow(1 - k, 3)

function portalSystem(dt: number) {
  const p = portal
  if (!p) return
  p.t += dt
  p.frameT += dt
  if (p.frameT >= 1 / FPS) {
    p.frameT = 0
    p.frame = (p.frame + 1) % FRAMES
    MeshRenderer.setPlane(plane, frameUvs(p.frame))
    MeshRenderer.setPlane(glow, frameUvs((FRAMES - p.frame + 8) % FRAMES))
  }
  const end = OPEN_T + p.hold
  let k: number
  if (p.t < OPEN_T) {
    // tear open: overshoot and settle, with a flicker
    const u = p.t / OPEN_T
    k = ease(u) * (1 + 0.18 * Math.sin(u * Math.PI * 3) * (1 - u)) * (0.85 + 0.15 * Math.random())
  } else if (p.t < end) {
    k = 1 + 0.04 * Math.sin(p.t * 9)
  } else if (p.t < end + CLOSE_T) {
    k = 1 - ease((p.t - end) / CLOSE_T)
  } else {
    portal = null
    Transform.getMutable(plane).scale = Vector3.Zero()
    LightSource.getMutable(light).active = false
    return
  }
  const tr = Transform.getMutable(plane)
  // squashed a little while it opens, round once it has settled
  tr.scale = Vector3.create(SIZE * k, SIZE * k * (0.75 + 0.25 * Math.min(1, k)), 1)
  LightSource.getMutable(light).intensity = 600 + 1400 * k + (Math.random() - 0.5) * 300
  if (Math.random() < 0.25) {
    const a = Math.random() * Math.PI * 2
    const r = (SIZE / 2) * k
    const local = Vector3.rotate(Vector3.create(Math.cos(a) * r, Math.sin(a) * r, 0), tr.rotation)
    puffTrail(Vector3.add(tr.position, local), PINK, 0.5)
  }
}
