import {
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  InputAction,
  LightSource,
  Material,
  MaterialTransparencyMode,
  MeshRenderer,
  pointerEventsSystem,
  Transform,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS, flatDistance, FORMATION, LAUNCH_PAD, LEADERBOARD, SPAWN } from '../layout'

/**
 * A herd of the emote's cows wandering the dome floor. Click one and the saucer
 * comes over, drops its beam and takes it. A while later the cow is returned,
 * dropped from the ceiling somewhere else, apparently none the worse for it.
 */

const HERD = 12
const COW_SCALE = 1.5
const WALK_SPEED = 1.4
const KEEP_IN_RADIUS = DOME_RADIUS - 4 // stay off the wall
const KEEP_OUT_CENTER = 18 // diorama, floor ring, dancers
const KEEP_OUT_FORMATION = 10
const KEEP_OUT_SPOTS: Array<[Vector3, number]> = [
  [LAUNCH_PAD, 7],
  [LEADERBOARD, 6],
  [SPAWN, 7]
]

const UFO_IDLE = Vector3.create(CENTER.x + 20, 22, CENTER.z - 18)
const UFO_SCALE = 3
const BEAM_HEIGHT = 16 // beam cylinder height when deployed
const DROP_HEIGHT = 22 // returned cows fall from here (ceiling is >= 26 m within the keep-in radius)

type CowState = 'walk' | 'graze' | 'abducted' | 'gone' | 'falling'

interface Cow {
  entity: Entity
  pos: Vector3
  heading: number
  target: Vector3
  state: CowState
  timer: number
  bob: number
  spin: number
}

const cows: Cow[] = []

interface Ufo {
  entity: Entity
  beam: Entity
  light: Entity
  pos: Vector3
  state: 'idle' | 'approach' | 'beam' | 'return'
  victim: Cow | null
  timer: number
  from: Vector3
  to: Vector3
  wobble: number
}

let ufo: Ufo

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a)
}

function isOpenGround(p: Vector3) {
  const r = flatDistance(p, CENTER)
  if (r > KEEP_IN_RADIUS || r < KEEP_OUT_CENTER) return false
  for (const f of Object.values(FORMATION)) if (flatDistance(p, f) < KEEP_OUT_FORMATION) return false
  for (const [spot, keep] of KEEP_OUT_SPOTS) if (flatDistance(p, spot) < keep) return false
  return true
}

function randomOpenPoint(near?: Vector3, radius = 14): Vector3 {
  for (let i = 0; i < 40; i++) {
    const p = near
      ? Vector3.create(near.x + randomBetween(-radius, radius), 0, near.z + randomBetween(-radius, radius))
      : Vector3.create(CENTER.x + randomBetween(-KEEP_IN_RADIUS, KEEP_IN_RADIUS), 0, CENTER.z + randomBetween(-KEEP_IN_RADIUS, KEEP_IN_RADIUS))
    if (isOpenGround(p)) return p
  }
  return Vector3.create(CENTER.x + 10, 0, CENTER.z + 30)
}

function spawnCow(index: number): Cow {
  const pos = randomOpenPoint()
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(pos.x, 0, pos.z),
    rotation: Quaternion.fromEulerDegrees(0, Math.random() * 360, 0),
    scale: Vector3.create(COW_SCALE, COW_SCALE, COW_SCALE)
  })
  GltfContainer.create(entity, {
    src: 'models/cow.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  const cow: Cow = {
    entity,
    pos,
    heading: Math.random() * Math.PI * 2,
    target: randomOpenPoint(pos),
    state: index % 3 === 0 ? 'graze' : 'walk',
    timer: randomBetween(1, 5),
    bob: Math.random() * 10,
    spin: 0
  }
  pointerEventsSystem.onPointerDown(
    { entity, opts: { button: InputAction.IA_POINTER, hoverText: 'Moo?', maxDistance: 16 } },
    () => abduct(cow)
  )
  return cow
}

