import {
  AvatarModifierArea,
  AvatarModifierType,
  Billboard,
  BillboardMode,
  CameraModeArea,
  CameraType,
  ColliderLayer,
  engine,
  Entity,
  Font,
  GltfContainer,
  GltfNodeModifiers,
  InputAction,
  InputModifier,
  inputSystem,
  LightSource,
  Material,
  MaterialTransparencyMode,
  MeshCollider,
  MeshRenderer,
  PointerEventType,
  TextAlignMode,
  TextShape,
  TextureFilterMode,
  TextureWrapMode,
  Transform,
  TriggerArea,
  triggerAreaEventsSystem,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'
import { ARENA_FLY_HEIGHT, ARENA_SIZE, ARENA_Y, CENTER, LANDING, LAUNCH_PAD, LEADERBOARD } from '../layout'
import { GAME, RULESET } from '../shared/gameConfig'
import { room } from '../shared/messages'
import { hud, toast, type BeamState } from './ui'

/**
 * The cow game (TheCowCatchingGame PRD v1.0, P0).
 *
 * The dome is the lobby: stand on the launch pad for three seconds and a saucer comes
 * down, beams you up and drops you on the sky pasture above the dome. Up there you ARE
 * the saucer (first person, saucer under your feet). First visit gets a practice cow with
 * no clock; then 3-2-1-GO and a 180 second round. The beam is a committed drop:
 * Ready -> Charging -> Active -> Cooldown. A cow has to sit in the footprint for a
 * moment to be locked; one cow per drop; 100 points with a combo multiplier that a miss
 * resets. Results, play again or back down to the dome.
 */

type Phase = 'idle' | 'padHold' | 'pickup' | 'arriving' | 'practice' | 'countdown' | 'playing' | 'finalizing' | 'results'

const PAD_HOLD = 3
const HALF = GAME.fieldSize / 2
const ARENA_CENTER = Vector3.create(CENTER.x, ARENA_Y, CENTER.z)
const FLY_Y = ARENA_Y + ARENA_FLY_HEIGHT
const BEAM_TOP = FLY_Y - 1.5
const BEAM_H = BEAM_TOP - ARENA_Y
const COW_SCALE = 1.6

let phase: Phase = 'idle'
let phaseTime = 0
let onPad = false
let pickupMoved = false
let practiced = false
let sessionBest = 0
let inputLocked = false

/** The scored run. A replay makes a new one. */
let runId = 0
const run = { score: 0, cows: 0, attempts: 0, successes: 0, multiplier: 1, left: 0 }

/** The tractor beam. Target is frozen at activation. */
const beam = { state: 'ready' as BeamState, time: 0, x: 0, z: 0, locked: false }

type CowState = 'graze' | 'wander' | 'startled' | 'lifting' | 'gone'
interface GameCow {
  entity: Entity
  enabled: boolean
  state: CowState
  x: number
  z: number
  heading: number
  /** wander target */
  tx: number
  tz: number
  speed: number
  /** state timer (graze left, wander budget, flee left, respawn wait) */
  timer: number
  /** startled reaction delay left */
  delay: number
  /** continuous seconds inside the active footprint */
  exposure: number
  /** lift progress 0..1 */
  lift: number
  bob: number
}
const cows: GameCow[] = []

let padText: Entity
let padSub: Entity
let padDisc: Entity
let padFill: Entity
const padRings: Entity[] = []
let liftUfo: Entity
let liftBeam: Entity
let liftLight: Entity
const liftIdle = Vector3.create(LAUNCH_PAD.x, 17, LAUNCH_PAD.z)
const liftDown = Vector3.create(LAUNCH_PAD.x, 12, LAUNCH_PAD.z)
let spinAngle = 0

let playerUfo: Entity
let playerBeam: Entity
let playerLight: Entity
let aimMarker: Entity
let boardText: Entity

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
function rand(min: number, max: number) {
  return min + Math.random() * (max - min)
}
function dist2(ax: number, az: number, bx: number, bz: number) {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

// ---------------------------------------------------------------------------
// Launch pad in the dome (the lobby's Play interaction)

function createLaunchPad() {
  const trigger = engine.addEntity()
  Transform.create(trigger, { position: Vector3.create(LAUNCH_PAD.x, 1.5, LAUNCH_PAD.z), scale: Vector3.create(4.5, 3, 4.5) })
  TriggerArea.setBox(trigger)
  triggerAreaEventsSystem.onTriggerEnter(trigger, () => {
    onPad = true
    if (phase === 'idle') {
      phase = 'padHold'
      phaseTime = 0
    }
  })
  triggerAreaEventsSystem.onTriggerExit(trigger, () => {
    onPad = false
    if (phase === 'padHold') {
      phase = 'idle'
      setPadText('STAND HERE TO FLY')
    }
  })

  padDisc = engine.addEntity()
  Transform.create(padDisc, { position: Vector3.create(LAUNCH_PAD.x, 0.12, LAUNCH_PAD.z), scale: Vector3.create(6.4, 0.24, 6.4) })
  MeshRenderer.setCylinder(padDisc, 1, 1)
  MeshCollider.setCylinder(padDisc, 1, 1, ColliderLayer.CL_PHYSICS)
  Material.setPbrMaterial(padDisc, {
    albedoColor: Color4.create(0.03, 0.08, 0.1, 1),
    emissiveColor: Color3.create(0.4, 0.9, 1),
    emissiveIntensity: 1.2,
    metallic: 0.5,
    roughness: 0.3
  })
  const ringSpecs: Array<[number, number]> = [
    [2.8, 1.6],
    [2.2, 3.0],
    [1.6, 4.4]
  ]
  for (const [radius, y] of ringSpecs) {
    const ring = engine.addEntity()
    Transform.create(ring, { position: Vector3.create(LAUNCH_PAD.x, y, LAUNCH_PAD.z), scale: Vector3.create(radius * 2, 0.08, radius * 2) })
    MeshRenderer.setCylinder(ring, 1, 0.92)
    Material.setPbrMaterial(ring, {
      albedoColor: Color4.create(0.4, 0.9, 1, 0.55),
      emissiveColor: Color3.create(0.4, 0.9, 1),
      emissiveIntensity: 2,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false
    })
    padRings.push(ring)
  }
  padFill = engine.addEntity()
  Transform.create(padFill, { position: Vector3.create(LAUNCH_PAD.x, 0.3, LAUNCH_PAD.z), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(padFill, 1, 1)
  Material.setPbrMaterial(padFill, {
    albedoColor: Color4.create(0.4, 0.9, 1, 0.22),
    emissiveColor: Color3.create(0.4, 0.9, 1),
    emissiveIntensity: 1.2,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })

  padText = engine.addEntity()
  Transform.create(padText, { position: Vector3.create(LAUNCH_PAD.x, 6.2, LAUNCH_PAD.z) })
  TextShape.create(padText, {
    text: 'STAND HERE TO FLY',
    fontSize: 3,
    font: Font.F_SANS_SERIF,
    textColor: Color4.create(0.5, 0.95, 1, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.15,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(padText, { billboardMode: BillboardMode.BM_Y })
  padSub = engine.addEntity()
  Transform.create(padSub, { position: Vector3.create(LAUNCH_PAD.x, 5.3, LAUNCH_PAD.z) })
  TextShape.create(padSub, {
    text: '',
    fontSize: 1.4,
    font: Font.F_SANS_SERIF,
    textColor: Color4.create(0.7, 0.85, 0.95, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.12,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    lineSpacing: 10
  })
  Billboard.create(padSub, { billboardMode: BillboardMode.BM_Y })
  updatePadSub()

  const glow = engine.addEntity()
  Transform.create(glow, { position: Vector3.create(LAUNCH_PAD.x, 3, LAUNCH_PAD.z) })
  LightSource.create(glow, { active: true, color: Color3.create(0.4, 0.9, 1), intensity: 500, range: 12, shadow: false, type: LightSource.Type.Point({}) })

  liftUfo = engine.addEntity()
  Transform.create(liftUfo, { position: Vector3.clone(liftIdle), scale: Vector3.create(3.5, 3.5, 3.5) })
  GltfContainer.create(liftUfo, { src: 'models/ufo.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  liftBeam = engine.addEntity()
  Transform.create(liftBeam, { position: Vector3.create(LAUNCH_PAD.x, liftDown.y / 2, LAUNCH_PAD.z), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(liftBeam, 3.2, 1.2)
  Material.setPbrMaterial(liftBeam, {
    albedoColor: Color4.create(0.4, 0.9, 1, 0.3),
    emissiveColor: Color3.create(0.4, 0.9, 1),
    emissiveIntensity: 1.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  liftLight = engine.addEntity()
  Transform.create(liftLight, { position: Vector3.create(LAUNCH_PAD.x, 12, LAUNCH_PAD.z), rotation: Quaternion.fromEulerDegrees(90, 0, 0) })
  LightSource.create(liftLight, {
    active: false,
    color: Color3.create(0.4, 0.9, 1),
    intensity: 2500,
    range: 20,
    shadow: false,
    type: LightSource.Type.Spot({ innerAngle: 20, outerAngle: 40 })
  })
}

function setPadText(text: string) {
  TextShape.getMutable(padText).text = text
}

function updatePadSub() {
  const best = sessionBest > 0 ? `\nbest this session: ${sessionBest}` : ''
  TextShape.getMutable(padSub).text = `the cow game: fly a saucer over the pasture, drop the beam on cows\n3 minute rounds  ·  WASD to fly  ·  click or E drops the beam${best}`
}

// ---------------------------------------------------------------------------
// Sky pasture

function createArena() {
  const pasture = engine.addEntity()
  Transform.create(pasture, { position: Vector3.clone(ARENA_CENTER), rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(ARENA_SIZE, ARENA_SIZE, 1) })
  MeshRenderer.setPlane(pasture)
  Material.setPbrMaterial(pasture, { albedoColor: Color4.create(0.07, 0.14, 0.07, 1), emissiveColor: Color3.create(0.02, 0.05, 0.02), emissiveIntensity: 1, roughness: 1 })

  // The playable field: brighter grass, glowing fence line, and invisible walls so the
  // saucer slides along the edge instead of leaving.
  const field = engine.addEntity()
  Transform.create(field, { position: Vector3.create(ARENA_CENTER.x, ARENA_Y + 0.02, ARENA_CENTER.z), rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(GAME.fieldSize, GAME.fieldSize, 1) })
  MeshRenderer.setPlane(field)
  Material.setPbrMaterial(field, { albedoColor: Color4.create(0.1, 0.2, 0.09, 1), emissiveColor: Color3.create(0.03, 0.08, 0.03), emissiveIntensity: 1, roughness: 1 })
  for (let i = 0; i < 4; i++) {
    const along = i < 2
    const sign = i % 2 === 0 ? -1 : 1
    const edge = engine.addEntity()
    Transform.create(edge, {
      position: Vector3.create(ARENA_CENTER.x + (along ? 0 : sign * HALF), ARENA_Y + 0.3, ARENA_CENTER.z + (along ? sign * HALF : 0)),
      scale: along ? Vector3.create(GAME.fieldSize + 0.4, 0.6, 0.25) : Vector3.create(0.25, 0.6, GAME.fieldSize + 0.4)
    })
    MeshRenderer.setBox(edge)
    Material.setPbrMaterial(edge, { albedoColor: Color4.create(0.1, 0.3, 0.2, 1), emissiveColor: Color3.create(0.3, 1, 0.6), emissiveIntensity: 2 })
    const wall = engine.addEntity()
    Transform.create(wall, {
      position: Vector3.create(ARENA_CENTER.x + (along ? 0 : sign * (HALF + 0.5)), FLY_Y + 4, ARENA_CENTER.z + (along ? sign * (HALF + 0.5) : 0)),
      scale: along ? Vector3.create(GAME.fieldSize + 2, 12, 1) : Vector3.create(1, 12, GAME.fieldSize + 2)
    })
    MeshCollider.setBox(wall, ColliderLayer.CL_PHYSICS)
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4
    const ring = engine.addEntity()
    Transform.create(ring, {
      position: Vector3.create(ARENA_CENTER.x + Math.sin(a) * 14, ARENA_Y + 0.04, ARENA_CENTER.z + Math.cos(a) * 14),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(6, 6, 1)
    })
    MeshRenderer.setPlane(ring)
    Material.setPbrMaterial(ring, { albedoColor: Color4.create(0.13, 0.18, 0.08, 1), emissiveColor: Color3.create(0.08, 0.14, 0.05), emissiveIntensity: 1 })
  }

  // Invisible deck the player (saucer) hovers on.
  const deck = engine.addEntity()
  Transform.create(deck, { position: Vector3.create(ARENA_CENTER.x, FLY_Y - 0.1, ARENA_CENTER.z), scale: Vector3.create(ARENA_SIZE, 0.2, ARENA_SIZE) })
  MeshCollider.setBox(deck, ColliderLayer.CL_PHYSICS)

  // Up here you are a saucer: first person so nothing blocks the view of the field.
  const mods = engine.addEntity()
  Transform.create(mods, { position: Vector3.create(ARENA_CENTER.x, FLY_Y + 2, ARENA_CENTER.z) })
  AvatarModifierArea.create(mods, {
    area: Vector3.create(ARENA_SIZE + 4, 14, ARENA_SIZE + 4),
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_DISABLE_PASSPORTS],
    excludeIds: []
  })
  CameraModeArea.create(mods, { area: Vector3.create(ARENA_SIZE + 4, 14, ARENA_SIZE + 4), mode: CameraType.CT_FIRST_PERSON })

  const moon = engine.addEntity()
  Transform.create(moon, { position: Vector3.create(ARENA_CENTER.x, ARENA_Y + 30, ARENA_CENTER.z) })
  LightSource.create(moon, { active: true, color: Color3.create(0.6, 0.7, 1), intensity: 3000, range: 90, shadow: false, type: LightSource.Type.Point({}) })

  playerUfo = engine.addEntity()
  Transform.create(playerUfo, { position: Vector3.create(ARENA_CENTER.x, FLY_Y, ARENA_CENTER.z), scale: Vector3.create(1.6, 1.6, 1.6) })
  GltfContainer.create(playerUfo, { src: 'models/ufo.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  VisibilityComponent.create(playerUfo, { visible: false })

  playerBeam = engine.addEntity()
  Transform.create(playerBeam, { position: Vector3.create(ARENA_CENTER.x, ARENA_Y + BEAM_H / 2, ARENA_CENTER.z), scale: Vector3.Zero() })
  // (radiusBottom, radiusTop): wide where it meets the grass, narrow up at the saucer
  MeshRenderer.setCylinder(playerBeam, GAME.beamRadius, 0.6)
  Material.setPbrMaterial(playerBeam, {
    albedoColor: Color4.create(0.4, 1, 0.7, 0.3),
    emissiveColor: Color3.create(0.4, 1, 0.7),
    emissiveIntensity: 1.5,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  playerLight = engine.addEntity()
  Transform.create(playerLight, { position: Vector3.create(ARENA_CENTER.x, FLY_Y - 1, ARENA_CENTER.z), rotation: Quaternion.fromEulerDegrees(90, 0, 0) })
  LightSource.create(playerLight, {
    active: false,
    color: Color3.create(0.4, 1, 0.6),
    intensity: 1500,
    range: 24,
    shadow: false,
    type: LightSource.Type.Spot({ innerAngle: 25, outerAngle: 50 })
  })

  // Target ring on the grass (unit radius GLB: ring, ticks, centre dot), coloured by beam state.
  aimMarker = engine.addEntity()
  Transform.create(aimMarker, { position: Vector3.create(ARENA_CENTER.x, ARENA_Y + 0.08, ARENA_CENTER.z), scale: Vector3.create(GAME.beamRadius, 1, GAME.beamRadius) })
  GltfContainer.create(aimMarker, { src: 'models/marker.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  VisibilityComponent.create(aimMarker, { visible: false })
  tintMarker('ready')

  for (let i = 0; i < GAME.cowCount; i++) {
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.clone(ARENA_CENTER), scale: Vector3.create(COW_SCALE, COW_SCALE, COW_SCALE) })
    GltfContainer.create(entity, { src: 'models/cow.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    VisibilityComponent.create(entity, { visible: false })
    cows.push({ entity, enabled: false, state: 'gone', x: ARENA_CENTER.x, z: ARENA_CENTER.z, heading: 0, tx: 0, tz: 0, speed: 1.5, timer: 0, delay: 0, exposure: 0, lift: 0, bob: Math.random() * 6 })
  }
}

// ---------------------------------------------------------------------------
// Cows

function inField(x: number, z: number, margin = 1) {
  return Math.abs(x - ARENA_CENTER.x) <= HALF - margin && Math.abs(z - ARENA_CENTER.z) <= HALF - margin
}

/** A spawn point away from the saucer and outside a live beam, or null after bounded retries. */
function legalSpot(px: number, pz: number, minFromUfo = GAME.respawnMinFromUfo) {
  const beamLive = beam.state === 'charging' || beam.state === 'active'
  for (let i = 0; i < 24; i++) {
    const x = ARENA_CENTER.x + rand(-1, 1) * (HALF - 1.5)
    const z = ARENA_CENTER.z + rand(-1, 1) * (HALF - 1.5)
    if (dist2(x, z, px, pz) < minFromUfo * minFromUfo) continue
    if (beamLive && dist2(x, z, beam.x, beam.z) < (GAME.beamRadius + 1) ** 2) continue
    let crowded = false
    for (const other of cows) if (other.enabled && other.state !== 'gone' && dist2(x, z, other.x, other.z) < 4) crowded = true
    if (crowded) continue
    return { x, z }
  }
  return null
}

function placeCow(cow: GameCow, x: number, z: number) {
  cow.x = x
  cow.z = z
  cow.state = 'graze'
  cow.timer = rand(GAME.grazeMin, GAME.grazeMax)
  cow.heading = Math.random() * Math.PI * 2
  cow.exposure = 0
  cow.lift = 0
  cow.delay = 0
  const t = Transform.getMutable(cow.entity)
  t.position = Vector3.create(x, ARENA_Y, z)
  t.rotation = Quaternion.fromEulerDegrees(0, (cow.heading * 180) / Math.PI, 0)
  t.scale = Vector3.create(COW_SCALE, COW_SCALE, COW_SCALE)
  VisibilityComponent.createOrReplace(cow.entity, { visible: true })
}

function hideCow(cow: GameCow) {
  cow.state = 'gone'
  cow.exposure = 0
  VisibilityComponent.createOrReplace(cow.entity, { visible: false })
}

/** Put `count` cows on the field, the rest away. */
function resetField(px: number, pz: number, count: number) {
  for (let i = 0; i < cows.length; i++) {
    const cow = cows[i]
    cow.enabled = i < count
    hideCow(cow)
    if (!cow.enabled) continue
    const spot = legalSpot(px, pz, 6)
    if (spot) placeCow(cow, spot.x, spot.z)
    else cow.timer = 0.5 // retry from the respawn path
  }
}

function updateCow(cow: GameCow, dt: number, px: number, pz: number) {
  if (!cow.enabled) return
  const t = Transform.getMutable(cow.entity)
  switch (cow.state) {
    case 'gone': {
      cow.timer -= dt
      if (cow.timer <= 0) {
        const spot = legalSpot(px, pz)
        if (spot) placeCow(cow, spot.x, spot.z)
        else cow.timer = 0.4 // defer, try again shortly
      }
      return
    }
    case 'lifting': {
      cow.lift = Math.min(1, cow.lift + dt / GAME.liftSeconds)
      const k = easeInOut(cow.lift)
      t.position = Vector3.create(cow.x, ARENA_Y + k * (BEAM_H - 0.5), cow.z)
      t.rotation = Quaternion.fromEulerDegrees(k * 40, cow.bob * 90 + k * 540, k * 200)
      const s = COW_SCALE * (1 - k * 0.85)
      t.scale = Vector3.create(s, s, s)
      if (cow.lift >= 1) {
        hideCow(cow)
        cow.timer = GAME.respawnSeconds
      }
      return
    }
    case 'graze': {
      cow.timer -= dt
      if (cow.timer <= 0) {
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2
          const r = rand(2, GAME.wanderReach)
          const tx = cow.x + Math.sin(a) * r
          const tz = cow.z + Math.cos(a) * r
          if (inField(tx, tz)) {
            cow.tx = tx
            cow.tz = tz
            cow.speed = rand(GAME.wanderSpeedMin, GAME.wanderSpeedMax)
            cow.state = 'wander'
            cow.timer = GAME.stuckSeconds
            break
          }
        }
        if (cow.state === 'graze') cow.timer = 1
      }
      break
    }
    case 'wander': {
      cow.timer -= dt
      const dx = cow.tx - cow.x
      const dz = cow.tz - cow.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < 0.3 || cow.timer <= 0) {
        // arrived, or stuck for too long: graze (recovery never awards anything)
        cow.state = 'graze'
        cow.timer = rand(GAME.grazeMin, GAME.grazeMax)
        break
      }
      cow.heading = Math.atan2(dx, dz)
      moveCow(cow, cow.speed * dt)
      break
    }
    case 'startled': {
      if (cow.delay > 0) {
        cow.delay -= dt
        break
      }
      cow.timer -= dt
      if (cow.timer <= 0) {
        cow.state = 'graze'
        cow.timer = rand(GAME.grazeMin, GAME.grazeMax)
        break
      }
      // away from the beam footprint
      const dx = cow.x - beam.x
      const dz = cow.z - beam.z
      if (dx * dx + dz * dz > 0.01) cow.heading = Math.atan2(dx, dz)
      moveCow(cow, GAME.fleeSpeed * dt)
      break
    }
  }
  const moving = cow.state === 'wander' || (cow.state === 'startled' && cow.delay <= 0)
  cow.bob += dt * (cow.state === 'startled' ? 16 : moving ? 9 : 2)
  t.position = Vector3.create(cow.x, ARENA_Y + (moving ? Math.abs(Math.sin(cow.bob)) * 0.06 : 0), cow.z)
  t.rotation = Quaternion.fromEulerDegrees(0, (cow.heading * 180) / Math.PI, moving ? Math.sin(cow.bob) * 2 : 0)
}

function moveCow(cow: GameCow, step: number) {
  let nx = cow.x + Math.sin(cow.heading) * step
  let nz = cow.z + Math.cos(cow.heading) * step
  if (!inField(nx, nz)) {
    // slide along the fence
    nx = Math.max(ARENA_CENTER.x - HALF + 1, Math.min(ARENA_CENTER.x + HALF - 1, nx))
    nz = Math.max(ARENA_CENTER.z - HALF + 1, Math.min(ARENA_CENTER.z + HALF - 1, nz))
    if (cow.state === 'wander') cow.timer = Math.min(cow.timer, 0.5)
  }
  cow.x = nx
  cow.z = nz
}

// ---------------------------------------------------------------------------
// Beam

/**
 * Where the beam will land: the point on the pasture you are looking at, within range.
 * Looking level or up falls back to straight below the saucer.
 */
function aimPoint(px: number, pz: number) {
  const cam = Transform.getOrNull(engine.CameraEntity)
  let x = px
  let z = pz
  if (cam) {
    const fwd = Vector3.rotate(Vector3.Forward(), cam.rotation)
    if (fwd.y < -0.05) {
      const t = (ARENA_Y - cam.position.y) / fwd.y
      x = cam.position.x + fwd.x * t
      z = cam.position.z + fwd.z * t
    }
  }
  const dx = x - px
  const dz = z - pz
  const d = Math.sqrt(dx * dx + dz * dz)
  if (d > GAME.maxRange) {
    x = px + (dx / d) * GAME.maxRange
    z = pz + (dz / d) * GAME.maxRange
  }
  x = Math.max(ARENA_CENTER.x - HALF, Math.min(ARENA_CENTER.x + HALF, x))
  z = Math.max(ARENA_CENTER.z - HALF, Math.min(ARENA_CENTER.z + HALF, z))
  return { x, z }
}

function resetBeam() {
  beam.state = 'ready'
  beam.time = 0
  beam.locked = false
  hud.beam = 'ready'
  Transform.getMutable(playerBeam).scale = Vector3.Zero()
  for (const cow of cows) cow.exposure = 0
}

/** One press: freeze the target and start charging. Cows nearby get startled. */
function activateBeam(x: number, z: number, scored: boolean) {
  beam.state = 'charging'
  beam.time = 0
  beam.locked = false
  beam.x = x
  beam.z = z
  if (scored) run.attempts++
  for (const cow of cows) {
    cow.exposure = 0
    if (!cow.enabled || cow.state === 'gone' || cow.state === 'lifting') continue
    if (dist2(cow.x, cow.z, x, z) <= GAME.startleRadius ** 2) {
      cow.state = 'startled'
      cow.delay = GAME.startleDelay
      cow.timer = GAME.fleeSeconds
    }
  }
}

/** Returns true when a cow was locked this frame. */
function updateBeam(dt: number, scoring: boolean): boolean {
  let locked = false
  if (beam.state === 'ready') return false
  beam.time += dt
  if (beam.state === 'charging' && beam.time >= GAME.chargeSeconds) {
    beam.state = 'active'
    beam.time = 0
    for (const cow of cows) cow.exposure = 0
  } else if (beam.state === 'active') {
    // exposure: uninterrupted time with the cow's ground position inside the footprint
    const r2 = GAME.beamRadius ** 2
    let best: GameCow | null = null
    let bestD = Infinity
    for (const cow of cows) {
      if (!cow.enabled || cow.state === 'gone' || cow.state === 'lifting') continue
      const d = dist2(cow.x, cow.z, beam.x, beam.z)
      if (d <= r2) {
        cow.exposure += dt
        if (!beam.locked && cow.exposure >= GAME.exposureSeconds && d < bestD) {
          best = cow
          bestD = d
        }
      } else cow.exposure = 0
    }
    if (best && (!scoring || run.left > 0)) {
      beam.locked = true
      locked = true
      best.state = 'lifting'
      best.lift = 0
      best.exposure = 0
      if (scoring) {
        const points = Math.floor(GAME.catchPoints * run.multiplier)
        run.score += points
        run.cows++
        run.successes++
        run.multiplier = Math.min(GAME.comboCap, run.multiplier + GAME.comboStep)
        hud.score = run.score
        hud.cows = run.cows
        hud.combo = run.multiplier
      }
    }
    if (beam.time >= GAME.activeSeconds) {
      if (!beam.locked && scoring) {
        run.multiplier = 1
        hud.combo = 1
      }
      beam.state = 'cooldown'
      beam.time = 0
      for (const cow of cows) cow.exposure = 0
    }
  } else if (beam.state === 'cooldown' && beam.time >= GAME.cooldownSeconds) {
    beam.state = 'ready'
    beam.time = 0
  }
  hud.beam = beam.state
  return locked
}

/** Beam column, marker and spot light for the current beam state. */
function drawBeam(aim: { x: number; z: number }) {
  const frozen = beam.state === 'charging' || beam.state === 'active'
  const x = frozen ? beam.x : aim.x
  const z = frozen ? beam.z : aim.z
  const bt = Transform.getMutable(playerBeam)
  bt.position = Vector3.create(beam.x, ARENA_Y + BEAM_H / 2, beam.z)
  if (beam.state === 'charging') {
    const k = beam.time / GAME.chargeSeconds
    bt.scale = Vector3.create(0.15 + k * 0.5, BEAM_H, 0.15 + k * 0.5)
  } else if (beam.state === 'active') {
    bt.scale = Vector3.create(1, BEAM_H, 1)
  } else bt.scale = Vector3.Zero()

  const mt = Transform.getMutable(aimMarker)
  mt.position = Vector3.create(x, ARENA_Y + 0.08, z)
  mt.rotation = Quaternion.fromEulerDegrees(0, phaseTime * 90, 0)
  const pulse = beam.state === 'charging' ? 1 + Math.sin(beam.time * 40) * 0.08 : 1
  mt.scale = Vector3.create(GAME.beamRadius * pulse, 1, GAME.beamRadius * pulse)
  if (beam.state !== tintedState) tintMarker(beam.state)
  const lt = Transform.getMutable(playerLight)
  lt.position = Vector3.create(x, FLY_Y - 1, z)
}

const MARKER_COLOUR: Record<BeamState, Color3> = {
  ready: Color3.create(0.4, 1, 0.7),
  charging: Color3.create(1, 0.9, 0.4),
  active: Color3.create(0.5, 0.95, 1),
  cooldown: Color3.create(0.5, 0.5, 0.55)
}
let tintedState: BeamState | '' = ''

/** Recolour the marker GLB for the beam state (label in the HUD says the same thing). */
function tintMarker(state: BeamState) {
  tintedState = state
  const c = MARKER_COLOUR[state]
  const material = {
    material: {
      $case: 'pbr' as const,
      pbr: {
        albedoColor: Color4.create(c.r, c.g, c.b, state === 'cooldown' ? 0.5 : 0.85),
        emissiveColor: c,
        emissiveIntensity: state === 'cooldown' ? 1 : 3,
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
        castShadows: false
      }
    }
  }
  GltfNodeModifiers.createOrReplace(aimMarker, {
    modifiers: [
      { path: 'Ring', material, castShadows: false },
      { path: 'Dot', material, castShadows: false }
    ]
  })
}

// ---------------------------------------------------------------------------
// Round flow

function setInputLocked(locked: boolean) {
  if (locked === inputLocked) return
  inputLocked = locked
  if (locked) InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  else if (InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
}

function showArenaProps(visible: boolean) {
  VisibilityComponent.createOrReplace(playerUfo, { visible })
  VisibilityComponent.createOrReplace(aimMarker, { visible })
  LightSource.getMutable(playerLight).active = visible
}

function beginPractice(px: number, pz: number) {
  phase = 'practice'
  phaseTime = 0
  hud.mode = 'practice'
  hud.practiceDone = false
  hud.score = 0
  hud.cows = 0
  hud.combo = 1
  hud.countdown = ''
  resetBeam()
  showArenaProps(true)
  setInputLocked(false)
  // one tutorial cow, a short flight away
  resetField(px, pz, 1)
  const cow = cows[0]
  const a = Math.random() * Math.PI * 2
  const x = Math.max(ARENA_CENTER.x - HALF + 2, Math.min(ARENA_CENTER.x + HALF - 2, px + Math.sin(a) * 9))
  const z = Math.max(ARENA_CENTER.z - HALF + 2, Math.min(ARENA_CENTER.z + HALF - 2, pz + Math.cos(a) * 9))
  placeCow(cow, x, z)
}

function beginCountdown(px: number, pz: number) {
  runId++
  console.log(`[Cows] run ${runId} starting (ruleset ${RULESET})`)
  run.score = 0
  run.cows = 0
  run.attempts = 0
  run.successes = 0
  run.multiplier = 1
  run.left = GAME.roundSeconds
  phase = 'countdown'
  phaseTime = 0
  practiced = true
  hud.mode = 'countdown'
  hud.score = 0
  hud.cows = 0
  hud.combo = 1
  hud.secondsLeft = run.left
  hud.countdown = `${GAME.countdownSeconds}`
  resetBeam()
  showArenaProps(true)
  setInputLocked(true)
  resetField(px, pz, GAME.cowCount)
}

function finalizeRound() {
  phase = 'finalizing'
  phaseTime = 0
  run.left = 0
  hud.secondsLeft = 0
  hud.mode = 'finalizing'
  setInputLocked(true)
  // no new locks after the deadline: cancel an in-flight drop, let scored lifts finish
  if (beam.state === 'charging' || beam.state === 'active') {
    beam.state = 'cooldown'
    beam.time = 0
    for (const cow of cows) cow.exposure = 0
  }
}

function showResults() {
  phase = 'results'
  phaseTime = 0
  const isBest = run.score > sessionBest
  if (isBest) sessionBest = run.score
  updatePadSub()
  hud.results = {
    score: run.score,
    cows: run.cows,
    attempts: run.attempts,
    successes: run.successes,
    best: sessionBest,
    isBest,
    saved: run.cows > 0 ? 'sent to the board in the dome (community board, not verified)' : 'no cows caught, nothing sent to the board'
  }
  hud.mode = 'results'
  hud.countdown = ''
  Transform.getMutable(playerBeam).scale = Vector3.Zero()
  VisibilityComponent.createOrReplace(aimMarker, { visible: false })
  if (run.cows > 0) {
    room.send('scoreSubmit', { score: run.score, cows: run.cows, attempts: run.attempts, ruleset: RULESET, name: getPlayer()?.name || 'Visitor' })
  }
}

function returnToDome(message: string) {
  hud.mode = 'hidden'
  hud.countdown = ''
  hud.edge = false
  showArenaProps(false)
  for (const cow of cows) {
    cow.enabled = false
    hideCow(cow)
  }
  resetBeam()
  setInputLocked(false)
  void movePlayerTo({ newRelativePosition: Vector3.create(LANDING.x, 0.2, LANDING.z), cameraTarget: Vector3.create(CENTER.x, 3, CENTER.z) })
  if (message) toast(message, 8)
  phase = 'idle'
  phaseTime = 0
  setPadText('STAND HERE TO FLY')
}

// ---------------------------------------------------------------------------

function gameSystem(dt: number) {
  phaseTime += dt

  // --- pad hold and pickup ---------------------------------------------------
  if (phase === 'padHold') {
    const left = Math.ceil(PAD_HOLD - phaseTime)
    setPadText(onPad ? `HOLD STILL...  ${Math.max(1, left)}` : 'STAND HERE TO FLY')
    if (phaseTime >= PAD_HOLD) {
      phase = 'pickup'
      phaseTime = 0
      pickupMoved = false
      setPadText('')
      toast('They are coming for you.', 4)
    }
  }

  const progress = phase === 'padHold' ? Math.min(1, phaseTime / PAD_HOLD) : phase === 'pickup' ? 1 : 0
  const spin = phase === 'padHold' ? 40 + progress * 260 : phase === 'pickup' ? 360 : 40
  spinAngle += spin * dt
  for (let i = 0; i < padRings.length; i++) {
    const t = Transform.getMutable(padRings[i])
    t.rotation = Quaternion.fromEulerDegrees(0, spinAngle * (i % 2 === 0 ? 1 : -1), 0)
    const base = [1.6, 3.0, 4.4][i]
    t.position.y = base + Math.sin(spinAngle * 0.02 + i) * 0.15 + progress * (liftDown.y - 2 - base) * 0.6
  }
  const fillH = progress * (liftDown.y - 1.5)
  const fillT = Transform.getMutable(padFill)
  fillT.scale = progress > 0 ? Vector3.create(5.6, fillH, 5.6) : Vector3.Zero()
  fillT.position.y = 0.3 + fillH / 2
  const discM = Material.getMutable(padDisc)
  if (discM.material?.$case === 'pbr') discM.material.pbr.emissiveIntensity = 1.2 + progress * 3 + Math.sin(phaseTime * 3) * 0.3

  const ufoT = Transform.getMutable(liftUfo)
  const beamT = Transform.getMutable(liftBeam)
  if (phase === 'pickup') {
    const k = Math.min(1, phaseTime / 1.6)
    ufoT.position = Vector3.lerp(liftIdle, liftDown, easeInOut(k))
    const beamOn = phaseTime > 1.4
    beamT.scale = beamOn ? Vector3.create(1, liftDown.y, 1) : Vector3.Zero()
    LightSource.getMutable(liftLight).active = beamOn
    if (phaseTime > 1.8 && !pickupMoved) {
      pickupMoved = true
      void movePlayerTo({ newRelativePosition: Vector3.create(LAUNCH_PAD.x, liftDown.y - 2.5, LAUNCH_PAD.z), duration: 1.3 })
    }
    if (phaseTime > 3.4) {
      phase = 'arriving'
      phaseTime = 0
      beamT.scale = Vector3.Zero()
      LightSource.getMutable(liftLight).active = false
      void movePlayerTo({
        newRelativePosition: Vector3.create(ARENA_CENTER.x, FLY_Y + 0.5, ARENA_CENTER.z),
        cameraTarget: Vector3.create(ARENA_CENTER.x + 10, ARENA_Y, ARENA_CENTER.z + 10)
      })
    }
  } else {
    ufoT.position = Vector3.lerp(ufoT.position, Vector3.create(liftIdle.x + Math.sin(phaseTime * 0.4) * 2, liftIdle.y + Math.sin(phaseTime * 0.9) * 0.6, liftIdle.z), Math.min(1, dt * 1.5))
    beamT.scale = Vector3.Zero()
  }
  ufoT.rotation = Quaternion.fromEulerDegrees(Math.sin(phaseTime * 1.3) * 3, phaseTime * 35, Math.cos(phaseTime * 1.1) * 3)

  // --- up on the pasture ------------------------------------------------------
  if (phase === 'idle' || phase === 'padHold' || phase === 'pickup') return
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return
  const px = player.position.x
  const pz = player.position.z

  if (phase === 'arriving') {
    // The explorer takes a moment to apply movePlayerTo; nothing starts until we are up there.
    if (player.position.y > ARENA_Y + 2) {
      if (practiced) beginCountdown(px, pz)
      else beginPractice(px, pz)
    } else if (phaseTime > 8) {
      returnToDome('The saucer lost its grip. Try the pad again.')
    }
    return
  }

  // Left the pasture (fell, teleported, walked out): the run is abandoned, nothing is submitted.
  if (player.position.y < ARENA_Y - 2) {
    returnToDome('You slipped out of the saucer. The round does not count.')
    return
  }

  // Saucer under your feet; in first person you see its rim when you look down.
  const ut = Transform.getMutable(playerUfo)
  ut.position = Vector3.lerp(ut.position, Vector3.create(px, player.position.y - 2.2, pz), Math.min(1, dt * 12))
  ut.rotation = Quaternion.fromEulerDegrees(0, phaseTime * 60, 0)
  hud.edge = Math.abs(px - ARENA_CENTER.x) > HALF - 3 || Math.abs(pz - ARENA_CENTER.z) > HALF - 3

  const aim = aimPoint(px, pz)
  const pressed =
    inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN) || inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)

  if (phase === 'practice') {
    if (!hud.practiceDone && pressed && beam.state === 'ready') activateBeam(aim.x, aim.z, false)
    if (!hud.practiceDone && inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) {
      hud.onSkip()
      return
    }
    if (updateBeam(dt, false)) {
      hud.practiceDone = true
      phaseTime = 0
    }
    if (hud.practiceDone && phaseTime > 1.6) beginCountdown(px, pz)
  } else if (phase === 'countdown') {
    const left = GAME.countdownSeconds - phaseTime
    if (left > 0) hud.countdown = `${Math.ceil(left)}`
    else {
      phase = 'playing'
      phaseTime = 0
      hud.mode = 'playing'
      hud.countdown = 'GO!'
      setInputLocked(false)
    }
  } else if (phase === 'playing') {
    if (phaseTime > 0.8) hud.countdown = ''
    run.left -= dt
    hud.secondsLeft = run.left
    if (pressed && beam.state === 'ready' && run.left > 0) activateBeam(aim.x, aim.z, true)
    updateBeam(dt, true)
    if (run.left <= 0) finalizeRound()
  } else if (phase === 'finalizing') {
    updateBeam(dt, true)
    if (phaseTime > 1.2) showResults()
  } else if (phase === 'results') {
    updateBeam(dt, false)
    // keyboard versions of the two buttons, for when the cursor is locked in first person
    if (phaseTime > 0.5 && inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) hud.onReplay()
    else if (phaseTime > 0.5 && inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)) hud.onExit()
    else if (phaseTime > 60) returnToDome(`You scored ${run.score} with ${run.cows} cow${run.cows === 1 ? '' : 's'}. They appear to be enjoying it.`)
  }

  drawBeam(aim)
  for (const cow of cows) updateCow(cow, dt, px, pz)
}

// ---------------------------------------------------------------------------
// Leaderboard panel in the dome

function createLeaderboard() {
  // Plane/Text fronts face local -Z, so turn that side toward the launch pad.
  const yaw = (Math.atan2(LAUNCH_PAD.x - LEADERBOARD.x, LAUNCH_PAD.z - LEADERBOARD.z) * 180) / Math.PI + 180
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.clone(LEADERBOARD), rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })

  const panel = engine.addEntity()
  Transform.create(panel, { parent: root, position: Vector3.create(0, 5.25, 0), scale: Vector3.create(8, 10.5, 0.2) })
  MeshRenderer.setPlane(panel)
  MeshCollider.setBox(panel, ColliderLayer.CL_PHYSICS)
  Material.setBasicMaterial(panel, {
    texture: Material.Texture.Common({
      src: 'images/cow-catchers-scoreboard.jpg',
      wrapMode: TextureWrapMode.TWM_CLAMP,
      filterMode: TextureFilterMode.TFM_BILINEAR
    }),
    diffuseColor: Color4.White(),
    castShadows: false
  })

  boardText = engine.addEntity()
  Transform.create(boardText, { parent: root, position: Vector3.create(0, 4.4, -0.08) })
  TextShape.create(boardText, {
    text: 'no rounds yet\nstand on the pad',
    fontSize: 1.8,
    font: Font.F_SANS_SERIF,
    textColor: Color4.White(),
    outlineColor: Color4.Black(),
    outlineWidth: 0.12,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    lineSpacing: 12
  })
  const note = engine.addEntity()
  Transform.create(note, { parent: root, position: Vector3.create(0, 0.9, -0.08) })
  TextShape.create(note, {
    text: 'best round per visitor  ·  community board',
    fontSize: 1,
    font: Font.F_SANS_SERIF,
    textColor: Color4.create(0.65, 0.9, 1, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.1,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  room.onMessage('leaderboard', (data) => {
    const lines = data.entries.map((e, i) => `${i + 1}.  ${e.name}   ${e.score}   (${e.cows} cow${e.cows === 1 ? '' : 's'})`)
    TextShape.getMutable(boardText).text = lines.length ? lines.join('\n') : 'no rounds yet\nstand on the pad'
  })
  room.send('leaderboardGet', { v: 1 })
}

export function createCowGame() {
  hud.onSkip = () => {
    if (phase !== 'practice') return
    const player = Transform.getOrNull(engine.PlayerEntity)
    beginCountdown(player?.position.x ?? ARENA_CENTER.x, player?.position.z ?? ARENA_CENTER.z)
  }
  hud.onReplay = () => {
    if (phase !== 'results') return
    const player = Transform.getOrNull(engine.PlayerEntity)
    beginCountdown(player?.position.x ?? ARENA_CENTER.x, player?.position.z ?? ARENA_CENTER.z)
  }
  hud.onExit = () => {
    if (phase !== 'results') return
    returnToDome(`You scored ${run.score} with ${run.cows} cow${run.cows === 1 ? '' : 's'}. They appear to be enjoying it.`)
  }
  createLaunchPad()
  createArena()
  createLeaderboard()
  engine.addSystem(gameSystem)
}
