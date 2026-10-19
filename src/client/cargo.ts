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
import { CARGO_BAY, CARGO_BAY_RADIUS, CENTER, LAUNCHER, SPACE_RADIUS } from '../layout'
import { KUDOS } from '../shared/gameConfig'
import { room } from '../shared/messages'
import { attachLoop, moo, playAt, playGlobal, SFX } from './sfx'
import { kudosHud, toast } from './ui'
import { burstExplosion, PALETTES, puffTrail } from './fx'

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
const R = SPACE_RADIUS
const PEN_COW_SCALE = 1.3
const CARRY_SCALE = PEN_COW_SCALE
const FLOAT_SCALE = 1.6
const FLOAT_SPEED = 0.35 // m/s along the ring
const FLIGHT_SECONDS = 3.2
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
const plasmaBars: Entity[] = []
const PLASMA = Color3.create(0.35, 1, 0.55)

function setPlasma(glow: number) {
  for (const bar of plasmaBars) {
    Material.setPbrMaterial(bar, {
      albedoColor: Color4.create(PLASMA.r, PLASMA.g, PLASMA.b, 0.22 + 0.1 * glow),
      emissiveColor: PLASMA,
      emissiveIntensity: 1.2 + 1.6 * glow,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false,
      roughness: 1,
      metallic: 0
    })
  }
}