function abduct(cow: Cow) {
  if (cow.state === 'abducted' || cow.state === 'gone' || cow.state === 'falling') return
  if (ufo.state !== 'idle') return
  cow.state = 'abducted'
  cow.timer = 0
  ufo.victim = cow
  ufo.state = 'approach'
  ufo.timer = 0
  ufo.from = Vector3.clone(ufo.pos)
  ufo.to = Vector3.create(cow.pos.x, BEAM_HEIGHT, cow.pos.z)
}

function createUfo(): Ufo {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.clone(UFO_IDLE),
    scale: Vector3.create(UFO_SCALE, UFO_SCALE, UFO_SCALE)
  })
  GltfContainer.create(entity, {
    src: 'models/ufo.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  // Beam: a translucent cone-ish cylinder hanging under the saucer. Scaled to 0 when off.
  const beam = engine.addEntity()
  Transform.create(beam, { position: Vector3.create(UFO_IDLE.x, UFO_IDLE.y / 2, UFO_IDLE.z), scale: Vector3.create(0, 0, 0) })
  MeshRenderer.setCylinder(beam, 2.4, 0.9)
  Material.setPbrMaterial(beam, {
    albedoColor: Color4.create(0.4, 1, 0.7, 0.28),
    emissiveColor: Color3.create(0.4, 1, 0.7),
    emissiveIntensity: 1.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })

  const light = engine.addEntity()
  Transform.create(light, { position: Vector3.create(UFO_IDLE.x, UFO_IDLE.y - 2, UFO_IDLE.z) })
  LightSource.create(light, {
    active: true,
    color: Color3.create(0.4, 1, 0.6),
    intensity: 500,
    range: 20,
    shadow: false,
    type: LightSource.Type.Spot({ innerAngle: 25, outerAngle: 45 })
  })

  return {
    entity,
    beam,
    light,
    pos: Vector3.clone(UFO_IDLE),
    state: 'idle',
    victim: null,
    timer: 0,
    from: Vector3.clone(UFO_IDLE),
    to: Vector3.clone(UFO_IDLE),
    wobble: 0
  }
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function turnToward(current: number, target: number, maxStep: number) {
  let d = target - current
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  if (Math.abs(d) <= maxStep) return target
  return current + Math.sign(d) * maxStep
}

function cowSystem(dt: number) {
  for (const cow of cows) {
    const t = Transform.getMutable(cow.entity)
    switch (cow.state) {
      case 'graze': {
        cow.timer -= dt
        if (cow.timer <= 0) {
          cow.state = 'walk'
          cow.target = randomOpenPoint(cow.pos)
        }
        break
      }
      case 'walk': {
        const dx = cow.target.x - cow.pos.x
        const dz = cow.target.z - cow.pos.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist < 0.6) {
          cow.state = 'graze'
          cow.timer = randomBetween(2, 7)
          break
        }
        cow.heading = turnToward(cow.heading, Math.atan2(dx, dz), dt * 1.8)
        const step = Math.min(dist, WALK_SPEED * dt)
        const nx = cow.pos.x + Math.sin(cow.heading) * step
        const nz = cow.pos.z + Math.cos(cow.heading) * step
        const next = Vector3.create(nx, 0, nz)
        if (isOpenGround(next)) {
          cow.pos = next
        } else {
          cow.target = randomOpenPoint(cow.pos)
        }
        cow.bob += dt * 9
        t.position.x = cow.pos.x
        t.position.z = cow.pos.z
        t.position.y = Math.abs(Math.sin(cow.bob)) * 0.05
        t.rotation = Quaternion.fromEulerDegrees(0, (cow.heading * 180) / Math.PI, Math.sin(cow.bob) * 2)
        break
      }
      case 'abducted': {
        // Wait for the saucer; once the beam is on, rise and spin.
        if (ufo.state !== 'beam') break
        cow.timer += dt
        const k = Math.min(1, cow.timer / 3.2)
        cow.spin += dt * (1 + k * 6)
        t.position.y = easeInOut(k) * (BEAM_HEIGHT - 1.5)
        t.rotation = Quaternion.fromEulerDegrees(k * 30, (cow.spin * 180) / Math.PI, k * 180)
        if (k >= 1) {
          cow.state = 'gone'
          cow.timer = randomBetween(8, 14)
          VisibilityComponent.createOrReplace(cow.entity, { visible: false })
          ufo.state = 'return'
          ufo.timer = 0
          ufo.from = Vector3.clone(ufo.pos)
          ufo.to = Vector3.clone(UFO_IDLE)
          ufo.victim = null
        }
        break
      }
      case 'gone': {
        cow.timer -= dt
        if (cow.timer <= 0) {
          // Returned: dropped from the sky somewhere else.
          cow.pos = randomOpenPoint()
          cow.state = 'falling'
          cow.timer = 0
          t.position = Vector3.create(cow.pos.x, DROP_HEIGHT, cow.pos.z)
          t.rotation = Quaternion.fromEulerDegrees(0, Math.random() * 360, 0)
          VisibilityComponent.createOrReplace(cow.entity, { visible: true })
        }
        break
      }
      case 'falling': {
        cow.timer += dt
        const y = DROP_HEIGHT - 0.5 * 22 * cow.timer * cow.timer // soft gravity
        if (y <= 0) {
          t.position.y = 0
          cow.state = 'graze'
          cow.timer = 2
          cow.heading = Quaternion.toEulerAngles(t.rotation).y * (Math.PI / 180)
        } else {
          t.position.y = y
        }
        break
      }
    }
  }
}

function ufoSystem(dt: number) {
  ufo.wobble += dt
  const t = Transform.getMutable(ufo.entity)
  const beam = Transform.getMutable(ufo.beam)
  const light = Transform.getMutable(ufo.light)

  switch (ufo.state) {
    case 'idle': {
      // Lazy figure-eight drift above the south field.
      ufo.pos = Vector3.create(
        UFO_IDLE.x + Math.sin(ufo.wobble * 0.35) * 6,
        UFO_IDLE.y + Math.sin(ufo.wobble * 0.9) * 0.8,
        UFO_IDLE.z + Math.sin(ufo.wobble * 0.7) * 3
      )
      beam.scale = Vector3.Zero()
      break
    }
    case 'approach': {
      ufo.timer += dt
      const k = Math.min(1, ufo.timer / 2.4)
      ufo.pos = Vector3.lerp(ufo.from, ufo.to, easeInOut(k))
      if (k >= 1) {
        ufo.state = 'beam'
        ufo.timer = 0
      }
      beam.scale = Vector3.Zero()
      break
    }
    case 'beam': {
      ufo.timer += dt
      const open = Math.min(1, ufo.timer / 0.4)
      beam.scale = Vector3.create(open, BEAM_HEIGHT, open)
      beam.position = Vector3.create(ufo.pos.x, BEAM_HEIGHT / 2, ufo.pos.z)
      ufo.pos = Vector3.create(ufo.to.x + Math.sin(ufo.wobble * 3) * 0.15, ufo.to.y + Math.sin(ufo.wobble * 2) * 0.2, ufo.to.z)
      break
    }
    case 'return': {
      ufo.timer += dt
      const k = Math.min(1, ufo.timer / 3)
      ufo.pos = Vector3.lerp(ufo.from, ufo.to, easeInOut(k))
      beam.scale = Vector3.create(Math.max(0, 1 - ufo.timer * 3), BEAM_HEIGHT, Math.max(0, 1 - ufo.timer * 3))
      if (k >= 1) ufo.state = 'idle'
      break
    }
  }

  t.position = ufo.pos
  t.rotation = Quaternion.fromEulerDegrees(Math.sin(ufo.wobble * 1.3) * 4, ufo.wobble * 40, Math.cos(ufo.wobble * 1.1) * 4)
  light.position = Vector3.create(ufo.pos.x, ufo.pos.y - 1.5, ufo.pos.z)
  light.rotation = Quaternion.fromEulerDegrees(90, 0, 0)
  const l = LightSource.getMutable(ufo.light)
  l.intensity = ufo.state === 'beam' ? 2500 : 500
}

export function createHerd() {
  ufo = createUfo()
  for (let i = 0; i < HERD; i++) cows.push(spawnCow(i))
  engine.addSystem(cowSystem)
  engine.addSystem(ufoSystem)
}
