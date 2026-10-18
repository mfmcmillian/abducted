import { ColliderLayer, engine, Entity, GltfContainer, LightSource, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS } from '../layout'
import { playAt, SFX } from './sfx'

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
interface Orbiter {
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

function rollAsteroid(o: Orbiter, band: number) {
  const b = BANDS[band]
  o.rho = R + rand(b.depth[0], b.depth[1])
  const size = rand(b.size[0], b.size[1])
  o.speed = rand(b.speed[0], b.speed[1])
  o.y = rand(Math.max(3, size + 1), Math.min(POD_TOP - size - 1, 30))
  o.spin = Vector3.create(rand(-14, 14), rand(-14, 14), rand(-14, 14))
  Transform.getMutable(o.entity).scale = Vector3.create(size, size, size)
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
}

const ESCORT_OFFSETS = [
  [-14, -5, 3],
  [14, -5, 3],
  [-24, -11, -2],
  [24, -11, -2],
  [0, -18, 6]
] // [tangential m behind, radial m (negative = closer to glass), height m]

function createFleet(): Fleet {
  const ship = model('models/space/mothership.glb', 11)
  const escorts = ESCORT_OFFSETS.map(() => model('models/ufo.glb', 2.6))
  return { ship, escorts, active: false, timer: rand(20, 40), rho: R + 18, phi: 0, y: 16, speed: 3, dir: DIR, travelled: 0, length: Math.PI }
}

function hideFleet(f: Fleet) {
  for (const e of [f.ship, ...f.escorts]) Transform.getMutable(e).position = Vector3.create(CENTER.x, -40, CENTER.z)
}

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
  createLights()

  // Planets at the back, drifting so slowly a lap takes over an hour; they tilt and turn.
  // From the plaza the window head clips the back wall above y ~26, so the planets sit low.
  const EARTH = 14 // scale => ~27 m across; back wall is at R + 30, keep rho + radius under it
  orbiter(model('models/space/earth.glb', EARTH), BACK - EARTH - 1.5, deg(0), 16, 0.07, Vector3.create(0, 1.6, 0), Quaternion.fromEulerDegrees(0, 0, 18))
  orbiter(model('models/space/moon.glb', 4.5), BACK - 10, deg(14), 23, 0.07, Vector3.create(0, 0.8, 0))
  const GIANT = 15
  orbiter(model('models/space/gas-giant.glb', GIANT), BACK - GIANT - 1.5, deg(180), 17, 0.06, Vector3.create(0, 2.4, 0), Quaternion.fromEulerDegrees(12, 0, -22))

  const comet = createComet()
  const fleet = createFleet()
  hideFleet(fleet)

  const asteroids: { o: Orbiter; band: number }[] = []
  for (let i = 0; i < ASTEROID_COUNT; i++) {
    const band = i % BANDS.length
    const o = orbiter(model(ASTEROID_MODELS[i % ASTEROID_MODELS.length], 1), R + 10, rand(0, TAU), 10, 1, Vector3.Zero())
    rollAsteroid(o, band)
    asteroids.push({ o, band })
  }

  let clock = 0
  engine.addSystem((dt) => {
    clock += dt

    for (const o of orbiters) {
      o.phi += (DIR * o.speed * dt) / o.rho
      if (o.phi > TAU) o.phi -= TAU
      const t = Transform.getMutable(o.entity)
      t.position = polar(o.rho, o.phi, o.y + Math.sin(clock * 0.3 + o.bob) * 0.4)
      t.rotation = Quaternion.multiply(o.tilt, Quaternion.fromEulerDegrees(clock * o.spin.x, clock * o.spin.y, clock * o.spin.z))
    }
    // Each lap an asteroid comes back as a different one, so the sky never repeats exactly.
    for (const a of asteroids) if (a.o.phi < (DIR * a.o.speed * dt) / a.o.rho) rollAsteroid(a.o, a.band)

    // Comet tail trails opposite the direction of travel (the tangent), slightly away from the glass.
    {
      const o = comet.o
      const tangent = Vector3.create(Math.cos(o.phi), 0, -Math.sin(o.phi))
      const back = Vector3.normalize(Vector3.add(Vector3.scale(tangent, -DIR), Vector3.create(Math.sin(o.phi) * 0.25, 0.15, Math.cos(o.phi) * 0.25)))
      const head = Transform.get(o.entity).position
      const tail = Transform.getMutable(comet.tail)
      tail.position = Vector3.add(head, Vector3.scale(back, 11))
      tail.rotation = Quaternion.multiply(Quaternion.lookRotation(back, Vector3.Up()), Quaternion.fromEulerDegrees(-90, 0, 0))
      tail.scale = Vector3.create(4 + Math.sin(clock * 3) * 0.3, 22, 4 + Math.cos(clock * 2.3) * 0.3)
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
        f.phi = rand(0, TAU)
        f.travelled = 0
        f.length = rand(Math.PI * 0.8, Math.PI * 1.4)
        playAt(SFX.ufoArrive, polar(f.rho, f.phi, f.y), 0.5, 0.6)
      }
    } else {
      const step = (f.speed * dt) / f.rho
      f.phi += f.dir * step
      f.travelled += step
      if (f.travelled >= f.length) {
        f.active = false
        f.timer = rand(60, 120)
        hideFleet(f)
      } else {
        const ship = Transform.getMutable(f.ship)
        ship.position = polar(f.rho, f.phi, f.y + Math.sin(clock * 0.5) * 0.6)
        // nose along the lap, slow spin on top of it
        ship.rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, (f.phi * 180) / Math.PI + (f.dir > 0 ? 90 : -90), f.dir * 6), Quaternion.fromEulerDegrees(0, clock * 8, 0))
        f.escorts.forEach((e, i) => {
          const [behind, radial, up] = ESCORT_OFFSETS[i]
          const rho = f.rho + radial
          const phi = f.phi - (f.dir * behind) / rho
          const t = Transform.getMutable(e)
          t.position = polar(rho, phi, f.y + up + Math.sin(clock * 1.1 + i) * 0.5)
          t.rotation = Quaternion.fromEulerDegrees(Math.sin(clock * 0.9 + i) * 4, clock * 140, f.dir * 10)
        })
      }
    }
  })
}
