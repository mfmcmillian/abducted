import {
  AvatarAnchorPointType,
  AvatarAttach,
  Billboard,
  BillboardMode,
  ColliderLayer,
  engine,
  Entity,
  Font,
  GltfContainer,
  InputAction,
  LightSource,
  Material,
  MaterialTransparencyMode,
  MeshCollider,
  MeshRenderer,
  pointerEventsSystem,
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CARGO_BAY, CARGO_BAY_RADIUS, CENTER, DOME_RADIUS, LAUNCHER } from '../layout'
import { KUDOS } from '../shared/gameConfig'
import { room } from '../shared/messages'
import { attachLoop, moo, playAt, playGlobal, SFX } from './sfx'
import { kudosHud, toast } from './ui'

/**
 * The kudos loop, dome side.
 *
 * Cows caught in the pasture wait in the CARGO BAY. Click one to carry it (it rides above
 * your head), walk it to the COW LAUNCHER and click to fire it out through the observation
 * deck. Launched cows float in the star ring where everyone can see them; every couple of
 * minutes the BLACK HOLE sweeps through and swallows the lot, and the server pays the owners
 * in kudos. Counts and kudos come from the server (src/server/kudosServer.ts); this file
 * only shows them and animates.
 */

const TAU = Math.PI * 2
const R = DOME_RADIUS
const PEN_COW_SCALE = 1.3
const CARRY_SCALE = 0.7
const FLOAT_SCALE = 1.6
const FLOAT_SPEED = 0.35 // m/s along the ring
const FLIGHT_SECONDS = 2.6
const PINK = Color3.create(1, 0.35, 0.8)
const PURPLE = Color3.create(0.65, 0.25, 1)

const polar = (rho: number, phi: number, y: number) => Vector3.create(CENTER.x + rho * Math.sin(phi), y, CENTER.z + rho * Math.cos(phi))
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const lerp = (a: Vector3, b: Vector3, t: number) => Vector3.create(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)

function hideEntity(e: Entity) {
  const t = Transform.getMutable(e)
  t.scale = Vector3.create(0.001, 0.001, 0.001)
  t.position = Vector3.create(CENTER.x, -30, CENTER.z)
}

