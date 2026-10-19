import { Billboard, BillboardMode, engine, Entity, LightSource, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER } from '../layout'
import { ROOT } from './root'

/**
 * A small particle engine. The SDK has no particle component, so every particle is a
 * camera-facing plane (billboard) with a soft sprite (images/fx-*.png, generated) on an
 * emissive alpha-blended material, driven from a pool so bursts never allocate entities.
 *
 *   burstExplosion(pos, size, palette)  flash + shockwave + fireball + sparks + lingering smoke + light
 *   burstImpact(pos, color)             small sparkle where a bolt hits
 *   fireBolt(from, to, color, ...)      a glowing bolt flying between two points, callback on arrival
 */

const SPRITES = {
  puff: 'images/fx-puff.png',
  flare: 'images/fx-flare.png',
  ring: 'images/fx-ring.png',
  spark: 'images/fx-spark.png'
} as const
type Sprite = keyof typeof SPRITES

const POOL = 150
const HIDDEN = Vector3.create(CENTER.x, -60, CENTER.z)
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const mixColor = (a: Color3, b: Color3, t: number) => Color3.create(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t))

interface Particle {
  entity: Entity
  sprite: Sprite
  age: number
  life: number
  pos: Vector3
  vel: Vector3
  drag: number
  size0: number
  size1: number
  color0: Color3
  color1: Color3
  alpha0: number
  alpha1: number
  fadeIn: number // seconds
  glow: number
  free: boolean
}

const particles: Particle[] = []
let cursor = 0

function spriteMaterial(e: Entity, sprite: Sprite, color: Color3, alpha: number, glow: number) {
  const tex = Material.Texture.Common({ src: SPRITES[sprite] })
  Material.setPbrMaterial(e, {
    texture: tex,
    alphaTexture: tex,
    emissiveTexture: tex,
    albedoColor: Color4.create(color.r, color.g, color.b, alpha),
    emissiveColor: color,
    emissiveIntensity: glow,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0
  })
}

function makeParticle(): Particle {
  const entity = engine.addEntity()
  Transform.create(entity, { parent: ROOT, position: Vector3.clone(HIDDEN), scale: Vector3.Zero() })
  MeshRenderer.setPlane(entity)
  Billboard.create(entity, { billboardMode: BillboardMode.BM_ALL })
  spriteMaterial(entity, 'puff', Color3.White(), 0, 1)
  return {
    entity,
    sprite: 'puff',
    age: 0,
    life: 1,
    pos: Vector3.Zero(),
    vel: Vector3.Zero(),
    drag: 0,
    size0: 1,
    size1: 1,
    color0: Color3.White(),
    color1: Color3.White(),
    alpha0: 1,
    alpha1: 0,
    fadeIn: 0,
    glow: 1,
    free: true
  }
}

function take(): Particle {
  if (particles.length < POOL) {
    const p = makeParticle()
    particles.push(p)
    return p
  }
  // round robin: recycle the oldest-issued slot (bursts are short, so this is rarely a live one)
  const p = particles[cursor]
  cursor = (cursor + 1) % POOL
  return p
}

interface Spawn {
  sprite: Sprite
  pos: Vector3
  vel?: Vector3
  drag?: number
  life: number
  size0: number
  size1: number
  color0: Color3
  color1?: Color3
  alpha0?: number
  alpha1?: number
  fadeIn?: number
  glow?: number
}

function spawn(s: Spawn) {
  const p = take()
  p.sprite = s.sprite
  p.age = 0
  p.life = s.life
  p.pos = Vector3.clone(s.pos)
  p.vel = s.vel ? Vector3.clone(s.vel) : Vector3.Zero()
  p.drag = s.drag ?? 0
  p.size0 = s.size0
  p.size1 = s.size1
  p.color0 = s.color0
  p.color1 = s.color1 ?? s.color0
  p.alpha0 = s.alpha0 ?? 1
  p.alpha1 = s.alpha1 ?? 0
  p.fadeIn = s.fadeIn ?? 0
  p.glow = s.glow ?? 2
  p.free = false
  spriteMaterial(p.entity, p.sprite, p.color0, p.fadeIn > 0 ? 0 : p.alpha0, p.glow)
  const t = Transform.getMutable(p.entity)
  t.position = Vector3.clone(p.pos)
  t.scale = Vector3.create(p.size0, p.size0, p.size0)
}

