import { ColliderLayer, engine, Entity, GltfContainer, LightSource, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS } from '../layout'
import { playAt, SFX } from './sfx'
import { startFx, warpIn, warpOut } from './fx'

/**
 * The universe outside the observation deck. dome.glb (tools/build-dome-pods.mjs) carries a
 * star ring from the wall out to POD_DEPTH with a plain starfield on every face; everything
 * with a shape in it is a model (models/space/*, Meshy, slimmed with gltf-transform) moving on
 * circles around the dome centre, so nothing ever pokes through the ring walls and everything
 * slides past everything else at its own rate: real parallax as you walk the deck.
 *
 *   back   planets: Earth with the Moon beside it, a ringed gas giant opposite, barely moving
 *   middle the mothership and her escort of saucers cruising past every couple of minutes
 *   middle the comet with its tail, on a faster lap
 *   near   asteroids at three depths, tumbling
 */

// Keep in sync with tools/build-dome-pods.mjs.
const POD_DEPTH = 30
const POD_TOP = 40
const R = DOME_RADIUS
const BACK = R + POD_DEPTH
const TAU = Math.PI * 2
const DIR = 1 // everything streams the same way: the ship is under way
const LIGHT_COUNT = 4
const NO_COLLIDE = { visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE }

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const polar = (rho: number, phi: number, y: number) => Vector3.create(CENTER.x + rho * Math.sin(phi), y, CENTER.z + rho * Math.cos(phi))
const deg = (d: number) => (d * Math.PI) / 180

function model(src: string, scale: number): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(CENTER.x, -40, CENTER.z), scale: Vector3.create(scale, scale, scale) })
  GltfContainer.create(e, { src, ...NO_COLLIDE })
  return e
}

/** Something on a circular lap around the dome. All models are ~1.9 m across at scale 1. */
export interface Orbiter {
  entity: Entity
  rho: number
  phi: number
  y: number
  speed: number // m/s along the lap
  spin: Vector3 // deg/s per axis
  tilt: Quaternion
  bob: number
}

const orbiters: Orbiter[] = []

function orbiter(entity: Entity, rho: number, phi: number, y: number, speed: number, spin: Vector3, tilt = Quaternion.Identity()): Orbiter {
  const o: Orbiter = { entity, rho, phi, y, speed, spin, tilt, bob: rand(0, TAU) }
  orbiters.push(o)
  return o
}

// ---- asteroids ---------------------------------------------------------------------------

const ASTEROID_MODELS = ['models/space/asteroid-potato.glb', 'models/space/asteroid-icy.glb']
// depth behind the glass (m), scale, linear speed (m/s)
const BANDS = [
  { depth: [3, 8], size: [0.8, 1.6], speed: [1.3, 2.0] },
  { depth: [10, 18], size: [1.6, 2.8], speed: [0.8, 1.2] },
  { depth: [20, 26], size: [2.2, 3.6], speed: [0.45, 0.7] }
]
const ASTEROID_COUNT = 30

export interface AsteroidRef {
  o: Orbiter
  band: number
  model: string
  size: number
  dead: number // seconds until it comes back after being blown up; 0 = alive
}
const asteroids: AsteroidRef[] = []

function rollAsteroid(a: AsteroidRef) {
  const b = BANDS[a.band]
  const o = a.o
  o.rho = R + rand(b.depth[0], b.depth[1])
  a.size = rand(b.size[0], b.size[1])
  o.speed = rand(b.speed[0], b.speed[1])
  o.y = rand(Math.max(3, a.size + 1), Math.min(POD_TOP - a.size - 1, 30))
  o.spin = Vector3.create(rand(-14, 14), rand(-14, 14), rand(-14, 14))
  Transform.getMutable(o.entity).scale = Vector3.create(a.size, a.size, a.size)
}

/** A live asteroid for the raiders to shoot at: mid/far band so the blast has room, not too high. */
export function pickAsteroidTarget(): AsteroidRef | null {
  const pool = asteroids.filter((a) => a.dead <= 0 && a.band > 0 && a.o.y < 24)
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
}

export const asteroidPosition = (a: AsteroidRef) => Transform.get(a.o.entity).position