function createCargoBay() {
  // The Meshy pen (models/cow-pen.glb): round fence of gunmetal posts and green rails on a base
  // plate, gate gap on its +Z side. Model 1.73 wide, 0.42 tall, origin mid-height: the plate top is
  // at y -0.06, so the model is sunk until the plate sits just proud of the floor.
  const PEN_SCALE = 5.8
  const GATE_FROM = -15 // the fence gap in model degrees from +Z (towards +X)
  const GATE_TO = 45
  const toCentre = Vector3.normalize(Vector3.create(CENTER.x - CARGO_BAY.x, 0, CENTER.z - CARGO_BAY.z))
  const yaw = (Math.atan2(toCentre.x, toCentre.z) * 180) / Math.PI - (GATE_FROM + GATE_TO) / 2 // gate centre faces the dome centre
  const penRoot = engine.addEntity()
  Transform.create(penRoot, { position: Vector3.create(CARGO_BAY.x, 0, CARGO_BAY.z), rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })
  const pen3d = engine.addEntity()
  Transform.create(pen3d, { parent: penRoot, position: Vector3.create(0, 0.05 - (0.2 - 0.06) * PEN_SCALE, 0), scale: Vector3.create(PEN_SCALE, PEN_SCALE, PEN_SCALE) })
  GltfContainer.create(pen3d, { src: 'models/cow-pen.glb', visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })

  // Plasma bars: a translucent green energy band between the two rails, in segments around the
  // fence (none across the gate), pulsing together.
  const BAR_R = 4.7
  const BAR_Y = 1.1
  const BAR_H = 0.62
  const SEGS = 24
  for (let i = 0; i < SEGS; i++) {
    const a0 = (i / SEGS) * 360
    const mid = a0 + 180 / SEGS
    const m = ((mid + 180) % 360) - 180 // -180..180 from +Z
    if (m > GATE_FROM - 4 && m < GATE_TO + 4) continue
    const rad = (mid * Math.PI) / 180
    const bar = engine.addEntity()
    Transform.create(bar, {
      parent: penRoot,
      position: Vector3.create(BAR_R * Math.sin(rad), BAR_Y, BAR_R * Math.cos(rad)),
      rotation: Quaternion.fromEulerDegrees(0, mid, 0),
      scale: Vector3.create((2 * Math.PI * BAR_R) / SEGS + 0.02, BAR_H, 1)
    })
    MeshRenderer.setPlane(bar)
    plasmaBars.push(bar)
  }
  setPlasma(1)

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
      ? 'empty: play the cow game to catch more cows\n(the saucer waits on the launch pad)'
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
  AvatarAttach.create(carrier, { anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
  held = engine.addEntity()
  Transform.create(held, { parent: carrier, position: Vector3.create(0, 0.1, 0.3), rotation: Quaternion.fromEulerDegrees(0, 90, 90), scale: Vector3.create(CARRY_SCALE, CARRY_SCALE, CARRY_SCALE) })
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

/**
 * The Meshy launch pad (models/launch-pad.glb): a round hazard-striped deck with pink pylons and a
 * loading ramp on its +Z side. Model units: 1.77 wide, 0.67 tall with the origin at mid height
 * (bottom at y -0.33), deck top 0.26 above the bottom.
 */
const PAD_SCALE = 6.2
const PAD_DECK = 0.26 * PAD_SCALE // the cannon stands on the deck
/** Where the disc's bottom centre sits in model space; the pad is placed so this lands on the floor at LAUNCHER. */
const PAD_MODEL_CENTRE = Vector3.create(0.08, -0.33, -0.08)

/**
 * The cannon is three Meshy pieces (models/cannon-mount.glb, cannon-barrel.glb, cow-hopper.glb) on a
 * little rig so they can move: the mount stands on the deck facing `out`, the barrel hangs off a
 * pivot in the mount's yoke and tilts/recoils, the hopper sits behind the breech. Each `Fit` maps
 * the raw Meshy model into rig space (barrel: tube along +Z with the muzzle at +Z, pivot at the
 * origin; mount: bottom centre at the origin, yoke opening towards +Z; hopper: bottom centre at the
 * origin, chute towards +Z). Measured in Blender on the raw Meshy output:
 *   barrel 1.9 long along its +X (muzzle, the wider red ring, at +X), 0.7 thick, centred on its origin
 *   mount 1.9 x 1.57 x 1.6, origin mid-height (bottom y -0.8), trunnion axle along X at y 0.16, pink disc facing +Z
 *   hopper 1.9 x 1.56 x 1.79, origin mid-height (bottom y -0.89), bin opening at about y 0.5, lid hinged on the -Z side
 */
interface Fit {
  rotation: Quaternion
  scale: number
  offset: Vector3 // rig-space translation applied after rotate+scale
}
const MOUNT_SCALE = 2.6
const MOUNT_FIT: Fit = { rotation: Quaternion.fromEulerDegrees(0, 0, 0), scale: MOUNT_SCALE, offset: Vector3.create(0, 0.8 * MOUNT_SCALE, 0) }
const PIVOT_H = (0.8 + 0.16) * MOUNT_SCALE // trunnion axle above the deck (rig m)
const BARREL_SCALE = 3.6
const BARREL_LEN = 1.9 * BARREL_SCALE // rig m, breech at -0.38 L, muzzle at +0.62 L
// model +X -> rig +Z; the tube's centre sits 0.12 L ahead of the pivot and rests on top of the axle
const BARREL_FIT: Fit = { rotation: Quaternion.fromEulerDegrees(0, -90, 0), scale: BARREL_SCALE, offset: Vector3.create(0, 0.5, 0.12 * BARREL_LEN) }
const MUZZLE_AT = 0.62 * BARREL_LEN
const REST_TILT = 38
const FIRE_TILT = 52
const HOPPER_SCALE = 1.6
const HOPPER_FIT: Fit = { rotation: Quaternion.fromEulerDegrees(0, 0, 0), scale: HOPPER_SCALE, offset: Vector3.create(0, 0.89 * HOPPER_SCALE, 0) }
const HOPPER_BACK = 4.0 // hopper centre behind the pivot, along -out (its front edge meets the breech)
const HOPPER_TOP = (0.89 + 0.5) * HOPPER_SCALE // rig m above the deck, where the cow drops in

let barrelRoot: Entity
let pivot = Vector3.Zero()
let out = Vector3.Forward()
let hopperTop = Vector3.Zero()
let cannonLight: Entity
let hopperLight: Entity

function fitted(parent: Entity, model: string, fit: Fit, clickable: boolean): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: fit.offset, rotation: fit.rotation, scale: Vector3.create(fit.scale, fit.scale, fit.scale) })
  GltfContainer.create(e, {
    src: model,
    visibleMeshesCollisionMask: clickable ? ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER : ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  return e
}

function dirAtTilt(tiltDeg: number) {
  const t = (tiltDeg * Math.PI) / 180
  return Vector3.create(out.x * Math.cos(t), Math.sin(t), out.z * Math.cos(t))
}

/** Points the barrel rig along `dir` (its +Z) and moves the muzzle with it. */
function aimBarrel(dir: Vector3, recoil = 0) {
  launchDir = dir
  const t = Transform.getMutable(barrelRoot)
  t.rotation = Quaternion.lookRotation(dir, Vector3.Up())
  t.position = Vector3.subtract(pivot, Vector3.scale(dir, recoil))
  muzzle = Vector3.add(t.position, Vector3.scale(dir, MUZZLE_AT))
}

function createLauncher() {
  out = Vector3.normalize(Vector3.create(LAUNCHER.x - CENTER.x, 0, LAUNCHER.z - CENTER.z))
  const deck = Vector3.create(LAUNCHER.x, PAD_DECK, LAUNCHER.z)
  pivot = Vector3.create(LAUNCHER.x, PAD_DECK + PIVOT_H, LAUNCHER.z)
  const facing = Quaternion.lookRotation(out, Vector3.Up())

  // the pad, ramp towards the middle of the dome (where you walk in from with a cow)
  const padRot = Quaternion.lookRotation(Vector3.scale(out, -1), Vector3.Up())
  const pad = engine.addEntity()
  Transform.create(pad, {
    position: Vector3.subtract(Vector3.create(LAUNCHER.x, 0, LAUNCHER.z), Vector3.scale(Vector3.rotate(PAD_MODEL_CENTRE, padRot), PAD_SCALE)),
    rotation: padRot,
    scale: Vector3.create(PAD_SCALE, PAD_SCALE, PAD_SCALE)
  })
  GltfContainer.create(pad, { src: 'models/launch-pad.glb', visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })

  const mountRoot = engine.addEntity()
  Transform.create(mountRoot, { position: deck, rotation: facing })
  const mount = fitted(mountRoot, 'models/cannon-mount.glb', MOUNT_FIT, true)

  barrelRoot = engine.addEntity()
  Transform.create(barrelRoot, { position: pivot })
  const barrel = fitted(barrelRoot, 'models/cannon-barrel.glb', BARREL_FIT, true)
  aimBarrel(dirAtTilt(REST_TILT))

  const hopperRoot = engine.addEntity()
  Transform.create(hopperRoot, { position: Vector3.subtract(deck, Vector3.scale(out, HOPPER_BACK)), rotation: facing })
  const hopper = fitted(hopperRoot, 'models/cow-hopper.glb', HOPPER_FIT, true)
  hopperTop = Vector3.add(Transform.get(hopperRoot).position, Vector3.create(0, HOPPER_TOP, 0))

  cannonLight = engine.addEntity()
  Transform.create(cannonLight, { position: Vector3.create(LAUNCHER.x, PAD_DECK + 6, LAUNCHER.z) })
  LightSource.create(cannonLight, { active: true, color: PINK, intensity: 900, range: 22, shadow: false, type: LightSource.Type.Point({}) })
  hopperLight = engine.addEntity()
  Transform.create(hopperLight, { position: Vector3.add(hopperTop, Vector3.create(0, 1.5, 0)) })
  LightSource.create(hopperLight, { active: true, color: Color3.create(0.4, 1, 0.55), intensity: 300, range: 10, shadow: false, type: LightSource.Type.Point({}) })
  // a low warm light so the deck, stripes and cannon read against the dark floor
  const deckLight = engine.addEntity()
  Transform.create(deckLight, { position: Vector3.subtract(Vector3.create(LAUNCHER.x, PAD_DECK + 3, LAUNCHER.z), Vector3.scale(out, 5)) })
  LightSource.create(deckLight, { active: true, color: Color3.create(1, 0.85, 0.7), intensity: 700, range: 16, shadow: false, type: LightSource.Type.Point({}) })

  // Giant pink 3D "DROP COWS / HERE" over the cannon (models/text-drop.glb from tools/build-text.mjs,
  // origin on the bottom line's baseline, reads from -Z, so it billboards like the other signs).
  const SIGN_SCALE = 2.4
  const title = engine.addEntity()
  Transform.create(title, { position: Vector3.create(LAUNCHER.x, PAD_DECK + 9.2, LAUNCHER.z), scale: Vector3.create(SIGN_SCALE, SIGN_SCALE, SIGN_SCALE) })
  GltfContainer.create(title, { src: 'models/text-drop.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  Billboard.create(title, { billboardMode: BillboardMode.BM_Y })
  const titleLight = engine.addEntity()
  Transform.create(titleLight, { position: Vector3.create(LAUNCHER.x, PAD_DECK + 12, LAUNCHER.z) })
  LightSource.create(titleLight, { active: true, color: PINK, intensity: 250, range: 16, shadow: false, type: LightSource.Type.Point({}) })
  let titleClock = 0
  engine.addSystem((dt) => {
    titleClock += dt
    const k = SIGN_SCALE * (1 + (0.5 + Math.sin(titleClock * 3) * 0.5) * 0.04)
    const t = Transform.getMutable(title)
    t.scale = Vector3.create(k, k, k)
    t.position.y = PAD_DECK + 9.2 + Math.sin(titleClock * 1.3) * 0.25
  })

  launcherLabel = engine.addEntity()
  Transform.create(launcherLabel, { position: Vector3.create(LAUNCHER.x, PAD_DECK + 7.1, LAUNCHER.z) })
  Billboard.create(launcherLabel, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(launcherLabel, { text: '', fontSize: 2.4, font: Font.F_SANS_SERIF, textColor: Color4.White(), outlineColor: Color4.Black(), outlineWidth: 0.1, textAlign: TextAlignMode.TAM_MIDDLE_CENTER })

  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(LAUNCHER.x, PAD_DECK + 6.2, LAUNCHER.z) })
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

  for (const target of [barrel, hopper, mount]) {
    pointerEventsSystem.onPointerDown({ entity: target, opts: { button: InputAction.IA_PRIMARY, hoverText: 'Load cow', maxDistance: 12 } }, onLaunchClick)
  }
  engine.addSystem(launchSequenceSystem)
}

// ---- load, charge, fire ---------------------------------------------------------------------
//
// Only the player who clicks sees the loading: their carried cow hops into the hopper, the barrel
// lifts and shakes while it charges, then the shot is sent to the server; everyone sees the
// flight (cowLaunched) leave the muzzle.

const LOAD_T = 0.9
const CHARGE_T = 1.5
const RECOIL_T = 1.3
const SEQ_T = LOAD_T + CHARGE_T + RECOIL_T

let seq: { t: number; cow: Entity | null; from: Vector3; fired: boolean } | null = null

function onLaunchClick() {
  if (!state.carrying) {
    toast(state.cargo > 0 ? 'Bring a cow from the CARGO BAY first.' : 'No cows to launch. Play the cow game to catch more: the saucer waits on the launch pad.', 5)
    playGlobal(SFX.uiClick, 0.6)
    return
  }
  if (seq) return // one at a time
  const player = Transform.getOrNull(engine.PlayerEntity)?.position ?? hopperTop
  dropCarried()
  const from = Vector3.add(player, Vector3.create(0, 1.0, 0))
  const cow = engine.addEntity()
  Transform.create(cow, { position: from, scale: Vector3.create(CARRY_SCALE, CARRY_SCALE, CARRY_SCALE) })
  cowModel(cow, false)
  moo(hopperTop, 0.8)
  seq = { t: 0, cow, from, fired: false }
  refreshPen()
  pushHud()
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)

function launchSequenceSystem(dt: number) {
  if (!seq) return
  seq.t += dt
  const t = seq.t
  const light = LightSource.getMutable(cannonLight)
  const hl = LightSource.getMutable(hopperLight)

  if (t < LOAD_T) {
    // the cow hops in an arc from your hands into the hopper and shrinks away into it
    const u = t / LOAD_T
    const p = lerp(seq.from, hopperTop, u)
    p.y += Math.sin(u * Math.PI) * 2.5
    const tr = Transform.getMutable(seq.cow!)
    tr.position = p
    tr.rotation = Quaternion.fromEulerDegrees(u * 360, 0, u * 180)
    const k = CARRY_SCALE * (u < 0.8 ? 1 : 1 - (u - 0.8) / 0.2)
    tr.scale = Vector3.create(k, k, k)
    hl.intensity = 300 + u * 900
    return
  }
  if (seq.cow) {
    engine.removeEntity(seq.cow)
    seq.cow = null
    puffTrail(hopperTop, Color3.create(0.5, 1, 0.6), 1.2)
    playAt(SFX.beamCharge, pivot, 0.9)
  }
  const c = t - LOAD_T
  if (c < CHARGE_T) {
    // barrel lifts to firing angle and shakes harder as it charges
    const u = easeInOut(Math.min(1, c / CHARGE_T))
    const dir = dirAtTilt(REST_TILT + (FIRE_TILT - REST_TILT) * u)
    aimBarrel(dir)
    const jitter = 0.08 * u
    const bt = Transform.getMutable(barrelRoot)
    bt.position = Vector3.add(bt.position, Vector3.create(rand(-jitter, jitter), rand(-jitter, jitter), rand(-jitter, jitter)))
    light.intensity = 900 + 2600 * u
    hl.intensity = 1200 - 900 * u
    if (Math.random() < 0.3) puffTrail(Vector3.add(muzzle, Vector3.create(rand(-0.5, 0.5), rand(-0.5, 0.5), rand(-0.5, 0.5))), Color3.create(1, 0.5, 0.85), 0.5)
    return
  }
  if (!seq.fired) {
    seq.fired = true
    aimBarrel(dirAtTilt(FIRE_TILT))
    room.send('cowLaunch', { v: 1 })
    playAt(SFX.launch, muzzle, 1)
    burstExplosion(muzzle, 1.6, PALETTES.cow)
  }
  const r = c - CHARGE_T
  if (r < RECOIL_T) {
    // kick back along the barrel, settle, and ease back down to the rest angle
    const u = r / RECOIL_T
    const recoil = 1.1 * Math.exp(-u * 6) * Math.max(0, 1 - u * 2.5)
    const settle = easeInOut(Math.min(1, Math.max(0, (u - 0.25) / 0.75)))
    aimBarrel(dirAtTilt(FIRE_TILT + (REST_TILT - FIRE_TILT) * settle), recoil)
    light.intensity = 3500 - 2600 * u
    hl.intensity = 300
    return
  }
  aimBarrel(dirAtTilt(REST_TILT))
  light.intensity = 900
  seq = null
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
  dir: Vector3 // barrel direction at the shot; the path leaves straight along it
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
  Transform.getMutable(cow.entity).position = Vector3.clone(muzzle)
  flights.push({ cow, t: 0, from: Vector3.clone(muzzle), dir: Vector3.clone(launchDir) })
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
const HOLE_Y = 14

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
  if (plasmaBars.length && clock % 0.1 < dt) setPlasma(0.5 + 0.5 * Math.sin(clock * 2.6))
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
    // cubic bezier: straight out of the muzzle for most of the way, then bending to its ring slot
    const dist = Vector3.distance(f.from, target)
    const p1 = Vector3.add(f.from, Vector3.scale(f.dir, dist * 0.55))
    const p2 = lerp(target, p1, 0.3)
    const ab = lerp(f.from, p1, t)
    const bc = lerp(p1, p2, t)
    const cd = lerp(p2, target, t)
    const tr = Transform.getMutable(f.cow.entity)
    tr.position = lerp(lerp(ab, bc, t), lerp(bc, cd, t), t)
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
