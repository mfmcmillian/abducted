import { ColliderLayer, engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Color3, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, SPACE_RADIUS } from '../layout'
import { room } from '../shared/messages'
import { claimFloatingCow, CowTarget } from './cargo'
import { burstExplosion, burstImpact, fireBolt, Palette, PALETTES, puffTrail, startFx, warpIn, warpOut } from './fx'
import { playAt, SFX } from './sfx'
import { asteroidPosition, AsteroidRef, killAsteroid, pickAsteroidTarget } from './space'
import { toast } from './ui'

/**
 * Space battles outside the observation deck.
 *
 *   raid      a raider saucer swoops in behind an asteroid, pumps bolts into it and it blows
 *             apart (particles from fx.ts + tumbling chunks of the same model), then leaves
 *   cow raid  the same, aimed at a floating cow; the server picks the cow (cowShot) so every
 *             player sees the same cow go and the owner is paid
 *   dogfight  two saucers chase each other across the windows trading fire until one explodes
 *
 * Asteroid raids and dogfights are local flavour (every client rolls its own); cow raids are
 * server-driven.
 */

const TAU = Math.PI * 2
const R = SPACE_RADIUS
const DIR = 1 // keep in sync with space.ts
const HIDDEN = Vector3.create(CENTER.x, -50, CENTER.z)
const SAUCER_SCALE = 3
const GREEN = Color3.create(0.45, 1, 0.5)
const PINK = Color3.create(1, 0.4, 0.85)
const NO_COLLIDE = { visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE }

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const polar = (rho: number, phi: number, y: number) => Vector3.create(CENTER.x + rho * Math.sin(phi), y, CENTER.z + rho * Math.cos(phi))
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const cyl = (p: Vector3) => ({ rho: Math.hypot(p.x - CENTER.x, p.z - CENTER.z), phi: Math.atan2(p.x - CENTER.x, p.z - CENTER.z), y: p.y })
const tangentAt = (phi: number) => Vector3.create(Math.cos(phi), 0, -Math.sin(phi)) // direction of increasing phi
const safeNormalize = (v: Vector3, fallback: Vector3) => (Vector3.lengthSquared(v) > 1e-8 ? Vector3.normalize(v) : fallback)
const jitter = (m: number) => Vector3.create(rand(-m, m), rand(-m, m), rand(-m, m))

// ---- saucers ---------------------------------------------------------------------------------

interface Saucer {
  entity: Entity
  busy: boolean
  trail: number
}
const saucers: Saucer[] = []

function saucer(): Saucer | null {
  let s = saucers.find((x) => !x.busy)
  if (!s) {
    if (saucers.length >= 4) return null
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.clone(HIDDEN), scale: Vector3.Zero() })
    GltfContainer.create(entity, { src: 'models/ufo.glb', ...NO_COLLIDE })
    s = { entity, busy: false, trail: 0 }
    saucers.push(s)
  }
  s.busy = true
  return s
}

function parkSaucer(s: Saucer) {
  s.busy = false
  const t = Transform.getMutable(s.entity)
  t.position = Vector3.clone(HIDDEN)
  t.scale = Vector3.Zero()
}

/** Saucer rotation for a heading (what placeSaucer would set, minus the spin). */
function saucerRotation(heading: Vector3, bank: number) {
  const flat = Vector3.normalize(Vector3.create(heading.x, 0, heading.z))
  const yaw = (Math.atan2(flat.x, flat.z) * 180) / Math.PI
  return Quaternion.fromEulerDegrees(0, yaw, bank)
}

/** Streak away along heading and park when gone. */
function warpSaucerOut(s: Saucer, pos: Vector3, heading: Vector3, color: Color3) {
  playAt(SFX.ufoPass, pos, 0.7, 1.3)
  warpOut(s.entity, pos, heading, SAUCER_SCALE, color, 0, () => parkSaucer(s))
}

const WARP_IN = 0.7

/** Place a saucer: nose along `heading`, banked by `bank` degrees, spinning on its axis. */
function placeSaucer(s: Saucer, pos: Vector3, heading: Vector3, bank: number, clock: number, dt: number, trailColor: Color3) {
  const t = Transform.getMutable(s.entity)
  t.position = pos
  const flat = Vector3.normalize(Vector3.create(heading.x, 0, heading.z))
  const yaw = (Math.atan2(flat.x, flat.z) * 180) / Math.PI
  const pitch = (-Math.asin(Math.max(-1, Math.min(1, heading.y))) * 180) / Math.PI * 0.5
  t.rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(pitch, yaw, bank), Quaternion.fromEulerDegrees(0, clock * 220, 0))
  s.trail -= dt
  if (s.trail <= 0) {
    s.trail = 0.07
    puffTrail(Vector3.subtract(pos, Vector3.scale(heading, 2.2)), trailColor, 0.7)
  }
}