function park(p: Particle) {
  p.free = true
  const t = Transform.getMutable(p.entity)
  t.scale = Vector3.Zero()
  t.position = Vector3.clone(HIDDEN)
}

// ---- lights ------------------------------------------------------------------------------

interface Flash {
  entity: Entity
  age: number
  life: number
  intensity: number
  free: boolean
}
const flashes: Flash[] = []

function flash(pos: Vector3, color: Color3, intensity: number, range: number, life: number) {
  let f = flashes.find((x) => x.free)
  if (!f) {
    if (flashes.length >= 6) return
    const entity = engine.addEntity()
    Transform.create(entity, { parent: ROOT, position: Vector3.clone(pos) })
    LightSource.create(entity, { active: false, color, intensity, range, shadow: false, type: LightSource.Type.Point({}) })
    f = { entity, age: 0, life, intensity, free: true }
    flashes.push(f)
  }
  f.free = false
  f.age = 0
  f.life = life
  f.intensity = intensity
  Transform.getMutable(f.entity).position = Vector3.clone(pos)
  const l = LightSource.getMutable(f.entity)
  l.active = true
  l.color = color
  l.intensity = intensity
  l.range = range
}

// ---- bolts -------------------------------------------------------------------------------

interface Bolt {
  core: Entity
  head: Entity
  age: number
  life: number
  from: Vector3
  to: Vector3
  onHit?: () => void
  free: boolean
}
const bolts: Bolt[] = []

function makeBolt(): Bolt {
  const core = engine.addEntity()
  Transform.create(core, { parent: ROOT, position: Vector3.clone(HIDDEN), scale: Vector3.Zero() })
  MeshRenderer.setBox(core)
  Material.setPbrMaterial(core, { albedoColor: Color4.create(1, 1, 1, 0.9), emissiveColor: Color3.White(), emissiveIntensity: 4, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false })
  const head = engine.addEntity()
  Transform.create(head, { parent: ROOT, position: Vector3.clone(HIDDEN), scale: Vector3.Zero() })
  MeshRenderer.setPlane(head)
  Billboard.create(head, { billboardMode: BillboardMode.BM_ALL })
  spriteMaterial(head, 'flare', Color3.White(), 1, 3)
  return { core, head, age: 0, life: 1, from: Vector3.Zero(), to: Vector3.Zero(), free: true }
}

/** Fire a glowing bolt from -> to over `seconds`; `onHit` runs when it lands. */
export function fireBolt(from: Vector3, to: Vector3, color: Color3, seconds = 0.35, length = 3, thickness = 0.3, onHit?: () => void) {
  let b = bolts.find((x) => x.free)
  if (!b) {
    if (bolts.length >= 24) return
    b = makeBolt()
    bolts.push(b)
  }
  b.free = false
  b.age = 0
  b.life = seconds
  b.from = Vector3.clone(from)
  b.to = Vector3.clone(to)
  b.onHit = onHit
  const dir = Vector3.normalize(Vector3.subtract(to, from))
  const core = Transform.getMutable(b.core)
  core.position = Vector3.clone(from)
  core.rotation = Quaternion.lookRotation(dir, Vector3.Up())
  core.scale = Vector3.create(thickness, thickness, length)
  const m = Material.getMutable(b.core)
  if (m.material?.$case === 'pbr') {
    m.material.pbr.albedoColor = Color4.create(color.r, color.g, color.b, 0.9)
    m.material.pbr.emissiveColor = color
  }
  spriteMaterial(b.head, 'flare', color, 1, 3)
  const head = Transform.getMutable(b.head)
  head.position = Vector3.clone(from)
  head.scale = Vector3.create(length * 0.9, length * 0.9, 1)
}

