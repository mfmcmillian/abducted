import { ColliderLayer, engine, Entity, GltfContainer, LightSource, Transform } from '@dcl/sdk/ecs'
import { Color3, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS } from '../layout'
import { playAt, SFX } from './sfx'

/**
 * The universe outside the observation deck. dome.glb (tools/build-dome-pods.mjs) carries a
 * star ring from the wall out to POD_DEPTH with space pictures on its back wall. This module
 * keeps that ring alive: asteroids orbit through it at three depths (so they slide past each
 * other and the backdrop at different rates, real parallax as you walk) and every so often a
 * saucer crosses an arc of the sky. Everything moves on circles around the dome centre, so
 * nothing ever pokes through the ring walls. Everything streams the same way: the ship is
 * under way.
 */

// Keep in sync with tools/build-dome-pods.mjs.
const POD_DEPTH = 30
const POD_TOP = 40
const R = DOME_RADIUS
const TAU = Math.PI * 2
const DIR = 1 // orbit direction
const ROCK_COUNT = 30
const UFO_COUNT = 3
const LIGHT_COUNT = 4
const ROCK_MODELS = ['models/rock-0.glb', 'models/rock-1.glb', 'models/rock-2.glb']

// depth behind the glass (m), model scale (~radius in m), linear speed (m/s)
const BANDS = [
  { depth: [3, 8], size: [0.9, 1.8], speed: [1.3, 2.0] },
  { depth: [10, 18], size: [1.8, 3.2], speed: [0.8, 1.2] },
  { depth: [20, 27], size: [2.5, 4.0], speed: [0.45, 0.7] }
]

type Drifter = {
  entity: Entity
  rho: number
  phi: number
  y: number
  speed: number
  size: number
  spin: Vector3
  bob: number
  lap: number
}

type Flyby = {
  entity: Entity
  active: boolean
  timer: number
  rho: number
  phi: number
  end: number
  y: number
  speed: number
  dir: number
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const polar = (rho: number, phi: number, y: number) =>
  Vector3.create(CENTER.x + rho * Math.sin(phi), y, CENTER.z + rho * Math.cos(phi))

function roll(r: Drifter, band: number) {
  const b = BANDS[band]
  r.rho = R + rand(b.depth[0], b.depth[1])
  r.size = rand(b.size[0], b.size[1])
  r.speed = rand(b.speed[0], b.speed[1])
  r.y = rand(Math.max(3, r.size + 0.5), Math.min(POD_TOP - r.size - 0.5, 30))
  r.spin = Vector3.create(rand(-14, 14), rand(-14, 14), rand(-14, 14))
  r.bob = rand(0, TAU)
  Transform.getMutable(r.entity).scale = Vector3.create(r.size, r.size, r.size)
}

function hide(e: Entity) {
  const t = Transform.getMutable(e)
  t.scale = Vector3.create(0.001, 0.001, 0.001)
  t.position = Vector3.create(CENTER.x, -20, CENTER.z)
}

export function createSpaceWindows() {
  // Cool light spilling out of the ship onto whatever passes close to the glass.
  for (let i = 0; i < LIGHT_COUNT; i++) {
    const light = engine.addEntity()
    Transform.create(light, { position: polar(R + 4, (i / LIGHT_COUNT) * TAU + Math.PI / 4, 26) })
    LightSource.create(light, {
      active: true,
      color: Color3.create(0.6, 0.8, 1),
      intensity: 2200,
      range: 60,
      shadow: false,
      type: LightSource.Type.Point({})
    })
  }

  const rocks: { band: number; d: Drifter }[] = []
  for (let i = 0; i < ROCK_COUNT; i++) {
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.Zero() })
    GltfContainer.create(entity, {
      src: ROCK_MODELS[i % ROCK_MODELS.length],
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    })
    const d: Drifter = { entity, rho: R, phi: rand(0, TAU), y: 10, speed: 1, size: 1, spin: Vector3.Zero(), bob: 0, lap: 0 }
    const band = i % BANDS.length
    roll(d, band)
    rocks.push({ band, d })
  }

  const flybys: Flyby[] = []
  for (let i = 0; i < UFO_COUNT; i++) {
    const ufo = engine.addEntity()
    Transform.create(ufo, { position: Vector3.Zero() })
    GltfContainer.create(ufo, {
      src: 'models/ufo.glb',
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    })
    hide(ufo)
    flybys.push({ entity: ufo, active: false, timer: rand(5, 20) + i * 12, rho: R, phi: 0, end: 0, y: 10, speed: 6, dir: 1 })
  }

  let clock = 0
  engine.addSystem((dt) => {
    clock += dt

    for (const { band, d } of rocks) {
      d.phi += (DIR * d.speed * dt) / d.rho
      if (d.phi > TAU || d.phi < 0) {
        // Each lap the rock comes back as a different one, so the sky never repeats exactly.
        d.phi = ((d.phi % TAU) + TAU) % TAU
        roll(d, band)
      }
      const t = Transform.getMutable(d.entity)
      t.position = polar(d.rho, d.phi, d.y + Math.sin(clock * 0.3 + d.bob) * 0.6)
      t.rotation = Quaternion.fromEulerDegrees(clock * d.spin.x, clock * d.spin.y, clock * d.spin.z)
    }

    for (const f of flybys) {
      if (!f.active) {
        f.timer -= dt
        if (f.timer > 0) continue
        f.active = true
        f.dir = Math.random() < 0.7 ? DIR : -DIR
        f.rho = R + rand(8, 24)
        f.y = rand(6, 24)
        f.speed = rand(5, 9)
        f.phi = rand(0, TAU)
        f.end = f.dir * rand(Math.PI * 0.5, Math.PI * 1.2) // how far it travels before it is gone
        const scale = rand(2, 3.5)
        Transform.getMutable(f.entity).scale = Vector3.create(scale, scale, scale)
        playAt(SFX.ufoArrive, polar(f.rho, f.phi, f.y), 0.35, 0.8 + Math.random() * 0.3)
        continue
      }
      const step = (f.dir * f.speed * dt) / f.rho
      f.phi += step
      f.end -= step
      if (f.dir * f.end <= 0) {
        f.active = false
        f.timer = rand(15, 40)
        hide(f.entity)
        continue
      }
      const t = Transform.getMutable(f.entity)
      t.position = polar(f.rho, f.phi, f.y + Math.sin(clock * 1.3) * 0.8)
      t.rotation = Quaternion.fromEulerDegrees(Math.sin(clock * 0.9) * 4, clock * 140, f.dir * 12)
    }
  })
}