/** Hide an asteroid now; it rolls back in as a new one after `respawnSeconds`. */
export function killAsteroid(a: AsteroidRef, respawnSeconds = 20) {
  a.dead = respawnSeconds
  Transform.getMutable(a.o.entity).scale = Vector3.Zero()
}

// ---- earth (the zoom target, see earthZoom.ts) ----------------------------------------------

export const EARTH_SCALE = 14 // => ~27 m across; back wall is at R + 30, keep rho + radius under it
let earth: Orbiter | null = null
let earthFrozen = false

export const earthEntity = () => earth?.entity ?? null
export const earthPosition = () => (earth ? Transform.get(earth.entity).position : Vector3.Zero())
/** Hold the Earth still (no drift, no spin) while the zoom is inside it. */
export function setEarthFrozen(frozen: boolean) {
  earthFrozen = frozen
}

/** Planets things must not fly through: [orbiter, radius]. */
const bigBodies: [Orbiter, number][] = []
/** 1 when clear of every big body, 0 when touching one (ramps over 5 m). */
function clearance(pos: Vector3, size: number) {
  let f = 1
  for (const [b, r] of bigBodies) {
    const d = Vector3.distance(pos, Transform.get(b.entity).position) - r - size
    f = Math.min(f, Math.max(0, Math.min(1, d / 5)))
  }
  return f
}

// ---- comet ---------------------------------------------------------------------------------