// ---- debris ----------------------------------------------------------------------------------

interface Debris {
  entity: Entity
  pos: Vector3
  vel: Vector3
  spin: Vector3
  age: number
  life: number
  size: number
  free: boolean
}
const debris: Debris[] = []

function throwDebris(src: string, pos: Vector3, size: number, count: number) {
  for (let i = 0; i < count; i++) {
    let d = debris.find((x) => x.free)
    if (!d) {
      if (debris.length >= 16) return
      const entity = engine.addEntity()
      Transform.create(entity, { position: Vector3.clone(HIDDEN), scale: Vector3.Zero() })
      GltfContainer.create(entity, { src, ...NO_COLLIDE })
      d = { entity, pos: Vector3.Zero(), vel: Vector3.Zero(), spin: Vector3.Zero(), age: 0, life: 1, size: 1, free: true }
      debris.push(d)
    }
    const g = GltfContainer.getMutable(d.entity)
    if (g.src !== src) g.src = src
    d.free = false
    d.age = 0
    d.life = rand(1.8, 3)
    d.size = size * rand(0.18, 0.4)
    d.pos = Vector3.clone(pos)
    d.vel = Vector3.scale(Vector3.normalize(jitter(1)), rand(4, 11))
    d.spin = Vector3.create(rand(-400, 400), rand(-400, 400), rand(-400, 400))
    const t = Transform.getMutable(d.entity)
    t.position = Vector3.clone(pos)
    t.scale = Vector3.create(d.size, d.size, d.size)
  }
}

// ---- targets ---------------------------------------------------------------------------------

interface Target {
  position: () => Vector3
  size: number
  palette: Palette
  debris: string
  kill: () => void
}

function asteroidTarget(a: AsteroidRef): Target {
  return {
    position: () => Vector3.clone(asteroidPosition(a)),
    size: a.size,
    palette: PALETTES.rock,
    debris: a.model,
    kill: () => killAsteroid(a, rand(20, 40))
  }
}

function cowTarget(c: CowTarget): Target {
  return { position: c.position, size: 1.6, palette: PALETTES.cow, debris: 'models/cow.glb', kill: c.destroy }
}

function explode(target: Target) {
  const pos = target.position()
  target.kill()
  burstExplosion(pos, target.size, target.palette)
  throwDebris(target.debris, pos, target.size, 6)
  playAt(SFX.explosion, pos, 1, rand(0.9, 1.1))
}

// ---- raids -----------------------------------------------------------------------------------

type Phase = 'warpin' | 'approach' | 'fire' | 'leave'
interface Raid {
  s: Saucer
  target: Target
  phase: Phase
  t: number
  start: Vector3
  pos: Vector3
  heading: Vector3
  shots: number
  nextShot: number
  leaveFrom: Vector3
  color: Color3
}
const raids: Raid[] = []
const APPROACH = 3.2
const SHOTS = 4
const SHOT_GAP = 0.5
const LEAVE = 3

function firingSpot(target: Target) {
  const c = cyl(target.position())
  // hang back along the lap, a touch nearer the glass and above the target
  return polar(c.rho - 3, c.phi - (DIR * 12) / c.rho, c.y + 3.5)
}

function startRaid(target: Target, color: Color3) {
  const s = saucer()
  if (!s) return false
  const c = cyl(target.position())
  const start = polar(c.rho - 1, c.phi - (DIR * 38) / c.rho, c.y + 10)
  const heading = Vector3.scale(tangentAt(c.phi), DIR)
  const raid: Raid = { s, target, phase: 'warpin', t: 0, start, pos: start, heading, shots: 0, nextShot: 0.2, leaveFrom: start, color }
  raids.push(raid)
  warpIn(s.entity, start, heading, saucerRotation(heading, DIR * 18), SAUCER_SCALE, color)
  playAt(SFX.ufoPass, start, 0.7, rand(0.9, 1.1))
  return true
}