// ---- bursts ------------------------------------------------------------------------------

export interface Palette {
  flash: Color3
  fire0: Color3
  fire1: Color3
  smoke: Color3
  spark: Color3
}

export const PALETTES = {
  rock: { flash: Color3.create(1, 0.95, 0.8), fire0: Color3.create(1, 0.9, 0.5), fire1: Color3.create(1, 0.35, 0.08), smoke: Color3.create(0.35, 0.3, 0.3), spark: Color3.create(1, 0.8, 0.35) },
  cow: { flash: Color3.create(1, 0.85, 0.95), fire0: Color3.create(1, 0.8, 0.95), fire1: Color3.create(1, 0.3, 0.7), smoke: Color3.create(0.9, 0.85, 0.9), spark: Color3.create(1, 0.6, 0.9) },
  saucer: { flash: Color3.create(0.8, 1, 0.9), fire0: Color3.create(0.9, 1, 0.8), fire1: Color3.create(0.3, 1, 0.45), smoke: Color3.create(0.3, 0.4, 0.35), spark: Color3.create(0.6, 1, 0.7) }
} as const satisfies Record<string, Palette>

const randomDir = () => {
  const z = rand(-1, 1)
  const a = rand(0, Math.PI * 2)
  const r = Math.sqrt(1 - z * z)
  return Vector3.create(r * Math.cos(a), z, r * Math.sin(a))
}

/** A full explosion. `size` ~ radius of the thing that blew up, in metres. */
export function burstExplosion(pos: Vector3, size: number, palette: Palette) {
  const s = Math.max(1, size)
  const v = Math.sqrt(s) // speeds grow slower than sizes so big blasts stay readable
  // flash
  spawn({ sprite: 'flare', pos, life: 0.45, size0: s * 2, size1: s * 6, color0: palette.flash, alpha0: 1, alpha1: 0, glow: 4 })
  // shockwave
  spawn({ sprite: 'ring', pos, life: 0.8, size0: s * 1.5, size1: s * 9, color0: palette.flash, color1: palette.fire1, alpha0: 0.9, alpha1: 0, glow: 3 })
  // fireball
  const puffs = 10 + Math.round(s * 2)
  for (let i = 0; i < puffs; i++) {
    const dir = randomDir()
    const speed = rand(2.5, 6) * v
    spawn({
      sprite: 'puff',
      pos: Vector3.add(pos, Vector3.scale(dir, rand(0, 0.6) * s)),
      vel: Vector3.scale(dir, speed),
      drag: 2.2,
      life: rand(1.1, 1.8),
      size0: rand(1.2, 2.2) * s,
      size1: rand(3, 4.5) * s,
      color0: palette.fire0,
      color1: palette.fire1,
      alpha0: 1,
      alpha1: 0,
      glow: 3
    })
  }
  // sparks
  const sparks = 18 + Math.round(s * 4)
  for (let i = 0; i < sparks; i++) {
    const dir = randomDir()
    spawn({
      sprite: 'spark',
      pos,
      vel: Vector3.scale(dir, rand(8, 22) * v),
      drag: 1.2,
      life: rand(0.5, 1.1),
      size0: rand(0.35, 0.7) * s,
      size1: 0.05,
      color0: palette.spark,
      color1: palette.fire1,
      alpha0: 1,
      alpha1: 0,
      glow: 4
    })
  }
  // lingering smoke
  const smokes = 6 + Math.round(s)
  for (let i = 0; i < smokes; i++) {
    const dir = randomDir()
    spawn({
      sprite: 'puff',
      pos: Vector3.add(pos, Vector3.scale(dir, rand(0.3, 1.2) * s)),
      vel: Vector3.scale(dir, rand(0.6, 1.8) * v),
      drag: 0.8,
      life: rand(2.5, 4),
      size0: rand(1.5, 2.5) * s,
      size1: rand(4, 6.5) * s,
      color0: palette.fire1,
      color1: palette.smoke,
      alpha0: 0.75,
      alpha1: 0,
      fadeIn: 0.25,
      glow: 0.4
    })
  }
  flash(pos, palette.fire0, 4000 * s, 20 + 15 * s, 0.6)
}