function createComet() {
  const body = model('models/space/comet.glb', 3)
  const o = orbiter(body, R + 16, rand(0, TAU), 24, 1.4, Vector3.create(10, 25, 5))
  // Tail: a long soft cone trailing the nucleus, pointing away from the direction of travel.
  const tail = engine.addEntity()
  Transform.create(tail, { position: Vector3.Zero(), scale: Vector3.create(4, 22, 4) })
  MeshRenderer.setCylinder(tail, 0.05, 1)
  Material.setPbrMaterial(tail, {
    albedoColor: Color4.create(0.6, 0.85, 1, 0.22),
    emissiveColor: Color3.create(0.5, 0.8, 1),
    emissiveIntensity: 1.2,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  return { o, tail }
}

// ---- mothership and escort -------------------------------------------------------------------

interface Fleet {
  ship: Entity
  escorts: Entity[]
  active: boolean
  timer: number
  rho: number
  phi: number
  y: number
  speed: number
  dir: number
  travelled: number
  length: number
  /** seconds left in the warp-in / warp-out animation, during which the formation holds still */
  hold: number
  leaving: boolean
}

const ESCORT_OFFSETS = [
  [-14, -5, 3],
  [14, -5, 3],
  [-24, -11, -2],
  [24, -11, -2],
  [0, -18, 6]
] // [tangential m behind, radial m (negative = closer to glass), height m]

function createFleet(): Fleet {
  const ship = model('models/space/mothership.glb', MOTHERSHIP_SCALE)
  const escorts = ESCORT_OFFSETS.map(() => model('models/ufo.glb', ESCORT_SCALE))
  return { ship, escorts, active: false, timer: rand(20, 40), rho: R + 18, phi: 0, y: 16, speed: 3, dir: DIR, travelled: 0, length: Math.PI, hold: 0, leaving: false }
}

function hideFleet(f: Fleet) {
  for (const e of [f.ship, ...f.escorts]) Transform.getMutable(e).position = Vector3.create(CENTER.x, -40, CENTER.z)
}

const MOTHERSHIP_SCALE = 11
const ESCORT_SCALE = 2.6
const WARP_COLOR = Color3.create(0.55, 1, 0.75)

/** Where every ship of the formation is right now (position + rotation), without touching entities. */
function fleetPose(f: Fleet, clock: number) {
  const ship = {
    position: polar(f.rho, f.phi, f.y + Math.sin(clock * 0.5) * 0.6),
    // nose along the lap, slow spin on top of it
    rotation: Quaternion.multiply(Quaternion.fromEulerDegrees(0, (f.phi * 180) / Math.PI + (f.dir > 0 ? 90 : -90), f.dir * 6), Quaternion.fromEulerDegrees(0, clock * 8, 0))
  }
  const escorts = ESCORT_OFFSETS.map(([behind, radial, up], i) => {
    const rho = f.rho + radial
    const phi = f.phi - (f.dir * behind) / rho
    return { position: polar(rho, phi, f.y + up + Math.sin(clock * 1.1 + i) * 0.5), rotation: Quaternion.fromEulerDegrees(Math.sin(clock * 0.9 + i) * 4, clock * 140, f.dir * 10) }
  })
  return { ship, escorts }
}

const fleetHeading = (f: Fleet) => Vector3.scale(Vector3.create(Math.cos(f.phi), 0, -Math.sin(f.phi)), f.dir)

// ---- lights ----------------------------------------------------------------------------------

function createLights() {
  for (let i = 0; i < LIGHT_COUNT; i++) {
    const light = engine.addEntity()
    Transform.create(light, { position: polar(R + 4, (i / LIGHT_COUNT) * TAU + Math.PI / 4, 26) })
    LightSource.create(light, { active: true, color: Color3.create(0.6, 0.8, 1), intensity: 2200, range: 60, shadow: false, type: LightSource.Type.Point({}) })
  }
}

// ---- main ----------------------------------------------------------------------------------

export function createSpaceWindows() {
  startFx()
  createLights()

  // Planets at the back, drifting so slowly a lap takes over an hour; they tilt and turn.
  // From the plaza the window head clips the back wall above y ~26, so the planets sit low.
  earth = orbiter(model('models/space/earth.glb', EARTH_SCALE), BACK - EARTH_SCALE - 1.5, deg(0), 16, 0.07, Vector3.create(0, 1.6, 0), Quaternion.fromEulerDegrees(0, 0, 18))
  orbiter(model('models/space/moon.glb', 4.5), BACK - 10, deg(14), 23, 0.07, Vector3.create(0, 0.8, 0))
  const GIANT = 15
  const giant = orbiter(model('models/space/gas-giant.glb', GIANT), BACK - GIANT - 1.5, deg(180), 17, 0.06, Vector3.create(0, 2.4, 0), Quaternion.fromEulerDegrees(12, 0, -22))
  bigBodies.push([earth, EARTH_SCALE * 0.92], [giant, GIANT * 0.95])

  const comet = createComet()
  const fleet = createFleet()
  hideFleet(fleet)

  for (let i = 0; i < ASTEROID_COUNT; i++) {
    const src = ASTEROID_MODELS[i % ASTEROID_MODELS.length]
    const o = orbiter(model(src, 1), R + 10, rand(0, TAU), 10, 1, Vector3.Zero())
    const a: AsteroidRef = { o, band: i % BANDS.length, model: src, size: 1, dead: 0 }
    rollAsteroid(a)
    asteroids.push(a)
  }

  let clock = 0
  engine.addSystem((dt) => {
    clock += dt

    for (const o of orbiters) {
      if (earthFrozen && o === earth) continue
      o.phi += (DIR * o.speed * dt) / o.rho
      if (o.phi > TAU) o.phi -= TAU
      const t = Transform.getMutable(o.entity)
      t.position = polar(o.rho, o.phi, o.y + Math.sin(clock * 0.3 + o.bob) * 0.4)
      t.rotation = Quaternion.multiply(o.tilt, Quaternion.fromEulerDegrees(clock * o.spin.x, clock * o.spin.y, clock * o.spin.z))
    }
    // Each lap an asteroid comes back as a different one, so the sky never repeats exactly.
    for (const a of asteroids) {
      if (a.dead > 0) {
        a.dead -= dt
        if (a.dead <= 0) {
          a.dead = 0
          a.o.phi = rand(0, TAU)
          rollAsteroid(a)
        }
      } else {
        if (a.o.phi < (DIR * a.o.speed * dt) / a.o.rho) rollAsteroid(a)
        const t = Transform.getMutable(a.o.entity)
        const s = a.size * clearance(t.position, a.size)
        t.scale = Vector3.create(s, s, s)
      }
    }

    // Comet tail trails opposite the direction of travel (the tangent), slightly away from the glass.
    {
      const o = comet.o
      const tangent = Vector3.create(Math.cos(o.phi), 0, -Math.sin(o.phi))
      const back = Vector3.normalize(Vector3.add(Vector3.scale(tangent, -DIR), Vector3.create(Math.sin(o.phi) * 0.25, 0.15, Math.cos(o.phi) * 0.25)))
      const head = Transform.get(o.entity).position
      const tail = Transform.getMutable(comet.tail)
      tail.position = Vector3.add(head, Vector3.scale(back, 11))
      tail.rotation = Quaternion.multiply(Quaternion.lookRotation(back, Vector3.Up()), Quaternion.fromEulerDegrees(-90, 0, 0))
      const k = clearance(head, 3)
      tail.scale = Vector3.scale(Vector3.create(4 + Math.sin(clock * 3) * 0.3, 22, 4 + Math.cos(clock * 2.3) * 0.3), k)
      Transform.getMutable(o.entity).scale = Vector3.create(3 * k, 3 * k, 3 * k)
    }

    // Mothership pass: cruises a half lap with the escort in formation, then waits a while.
    const f = fleet
    if (!f.active) {
      f.timer -= dt
      if (f.timer <= 0) {
        f.active = true
        f.dir = DIR
        f.rho = R + rand(14, 20)
        f.y = rand(14, 20)
        f.speed = rand(2.5, 3.5)
        f.travelled = 0
        // the planets sit roughly opposite each other: run the lap in the gap between them,
        // leaving room for the planet, the ship and the escorts trailing behind
        const [from, to] = Math.random() < 0.5 ? [bigBodies[0], bigBodies[1]] : [bigBodies[1], bigBodies[0]]
        const margin = (r: number) => (r + MOTHERSHIP_SCALE + 4) / f.rho
        const trail = 26 / f.rho
        let gap = to[0].phi - from[0].phi
        gap = ((gap % TAU) + TAU) % TAU
        if (f.dir < 0) gap = TAU - gap
        const free = gap - margin(from[1]) - margin(to[1]) - trail
        f.length = Math.min(rand(Math.PI * 0.45, Math.PI * 0.6), Math.max(0.6, free))
        f.phi = from[0].phi + f.dir * (margin(from[1]) + trail + rand(0, Math.max(0, free - f.length)))
        f.leaving = false
        // drop out of warp: escorts first, the mothership last, all streaking in along the lap
        const pose = fleetPose(f, clock)
        const heading = fleetHeading(f)
        pose.escorts.forEach((p, i) => warpIn(f.escorts[i], p.position, heading, p.rotation, ESCORT_SCALE, WARP_COLOR, i * 0.12))
        warpIn(f.ship, pose.ship.position, heading, pose.ship.rotation, MOTHERSHIP_SCALE, WARP_COLOR, 0.7)
        f.hold = 1.5
        playAt(SFX.ufoArrive, polar(f.rho, f.phi, f.y), 0.5, 0.6)
      }
    } else if (f.hold > 0) {
      f.hold -= dt
      if (f.hold <= 0 && f.leaving) {
        f.active = false
        f.timer = rand(60, 120)
      }
    } else {
      const step = (f.speed * dt) / f.rho
      f.phi += f.dir * step
      f.travelled += step
      const pose = fleetPose(f, clock)
      if (f.travelled >= f.length) {
        // jump to warp: the mothership goes first, the escorts peel off after it
        const heading = fleetHeading(f)
        warpOut(f.ship, pose.ship.position, heading, MOTHERSHIP_SCALE, WARP_COLOR, 0)
        pose.escorts.forEach((p, i) => warpOut(f.escorts[i], p.position, heading, ESCORT_SCALE, WARP_COLOR, 0.35 + i * 0.12))
        playAt(SFX.ufoPass, pose.ship.position, 0.8, 0.8)
        f.leaving = true
        f.hold = 1.6
      } else {
        const ship = Transform.getMutable(f.ship)
        ship.position = pose.ship.position
        ship.rotation = pose.ship.rotation
        f.escorts.forEach((e, i) => {
          const t = Transform.getMutable(e)
          t.position = pose.escorts[i].position
          t.rotation = pose.escorts[i].rotation
        })
      }
    }
  })
}