function cowModel(entity: Entity, clickable: boolean) {
  GltfContainer.create(entity, {
    src: 'models/cow.glb',
    visibleMeshesCollisionMask: clickable ? ColliderLayer.CL_POINTER : ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
}

// ---- state -----------------------------------------------------------------------------

const state = { cargo: 0, kudos: 0, launched: 0, nextHoleIn: KUDOS.holePeriodSeconds, carrying: false, synced: false }

function pushHud() {
  kudosHud.synced = state.synced
  kudosHud.kudos = state.kudos
  kudosHud.cargo = state.cargo
  kudosHud.launched = state.launched
  kudosHud.nextHoleIn = state.nextHoleIn
  kudosHud.carrying = state.carrying
}

// ---- cargo bay -------------------------------------------------------------------------

interface PenCow {
  entity: Entity
  home: Vector3
  heading: number
  timer: number
  shown: boolean
}
const pen: PenCow[] = []
let penLabel: Entity

function createCargoBay() {
  const ring = engine.addEntity()
  Transform.create(ring, { position: Vector3.create(CARGO_BAY.x, 0.08, CARGO_BAY.z), scale: Vector3.create(CARGO_BAY_RADIUS * 2, 0.06, CARGO_BAY_RADIUS * 2) })
  MeshRenderer.setCylinder(ring)
  Material.setPbrMaterial(ring, { albedoColor: Color4.create(0.03, 0.08, 0.05, 1), emissiveColor: Color3.create(0.35, 1, 0.45), emissiveIntensity: 0.6, roughness: 0.6 })

  // Fence posts with a soft glow so the pen reads from across the room.
  const POSTS = 10
  for (let i = 0; i < POSTS; i++) {
    const a = (i / POSTS) * TAU
    const post = engine.addEntity()
    Transform.create(post, {
      position: Vector3.create(CARGO_BAY.x + CARGO_BAY_RADIUS * Math.sin(a), 0.6, CARGO_BAY.z + CARGO_BAY_RADIUS * Math.cos(a)),
      scale: Vector3.create(0.18, 1.2, 0.18)
    })
    MeshRenderer.setBox(post)
    Material.setPbrMaterial(post, { albedoColor: Color4.create(0.08, 0.09, 0.1, 1), emissiveColor: Color3.create(0.35, 1, 0.45), emissiveIntensity: 1.2, metallic: 0.6, roughness: 0.4 })
  }

  const title = engine.addEntity()
  Transform.create(title, { position: Vector3.create(CARGO_BAY.x, 4.6, CARGO_BAY.z) })
  Billboard.create(title, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(title, { text: 'CARGO BAY', fontSize: 6, font: Font.F_SANS_SERIF, textColor: Color4.create(0.6, 1, 0.75, 1), outlineColor: Color4.Black(), outlineWidth: 0.12, textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
  penLabel = engine.addEntity()
  Transform.create(penLabel, { position: Vector3.create(CARGO_BAY.x, 3.6, CARGO_BAY.z) })
  Billboard.create(penLabel, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(penLabel, { text: '', fontSize: 2.4, font: Font.F_SANS_SERIF, textColor: Color4.White(), outlineColor: Color4.Black(), outlineWidth: 0.1, textAlign: TextAlignMode.TAM_MIDDLE_CENTER })

  const light = engine.addEntity()
  Transform.create(light, { position: Vector3.create(CARGO_BAY.x, 5, CARGO_BAY.z) })
  LightSource.create(light, { active: true, color: Color3.create(0.4, 1, 0.55), intensity: 600, range: 16, shadow: false, type: LightSource.Type.Point({}) })

  for (let i = 0; i < KUDOS.penCapacity; i++) {
    const entity = engine.addEntity()
    const a = rand(0, TAU)
    const r = Math.sqrt(Math.random()) * (CARGO_BAY_RADIUS - 1.2)
    const home = Vector3.create(CARGO_BAY.x + r * Math.sin(a), 0, CARGO_BAY.z + r * Math.cos(a))
    Transform.create(entity, { position: home, rotation: Quaternion.fromEulerDegrees(0, rand(0, 360), 0), scale: Vector3.create(PEN_COW_SCALE, PEN_COW_SCALE, PEN_COW_SCALE) })
    cowModel(entity, true)
    const cow: PenCow = { entity, home, heading: rand(0, 360), timer: rand(2, 6), shown: true }
    pen.push(cow)
    pointerEventsSystem.onPointerDown({ entity, opts: { button: InputAction.IA_PRIMARY, hoverText: 'Pick up cow', maxDistance: 9 } }, () => pickUp(cow))
    hideEntity(entity)
    cow.shown = false
  }
  refreshPen()
}

function refreshPen() {
  const visible = Math.max(0, state.cargo - (state.carrying ? 1 : 0))
  for (let i = 0; i < pen.length; i++) {
    const cow = pen[i]
    const show = i < visible
    if (show === cow.shown) continue
    cow.shown = show
    const t = Transform.getMutable(cow.entity)
    if (show) {
      t.position = Vector3.clone(cow.home)
      t.scale = Vector3.create(PEN_COW_SCALE, PEN_COW_SCALE, PEN_COW_SCALE)
    } else hideEntity(cow.entity)
  }
  const extra = visible - pen.length
  const text = !state.synced
    ? ''
    : visible === 0
      ? 'empty: catch cows in the pasture\n(the saucer waits on the launch pad)'
      : `${visible} cow${visible === 1 ? '' : 's'} waiting${extra > 0 ? ` (${extra} more in the hold)` : ''}\nclick one to carry it to the launcher`
  TextShape.getMutable(penLabel).text = text
}

// ---- carrying ---------------------------------------------------------------------------

let carrier: Entity | null = null
let held: Entity | null = null

function pickUp(cow: PenCow) {
  if (state.carrying) {
    toast('You are already carrying a cow. Drop it in the launcher.', 4)
    return
  }
  state.carrying = true
  moo(Vector3.create(cow.home.x, 1, cow.home.z), 0.8)
  carrier = engine.addEntity()
  AvatarAttach.create(carrier, { anchorPointId: AvatarAnchorPointType.AAPT_NAME_TAG })
  held = engine.addEntity()
  Transform.create(held, { parent: carrier, position: Vector3.create(0, 0.15, 0), rotation: Quaternion.fromEulerDegrees(0, 90, 0), scale: Vector3.create(CARRY_SCALE, CARRY_SCALE, CARRY_SCALE) })
  cowModel(held, false)
  refreshPen()
  pushHud()
  toast('Got one. Walk it to the COW LAUNCHER by the windows and click the barrel.', 6)
}

function dropCarried() {
  if (held) engine.removeEntity(held)
  if (carrier) engine.removeEntity(carrier)
  held = null
  carrier = null
  state.carrying = false
}

// ---- launcher ---------------------------------------------------------------------------

let muzzle = Vector3.Zero()
let launchDir = Vector3.Forward()
let launcherLabel: Entity

/** Rotation that points a Y-axis primitive (cylinder) along dir. */
function alignY(dir: Vector3) {
  return Quaternion.multiply(Quaternion.lookRotation(dir, Vector3.Up()), Quaternion.fromEulerDegrees(90, 0, 0))
}

function createLauncher() {
  const out = Vector3.normalize(Vector3.create(LAUNCHER.x - CENTER.x, 0, LAUNCHER.z - CENTER.z))
  const tilt = (38 * Math.PI) / 180
  launchDir = Vector3.create(out.x * Math.cos(tilt), Math.sin(tilt), out.z * Math.cos(tilt))
  const pivot = Vector3.create(LAUNCHER.x, 2.2, LAUNCHER.z)
  const BARREL = 7.5
  muzzle = Vector3.add(pivot, Vector3.scale(launchDir, BARREL / 2))

  const metal = { albedoColor: Color4.create(0.12, 0.13, 0.15, 1), metallic: 0.85, roughness: 0.35 }

  const base = engine.addEntity()
  Transform.create(base, { position: Vector3.create(LAUNCHER.x, 0.6, LAUNCHER.z), scale: Vector3.create(4.4, 1.2, 4.4) })
  MeshRenderer.setBox(base)
  MeshCollider.setBox(base)
  Material.setPbrMaterial(base, metal)

  const hopper = engine.addEntity()
  Transform.create(hopper, { position: Vector3.subtract(Vector3.create(LAUNCHER.x, 2.0, LAUNCHER.z), Vector3.scale(out, 1.6)), scale: Vector3.create(2.4, 1.6, 2.4) })
  MeshRenderer.setBox(hopper)
  MeshCollider.setBox(hopper)
  Material.setPbrMaterial(hopper, { albedoColor: Color4.create(0.06, 0.1, 0.08, 1), emissiveColor: Color3.create(0.35, 1, 0.45), emissiveIntensity: 0.5, metallic: 0.5, roughness: 0.5 })

  const barrel = engine.addEntity()
  Transform.create(barrel, { position: Vector3.add(pivot, Vector3.scale(launchDir, BARREL / 2 - 0.6)), rotation: alignY(launchDir), scale: Vector3.create(2.2, BARREL, 2.2) })
  MeshRenderer.setCylinder(barrel, 1, 0.8)
  MeshCollider.setCylinder(barrel, 1, 0.8)
  Material.setPbrMaterial(barrel, metal)

  const ringMuzzle = engine.addEntity()
  Transform.create(ringMuzzle, { position: muzzle, rotation: alignY(launchDir), scale: Vector3.create(2.5, 0.35, 2.5) })
  MeshRenderer.setCylinder(ringMuzzle)
  Material.setPbrMaterial(ringMuzzle, { albedoColor: Color4.create(0.1, 0.02, 0.08, 1), emissiveColor: PINK, emissiveIntensity: 2, roughness: 0.3 })

  const bands = [0.25, 0.55]
  for (const f of bands) {
    const band = engine.addEntity()
    Transform.create(band, { position: Vector3.add(pivot, Vector3.scale(launchDir, BARREL * f - 0.6)), rotation: alignY(launchDir), scale: Vector3.create(2.4, 0.25, 2.4) })
    MeshRenderer.setCylinder(band)
    Material.setPbrMaterial(band, { albedoColor: Color4.create(0.1, 0.02, 0.08, 1), emissiveColor: PINK, emissiveIntensity: 1.2, roughness: 0.3 })
  }

  const light = engine.addEntity()
  Transform.create(light, { position: Vector3.create(LAUNCHER.x, 6, LAUNCHER.z) })
  LightSource.create(light, { active: true, color: PINK, intensity: 700, range: 18, shadow: false, type: LightSource.Type.Point({}) })

  const title = engine.addEntity()
  Transform.create(title, { position: Vector3.create(LAUNCHER.x, 8.2, LAUNCHER.z) })
  Billboard.create(title, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(title, { text: 'COW LAUNCHER', fontSize: 6, font: Font.F_SANS_SERIF, textColor: Color4.create(1, 0.45, 0.85, 1), outlineColor: Color4.Black(), outlineWidth: 0.12, textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
  launcherLabel = engine.addEntity()
  Transform.create(launcherLabel, { position: Vector3.create(LAUNCHER.x, 7.1, LAUNCHER.z) })
  Billboard.create(launcherLabel, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(launcherLabel, { text: '', fontSize: 2.4, font: Font.F_SANS_SERIF, textColor: Color4.White(), outlineColor: Color4.Black(), outlineWidth: 0.1, textAlign: TextAlignMode.TAM_MIDDLE_CENTER })

  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(LAUNCHER.x, 6.2, LAUNCHER.z) })
  Billboard.create(sign, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(sign, {
    text: `${KUDOS.perCow} KUDOS per cow the black hole swallows\nKUDOS buy Alien Costumes from Nov 7`,
    fontSize: 1.8,
    font: Font.F_SANS_SERIF,
    textColor: Color4.create(0.75, 0.85, 1, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.1,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  for (const target of [barrel, hopper, base]) {
    pointerEventsSystem.onPointerDown({ entity: target, opts: { button: InputAction.IA_PRIMARY, hoverText: 'Load cow', maxDistance: 10 } }, onLaunchClick)
  }
}

function onLaunchClick() {
  if (!state.carrying) {
    toast(state.cargo > 0 ? 'Bring a cow from the CARGO BAY first.' : 'No cows to launch. Catch some in the pasture: the saucer waits on the launch pad.', 5)
    playGlobal(SFX.uiClick, 0.6)
    return
  }
  dropCarried()
  playAt(SFX.launch, muzzle, 1)
  room.send('cowLaunch', { v: 1 })
  refreshPen()
  pushHud()
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${s % 60 < 10 ? '0' : ''}${s % 60}`
}

// ---- flights and floating cows ----------------------------------------------------------

interface FloatingCow {
  id: number
  owner: string
  entity: Entity
  rho: number
  phi: number
  y: number
  spin: Vector3
  bob: number
}
interface Flight {
  cow: FloatingCow
  t: number
  from: Vector3
  mid: Vector3
}
const floating = new Map<number, FloatingCow>()
const flights: Flight[] = []
const sucking: { cow: FloatingCow; t: number; start: Vector3; angle: number }[] = []

function makeFloating(data: { id: number; owner: string; rho: number; phi: number; y: number }): FloatingCow {
  const entity = engine.addEntity()
  Transform.create(entity, { position: polar(data.rho, data.phi, data.y), scale: Vector3.create(FLOAT_SCALE, FLOAT_SCALE, FLOAT_SCALE) })
  cowModel(entity, false)
  const cow: FloatingCow = { ...data, entity, spin: Vector3.create(rand(-25, 25), rand(-25, 25), rand(-25, 25)), bob: rand(0, TAU) }
  floating.set(data.id, cow)
  return cow
}

function onCowLaunched(data: { id: number; owner: string; rho: number; phi: number; y: number }) {
  if (floating.has(data.id)) return
  const cow = makeFloating(data)
  // Arc: muzzle -> a point on the wall at window height in the launcher's direction -> ring slot.
  const outAz = Math.atan2(LAUNCHER.x - CENTER.x, LAUNCHER.z - CENTER.z)
  const mid = polar(R + 1, outAz, 12)
  Transform.getMutable(cow.entity).position = Vector3.clone(muzzle)
  flights.push({ cow, t: 0, from: Vector3.clone(muzzle), mid })
}

// ---- black hole --------------------------------------------------------------------------

interface Hole {
  root: Entity
  sphere: Entity
  disc: Entity
  light: Entity
  phi0: number
  seconds: number
  t: number
  queue: { id: number; at: number }[]
  setHum: (v: number) => void
}
let hole: Hole | null = null
let holeSpare: Hole | null = null
const HOLE_RHO = R + 23
const HOLE_Y = 21

function createHoleEntities(): Hole {
  const root = engine.addEntity()
  Transform.create(root, { position: polar(HOLE_RHO, 0, HOLE_Y), scale: Vector3.Zero() })
  const sphere = engine.addEntity()
  Transform.create(sphere, { parent: root, scale: Vector3.create(7, 7, 7) })
  MeshRenderer.setSphere(sphere)
  Material.setPbrMaterial(sphere, { albedoColor: Color4.Black(), emissiveColor: Color3.Black(), metallic: 0, roughness: 1, specularIntensity: 0 })
  const disc = engine.addEntity()
  Transform.create(disc, { parent: root, scale: Vector3.create(19, 0.1, 19) })
  MeshRenderer.setCylinder(disc)
  Material.setPbrMaterial(disc, {
    albedoColor: Color4.create(0.5, 0.2, 1, 0.55),
    emissiveColor: PURPLE,
    emissiveIntensity: 2.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    roughness: 0.4
  })
  const glow = engine.addEntity()
  Transform.create(glow, { parent: root, scale: Vector3.create(9.5, 9.5, 9.5) })
  MeshRenderer.setSphere(glow)
  Material.setPbrMaterial(glow, { albedoColor: Color4.create(0.6, 0.3, 1, 0.12), emissiveColor: PURPLE, emissiveIntensity: 0.8, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  const light = engine.addEntity()
  Transform.create(light, { parent: root })
  LightSource.create(light, { active: false, color: PURPLE, intensity: 3000, range: 80, shadow: false, type: LightSource.Type.Point({}) })
  const setHum = attachLoop(root, SFX.blackHole, 0)
  return { root, sphere, disc, light, phi0: 0, seconds: 1, t: 0, queue: [], setHum }
}

function onBlackHole(data: { phi: number; seconds: number; ids: number[] }) {
  if (!hole) hole = createHoleEntities()
  hole.phi0 = data.phi
  hole.seconds = Math.max(6, data.seconds)
  hole.t = 0
  const ids = data.ids.filter((id) => floating.has(id) && !doomed.has(id))
  const first = 3
  const last = hole.seconds - 4
  hole.queue = ids.map((id, i) => ({ id, at: first + ((last - first) * (i + 0.5)) / Math.max(1, ids.length) }))
  LightSource.getMutable(hole.light).active = true
  hole.setHum(0.9)
  state.nextHoleIn = KUDOS.holePeriodSeconds
  if (ids.length) toast(`A black hole is passing the windows. It is taking ${ids.length} cow${ids.length === 1 ? '' : 's'}.`, 6)
}

function holePosition(h: Hole) {
  // Sweeps a third of the ring over the pass, facing the dome.
  const phi = h.phi0 + (TAU / 3) * (h.t / h.seconds)
  return polar(HOLE_RHO, phi, HOLE_Y + Math.sin(h.t * 0.7) * 1.5)
}

// ---- systems ------------------------------------------------------------------------------

let clock = 0
function system(dt: number) {
  clock += dt

  if (state.synced && state.nextHoleIn > 0) {
    state.nextHoleIn -= dt
    kudosHud.nextHoleIn = state.nextHoleIn
  }
  if (launcherLabel && (clock % 0.5) < dt) {
    TextShape.getMutable(launcherLabel).text = state.synced ? `black hole in ${formatTime(state.nextHoleIn)}  ·  ${state.launched} of yours floating` : ''
  }

  for (const cow of pen) {
    if (!cow.shown) continue
    cow.timer -= dt
    if (cow.timer > 0) continue
    cow.timer = rand(3, 8)
    cow.heading = rand(0, 360)
    Transform.getMutable(cow.entity).rotation = Quaternion.fromEulerDegrees(0, cow.heading, 0)
    if (Math.random() < 0.15) moo(Vector3.create(cow.home.x, 1, cow.home.z), 0.4)
  }

  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i]
    f.t += dt / FLIGHT_SECONDS
    const target = polar(f.cow.rho, f.cow.phi, f.cow.y)
    const t = Math.min(1, f.t)
    // quadratic bezier through the window
    const a = lerp(f.from, f.mid, t)
    const b = lerp(f.mid, target, t)
    const tr = Transform.getMutable(f.cow.entity)
    tr.position = lerp(a, b, t)
    tr.rotation = Quaternion.fromEulerDegrees(clock * 300, clock * 120, 0)
    if (t >= 1) flights.splice(i, 1)
  }

  const inFlight = new Set(flights.map((f) => f.cow.id))
  const beingSucked = new Set(sucking.map((s) => s.cow.id))
  for (const cow of floating.values()) {
    if (inFlight.has(cow.id) || beingSucked.has(cow.id)) continue
    cow.phi += (FLOAT_SPEED * dt) / cow.rho
    const tr = Transform.getMutable(cow.entity)
    tr.position = polar(cow.rho, cow.phi, cow.y + Math.sin(clock * 0.4 + cow.bob) * 0.5)
    tr.rotation = Quaternion.fromEulerDegrees(clock * cow.spin.x, clock * cow.spin.y, clock * cow.spin.z)
  }

  if (hole) {
    const h = hole
    h.t += dt
    const pos = holePosition(h)
    const grow = Math.min(1, h.t / 3, Math.max(0, (h.seconds - h.t) / 3))
    const root = Transform.getMutable(h.root)
    root.position = pos
    root.scale = Vector3.create(grow, grow, grow)
    // disc faces the dome centre, slightly tilted, spinning
    const inward = Vector3.normalize(Vector3.create(CENTER.x - pos.x, 0.35, CENTER.z - pos.z))
    Transform.getMutable(h.disc).rotation = Quaternion.multiply(alignY(inward), Quaternion.fromEulerDegrees(0, clock * 90, 0))
    LightSource.getMutable(h.light).intensity = 2200 + Math.sin(clock * 5) * 800
    h.setHum(grow * 0.9)

    while (h.queue.length && h.queue[0].at <= h.t) {
      const { id } = h.queue.shift()!
      const cow = floating.get(id)
      if (cow && !inFlight.has(id)) {
        sucking.push({ cow, t: 0, start: Vector3.clone(Transform.get(cow.entity).position), angle: rand(0, TAU) })
        moo(Transform.get(cow.entity).position, 0.9)
      }
    }
    if (h.t >= h.seconds) {
      for (const { id } of h.queue) removeFloating(id)
      h.queue = []
      LightSource.getMutable(h.light).active = false
      h.setHum(0)
      root.scale = Vector3.Zero()
      hole = null
      holeSpare = h
    }
  }

  for (let i = sucking.length - 1; i >= 0; i--) {
    const s = sucking[i]
    s.t += dt / 1.8
    const t = Math.min(1, s.t)
    const centre = hole ? holePosition(hole) : s.start
    const ease = t * t
    // spiral in: orbit the hole while closing the gap
    const gap = Vector3.scale(Vector3.subtract(s.start, centre), 1 - ease)
    const swirl = Quaternion.fromEulerDegrees(0, (s.angle + ease * TAU * 1.5) * (180 / Math.PI), 0)
    const pos = Vector3.add(centre, Vector3.rotate(gap, swirl))
    const tr = Transform.getMutable(s.cow.entity)
    tr.position = pos
    const sc = FLOAT_SCALE * (1 - ease)
    tr.scale = Vector3.create(sc, sc, sc)
    tr.rotation = Quaternion.fromEulerDegrees(clock * 400, clock * 500, 0)
    if (t >= 1) {
      if (hole) playAt(SFX.catch, centre, 0.6, 0.7)
      removeFloating(s.cow.id)
      sucking.splice(i, 1)
    }
  }
}

function removeFloating(id: number) {
  const cow = floating.get(id)
  if (!cow) return
  engine.removeEntity(cow.entity)
  floating.delete(id)
  doomed.delete(id)
}

/** Floating cows a raider has picked: the black hole leaves them alone, battles.ts finishes them. */
const doomed = new Set<number>()

export interface CowTarget {
  id: number
  position: () => Vector3
  /** Blow it up: removes the cow entity. */
  destroy: () => void
}

/** Hand a floating cow over to the raiders. Null when this client never saw it. */
export function claimFloatingCow(id: number): CowTarget | null {
  const cow = floating.get(id)
  if (!cow || doomed.has(id)) return null
  doomed.add(id)
  return {
    id,
    position: () => (floating.has(id) ? Vector3.clone(Transform.get(cow.entity).position) : polar(cow.rho, cow.phi, cow.y)),
    destroy: () => removeFloating(id)
  }
}

// ---- wiring --------------------------------------------------------------------------------

export function refreshCargo() {
  room.send('cargoGet', { v: 1 })
}

export function createCargoLoop() {
  createCargoBay()
  createLauncher()
  engine.addSystem(system)

  room.onMessage('cargoState', (data) => {
    state.cargo = data.cargo
    state.kudos = data.kudos
    state.launched = data.launched
    state.nextHoleIn = data.nextHoleIn
    state.synced = true
    refreshPen()
    pushHud()
    if (data.text) toast(data.text, 7)
  })
  room.onMessage('cowsFloating', (data) => {
    for (const c of data.cows) if (!floating.has(c.id)) makeFloating(c)
  })
  room.onMessage('cowLaunched', (data) => onCowLaunched(data))
  room.onMessage('blackHole', (data) => {
    if (hole) {
      // a second pass while one is running (overflow): just take the cows
      for (const id of data.ids) if (!doomed.has(id)) removeFloating(id)
      return
    }
    if (holeSpare) {
      hole = holeSpare
      holeSpare = null
    }
    onBlackHole(data)
  })

  // Ask once the room is up and keep asking every few seconds until the server answers;
  // after that the server pushes after every round, launch and black hole.
  let nextAsk = 2
  engine.addSystem((dt) => {
    if (state.synced) return
    nextAsk -= dt
    if (nextAsk > 0) return
    nextAsk = 5
    refreshCargo()
  })
}