/** Small sparkle where a bolt lands on something. */
export function burstImpact(pos: Vector3, color: Color3, size = 1) {
  spawn({ sprite: 'flare', pos, life: 0.25, size0: size * 1.2, size1: size * 3, color0: color, alpha0: 1, alpha1: 0, glow: 4 })
  for (let i = 0; i < 7; i++) {
    const dir = randomDir()
    spawn({ sprite: 'spark', pos, vel: Vector3.scale(dir, rand(4, 10) * size), drag: 2, life: rand(0.3, 0.6), size0: 0.3 * size, size1: 0.02, color0: color, alpha0: 1, alpha1: 0, glow: 4 })
  }
  flash(pos, color, 1200 * size, 14, 0.2)
}

/** A thin engine/exhaust trail puff; call every few frames behind something that moves. */
export function puffTrail(pos: Vector3, color: Color3, size = 0.6) {
  spawn({ sprite: 'puff', pos, vel: Vector3.create(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)), life: rand(0.5, 0.9), size0: size, size1: size * 2.5, color0: color, alpha0: 0.6, alpha1: 0, glow: 2 })
}

// ---- warp in / out ---------------------------------------------------------------------------

interface Warp {
  entity: Entity
  anchor: Vector3
  heading: Vector3
  scale: number
  rotation: Quaternion
  color: Color3
  age: number
  life: number
  out: boolean
  done?: () => void
}
const warps: Warp[] = []
const WARP_DIST = 160

/** Local-axis stretch: how much of `heading` lies along each of the entity's own axes. */
function warpScale(w: Warp, stretch: number, thin: number) {
  const r = w.rotation
  const l = Vector3.rotate(w.heading, Quaternion.create(-r.x, -r.y, -r.z, r.w)) // conjugate = inverse for a unit quaternion
  const ax = Math.abs(l.x)
  const ay = Math.abs(l.y)
  const az = Math.abs(l.z)
  return Vector3.create(w.scale * (thin + (stretch - thin) * ax), w.scale * (thin + (stretch - thin) * ay), w.scale * (thin + (stretch - thin) * az))
}

function warpFlash(pos: Vector3, heading: Vector3, color: Color3, scale: number) {
  spawn({ sprite: 'flare', pos, life: 0.5, size0: scale * 1.5, size1: scale * 5, color0: color, alpha0: 1, alpha1: 0, glow: 4 })
  spawn({ sprite: 'spark', pos, vel: Vector3.scale(heading, 90), life: 0.5, size0: scale * 1.2, size1: scale * 0.3, color0: Color3.White(), color1: color, alpha0: 1, alpha1: 0, glow: 4 })
  for (let i = 0; i < 8; i++) {
    const side = Vector3.scale(randomDir(), 0.35)
    spawn({ sprite: 'spark', pos: Vector3.add(pos, Vector3.scale(side, scale)), vel: Vector3.scale(Vector3.add(heading, side), rand(20, 50)), drag: 1.5, life: rand(0.4, 0.8), size0: scale * 0.3, size1: 0.02, color0: color, alpha0: 1, alpha1: 0, glow: 4 })
  }
  flash(pos, color, 2500 * Math.max(1, scale * 0.4), 30, 0.4)
}

/**
 * Jump to warp: the model stretches along `heading`, thins, streaks off and is parked (scale 0,
 * out of sight). `done` runs when it is gone. Reads the entity's current rotation.
 */
export function warpOut(entity: Entity, from: Vector3, heading: Vector3, scale: number, color: Color3, delay = 0, done?: () => void) {
  const h = Vector3.normalize(heading)
  warps.push({ entity, anchor: Vector3.clone(from), heading: h, scale, rotation: Transform.get(entity).rotation, color, age: -delay, life: 0.55, out: true, done })
}