function updateRaid(r: Raid, dt: number, clock: number) {
  r.t += dt
  let next: Vector3
  if (r.phase === 'warpin') {
    // fx.ts owns the transform until the streak has settled
    if (r.t >= WARP_IN) {
      r.phase = 'approach'
      r.t = 0
    }
    return true
  } else if (r.phase === 'approach') {
    const k = smooth(r.t / APPROACH)
    next = Vector3.lerp(r.start, firingSpot(r.target), k)
    if (r.t >= APPROACH) {
      r.phase = 'fire'
      r.t = 0
    }
  } else if (r.phase === 'fire') {
    next = Vector3.add(firingSpot(r.target), Vector3.create(Math.sin(clock * 2) * 0.6, Math.sin(clock * 3.1) * 0.5, Math.cos(clock * 2.3) * 0.6))
    r.nextShot -= dt
    if (r.nextShot <= 0 && r.shots < SHOTS) {
      r.nextShot = SHOT_GAP
      r.shots++
      const last = r.shots === SHOTS
      const target = r.target
      const aim = Vector3.add(target.position(), last ? Vector3.Zero() : jitter(target.size * 0.5))
      const from = Vector3.add(r.pos, Vector3.create(0, -0.6, 0))
      playAt(SFX.laser, from, 0.8, rand(0.95, 1.15))
      fireBolt(from, aim, r.color, 0.3, 3.5, 0.32, () => {
        if (last) explode(target)
        else burstImpact(target.position(), r.color, Math.max(0.8, target.size * 0.5))
      })
    }
    if (r.shots >= SHOTS && r.nextShot <= -0.6) {
      r.phase = 'leave'
      r.t = 0
      r.leaveFrom = Vector3.clone(r.pos)
    }
  } else {
    const c = cyl(r.leaveFrom)
    const k = r.t / LEAVE
    const dist = 45 * k * k + 6 * k
    next = polar(c.rho + 6 * k, c.phi + (DIR * dist) / c.rho, c.y + 9 * k)
    if (r.t >= LEAVE) {
      warpSaucerOut(r.s, r.pos, r.heading, r.color)
      return false
    }
  }
  const delta = Vector3.subtract(next, r.pos)
  if (Vector3.lengthSquared(delta) > 1e-6) r.heading = Vector3.normalize(delta)
  const bank = r.phase === 'leave' ? 28 : r.phase === 'approach' ? 18 : 6
  r.pos = next
  placeSaucer(r.s, next, r.heading, DIR * bank, clock, dt, r.color)
  return true
}

// ---- dogfights -------------------------------------------------------------------------------

interface Dogfight {
  lead: Saucer
  chase: Saucer
  t: number
  length: number
  rho: number
  phi0: number
  y: number
  speed: number
  nextShot: number
  leadDead: boolean
  leadPos: Vector3
  chasePos: Vector3
}
let dogfight: Dogfight | null = null

function startDogfight() {
  const lead = saucer()
  if (!lead) return false
  const chase = saucer()
  if (!chase) {
    parkSaucer(lead)
    return false
  }
  const rho = R + rand(9, 17)
  const phi0 = rand(0, TAU)
  const d: Dogfight = { lead, chase, t: -WARP_IN, length: rand(9, 13), rho, phi0, y: rand(16, 25), speed: rand(6.5, 8.5), nextShot: 1, leadDead: false, leadPos: polar(rho, phi0, 10), chasePos: polar(rho, phi0, 10) }
  d.leadPos = dogfightPath(d, 0, 0)
  d.chasePos = dogfightPath(d, 0, 9)
  const heading = Vector3.scale(tangentAt(phi0), DIR)
  warpIn(lead.entity, d.leadPos, heading, saucerRotation(heading, 0), SAUCER_SCALE, PINK)
  warpIn(chase.entity, d.chasePos, heading, saucerRotation(heading, 0), SAUCER_SCALE, GREEN, 0.15)
  dogfight = d
  playAt(SFX.ufoPass, d.leadPos, 0.8)
  return true
}

function dogfightPath(d: Dogfight, t: number, lag: number) {
  const along = Math.max(0, d.speed * t - lag)
  const phi = d.phi0 + (DIR * along) / d.rho
  return polar(d.rho + Math.sin(t * 0.9 + lag * 0.1) * 2.5, phi, d.y + Math.sin(t * 1.4 + lag * 0.15) * 3 + Math.sin(t * 0.5) * 2)
}