/** Drop out of warp: a streak arrives along `heading` and settles at `to` with `rotation` and `scale`. */
export function warpIn(entity: Entity, to: Vector3, heading: Vector3, rotation: Quaternion, scale: number, color: Color3, delay = 0, done?: () => void) {
  const h = Vector3.normalize(heading)
  const t = Transform.getMutable(entity)
  t.scale = Vector3.Zero()
  t.position = Vector3.clone(HIDDEN)
  warps.push({ entity, anchor: Vector3.clone(to), heading: h, scale, rotation, color, age: -delay, life: 0.7, out: false, done })
}

function updateWarps(dt: number) {
  for (let i = warps.length - 1; i >= 0; i--) {
    const w = warps[i]
    const wasWaiting = w.age < 0
    w.age += dt
    if (w.age < 0) continue
    if (wasWaiting) warpFlash(w.anchor, w.out ? w.heading : Vector3.scale(w.heading, -1), w.color, w.scale)
    const k = Math.min(1, w.age / w.life)
    const q = w.out ? k : 1 - k
    const t = Transform.getMutable(w.entity)
    t.rotation = w.rotation
    t.position = Vector3.add(w.anchor, Vector3.scale(w.heading, (w.out ? 1 : -1) * q * q * q * WARP_DIST))
    t.scale = warpScale(w, 1 + 9 * q, 1 - 0.55 * q)
    if (k >= 1) {
      if (w.out) {
        t.scale = Vector3.Zero()
        t.position = Vector3.clone(HIDDEN)
      } else {
        t.scale = Vector3.create(w.scale, w.scale, w.scale)
        t.position = Vector3.clone(w.anchor)
      }
      warps.splice(i, 1)
      w.done?.()
    }
  }
}

// ---- system ------------------------------------------------------------------------------

let started = false

export function startFx() {
  if (started) return
  started = true
  engine.addSystem((dt) => {
    updateWarps(dt)
    for (const p of particles) {
      if (p.free) continue
      p.age += dt
      if (p.age >= p.life) {
        park(p)
        continue
      }
      const k = p.age / p.life
      if (p.drag > 0) p.vel = Vector3.scale(p.vel, Math.max(0, 1 - p.drag * dt))
      p.pos = Vector3.add(p.pos, Vector3.scale(p.vel, dt))
      const size = lerp(p.size0, p.size1, k)
      const t = Transform.getMutable(p.entity)
      t.position = p.pos
      t.scale = Vector3.create(size, size, size)
      const fade = p.fadeIn > 0 ? Math.min(1, p.age / p.fadeIn) : 1
      const alpha = lerp(p.alpha0, p.alpha1, k * k) * fade
      const color = mixColor(p.color0, p.color1, Math.min(1, k * 1.5))
      const m = Material.getMutable(p.entity)
      if (m.material?.$case === 'pbr') {
        m.material.pbr.albedoColor = Color4.create(color.r, color.g, color.b, alpha)
        m.material.pbr.emissiveColor = color
      }
    }

    for (const f of flashes) {
      if (f.free) continue
      f.age += dt
      const l = LightSource.getMutable(f.entity)
      if (f.age >= f.life) {
        f.free = true
        l.active = false
        continue
      }
      const k = 1 - f.age / f.life
      l.intensity = f.intensity * k * k
    }

    for (const b of bolts) {
      if (b.free) continue
      b.age += dt
      const k = Math.min(1, b.age / b.life)
      const pos = Vector3.lerp(b.from, b.to, k)
      Transform.getMutable(b.core).position = pos
      Transform.getMutable(b.head).position = pos
      if (k >= 1) {
        b.free = true
        Transform.getMutable(b.core).scale = Vector3.Zero()
        Transform.getMutable(b.head).scale = Vector3.Zero()
        b.onHit?.()
      }
    }
  })
}