function updateDogfight(d: Dogfight, dt: number, clock: number) {
  d.t += dt
  if (d.t < 0) return true // still dropping out of warp
  const leadNext = dogfightPath(d, d.t, 0)
  const chaseNext = dogfightPath(d, d.t, 9)
  const leadHeading = safeNormalize(Vector3.subtract(leadNext, d.leadPos), tangentAt(d.phi0))
  const chaseHeading = safeNormalize(Vector3.subtract(chaseNext, d.chasePos), tangentAt(d.phi0))
  d.leadPos = leadNext
  d.chasePos = chaseNext
  if (!d.leadDead) placeSaucer(d.lead, leadNext, leadHeading, DIR * 35 * Math.sin(d.t * 1.4), clock, dt, PINK)
  placeSaucer(d.chase, chaseNext, chaseHeading, DIR * 30 * Math.sin(d.t * 1.4 - 0.5), clock, dt, GREEN)

  if (!d.leadDead) {
    d.nextShot -= dt
    if (d.nextShot <= 0) {
      d.nextShot = rand(0.35, 0.6)
      const hit = Math.random() < 0.45
      const aim = hit ? Vector3.add(leadNext, Vector3.scale(leadHeading, 1.5)) : Vector3.add(leadNext, Vector3.add(Vector3.scale(leadHeading, 6), jitter(4)))
      const from = Vector3.add(chaseNext, Vector3.create(0, -0.5, 0))
      playAt(SFX.laser, from, 0.6, rand(0.95, 1.1))
      fireBolt(from, aim, GREEN, 0.25, 3, 0.28, () => {
        if (!hit) return
        burstImpact(Vector3.add(d.leadPos, jitter(1)), GREEN, 1)
      })
    }
    if (d.t >= d.length) {
      d.leadDead = true
      const pos = Vector3.clone(d.leadPos)
      parkSaucer(d.lead)
      burstExplosion(pos, 2.2, PALETTES.saucer)
      throwDebris('models/ufo.glb', pos, 2.5, 5)
      playAt(SFX.explosion, pos, 1, 1.05)
    }
  } else if (d.t >= d.length + 3) {
    warpSaucerOut(d.chase, chaseNext, chaseHeading, GREEN)
    return false
  }
  return true
}

// ---- scheduler -------------------------------------------------------------------------------

export function createSpaceBattles() {
  startFx()
  let clock = 0
  let nextRaid = 15
  let nextDogfight = 45
  const pendingCows: CowTarget[] = []

  room.onMessage('cowShot', (data) => {
    const cow = claimFloatingCow(data.id)
    if (cow) pendingCows.push(cow)
  })

  engine.addSystem((dt) => {
    clock += dt

    // debris tumbles out and shrinks away
    for (const d of debris) {
      if (d.free) continue
      d.age += dt
      if (d.age >= d.life) {
        d.free = true
        const t = Transform.getMutable(d.entity)
        t.scale = Vector3.Zero()
        t.position = Vector3.clone(HIDDEN)
        continue
      }
      d.vel = Vector3.scale(d.vel, Math.max(0, 1 - 0.9 * dt))
      d.pos = Vector3.add(d.pos, Vector3.scale(d.vel, dt))
      const k = d.age / d.life
      const size = d.size * (1 - k * k)
      const t = Transform.getMutable(d.entity)
      t.position = d.pos
      t.scale = Vector3.create(size, size, size)
      t.rotation = Quaternion.fromEulerDegrees(d.age * d.spin.x, d.age * d.spin.y, d.age * d.spin.z)
    }

    for (let i = raids.length - 1; i >= 0; i--) if (!updateRaid(raids[i], dt, clock)) raids.splice(i, 1)
    if (dogfight && !updateDogfight(dogfight, dt, clock)) dogfight = null

    // server-picked cows first: a pink raider goes for them straight away
    if (pendingCows.length && raids.length < 2) {
      const cow = pendingCows.shift()!
      if (startRaid(cowTarget(cow), PINK)) toast('Raider saucer inbound. It has a cow in its sights.', 5)
      else pendingCows.unshift(cow)
    }

    nextRaid -= dt
    if (nextRaid <= 0) {
      nextRaid = rand(35, 60)
      const a = pickAsteroidTarget()
      if (a && raids.length < 2) startRaid(asteroidTarget(a), GREEN)
    }
    nextDogfight -= dt
    if (nextDogfight <= 0) {
      nextDogfight = rand(80, 140)
      if (!dogfight) startDogfight()
    }
  })
}
