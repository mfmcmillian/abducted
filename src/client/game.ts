import {
  AvatarModifierArea,
  AvatarShape,
  Billboard,
  BillboardMode,
  AvatarModifierType,
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
import { moo, playAt, playGlobal, SFX } from './sfx'
import { movePlayerTo } from '~system/RestrictedActions'
import { ARENA_FLY_HEIGHT, ARENA_SIZE, ARENA_Y, CENTER, LANDING, LAUNCH_PAD, LEADERBOARD } from '../layout'
import { GAME, RULESET } from '../shared/gameConfig'
import { room } from '../shared/messages'
import { hud, toast, type BeamState } from './ui'
import { FLOOR_Y, ROOT, sceneToWorld } from './root'
import { t } from './i18n'
import { PANE_H, PANE_W, PANE_Y, paneMount } from './pane'
import { createPod, launchPod, POD_CHARGE_SECONDS, releasePod, sealPod } from './pod'

/**
 * The cow game (TheCowCatchingGame PRD v1.0, P0).
 *
 * The dome is the lobby: step into the abduction pod (pod.ts). It seals behind you, the
 * ship counts you down and transfers you to the sky pasture above the dome. Up there you ARE
 * the saucer (first person, saucer under your feet). First visit gets a practice cow with
 * no clock; then 3-2-1-GO and a 180 second round. The beam is a committed drop:
 * Ready -> Charging -> Active -> Cooldown. A cow has to sit in the footprint for a
 * moment to be locked; one cow per drop; 100 points with a combo multiplier that a miss
 * resets. Results, play again or back down to the dome.
 */

type Phase = 'idle' | 'pickup' | 'arriving' | 'practice' | 'countdown' | 'playing' | 'finalizing' | 'results'

const HALF = GAME.fieldSize / 2
const ARENA_CENTER = Vector3.create(CENTER.x, ARENA_Y, CENTER.z)
const FLY_Y = ARENA_Y + ARENA_FLY_HEIGHT
const BEAM_TOP = FLY_Y - 1.5
const BEAM_H = BEAM_TOP - ARENA_Y
const COW_SCALE = 1.6

let phase: Phase = 'idle'
let phaseTime = 0
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

let playerUfo: Entity
let playerBeam: Entity
let playerLight: Entity
let aimMarker: Entity

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
  createPod(() => {
    if (phase !== 'idle') return
    phase = 'pickup'
    phaseTime = 0
    setInputLocked(true)
    sealPod()
  })

  // Giant pink 3D "PLAY ME! / STAND HERE" above the pod (models/text-play.glb, tools/build-text.mjs).
  const PLAY_SCALE = 2.6
  const sign = engine.addEntity()
  Transform.create(sign, { parent: ROOT,
    position: Vector3.create(LAUNCH_PAD.x, 13.5, LAUNCH_PAD.z),
    scale: Vector3.create(PLAY_SCALE, PLAY_SCALE, PLAY_SCALE)
  })
  GltfContainer.create(sign, { src: 'models/text-play.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  Billboard.create(sign, { billboardMode: BillboardMode.BM_Y })
  const signLight = engine.addEntity()
  Transform.create(signLight, { parent: ROOT, position: Vector3.create(LAUNCH_PAD.x, 7.5, LAUNCH_PAD.z) })
  LightSource.create(signLight, { active: true, color: Color3.create(1, 0.35, 0.8), intensity: 200, range: 14, shadow: false, type: LightSource.Type.Point({}) })
  let signClock = 0
  engine.addSystem((dt) => {
    signClock += dt
    const glow = 0.5 + Math.sin(signClock * 3) * 0.5
    const s = PLAY_SCALE * (1 + glow * 0.04)
    const t = Transform.getMutable(sign)
    t.scale = Vector3.create(s, s, s)
    t.position.y = 13.5 + Math.sin(signClock * 0.9) * 0.25
    LightSource.getMutable(signLight).intensity = 130 + glow * 140
  })
}

// ---------------------------------------------------------------------------
// Sky pasture

const BASE_AVATAR = 'urn:decentraland:off-chain:base-avatars'
/** Antrom AFK Butcher suit (L1) and "Pitchfork on hand". */
const BUTCHER_SUIT = 'urn:decentraland:matic:collections-v2:0xf676c2e2768f415a10fa1703a5100141084f63b5:0'
const PITCHFORK = 'urn:decentraland:matic:collections-v2:0x877204ffac50cc2028c97e91a54f93c531d8234b:0'
const FARMER_NAMES = ['Old Gus', 'Marge', 'Clem', 'Bessie-Ann', 'Pa Hollis', 'Dottie', 'Rufus', 'Earl']
const ANGRY = ['fistpump', 'handsair', 'headexplode', 'shrug', 'dontsee', 'fistpump']
const farmers: { avatar: Entity; next: number; emote: number }[] = []

/**
 * Dress the pasture: angry farmers with pitchforks along the fence, a graveyard corner,
 * pumpkin patches, hay bales and a few lanterns. Pure set dressing, no colliders, so it
 * never gets in the way of the saucer or the beam.
 */
function createArenaDressing() {
  const prop = (model: string, dx: number, dz: number, rot: number, scale: number) => {
    const e = engine.addEntity()
    Transform.create(e, { parent: ROOT,
      position: Vector3.create(ARENA_CENTER.x + dx, ARENA_Y, ARENA_CENTER.z + dz),
      rotation: Quaternion.fromEulerDegrees(0, rot, 0),
      scale: Vector3.create(scale, scale, scale)
    })
    GltfContainer.create(e, { src: model, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    return e
  }
  const bale = (dx: number, dz: number, rot: number, tipped = false) => {
    const e = engine.addEntity()
    Transform.create(e, { parent: ROOT,
      position: Vector3.create(ARENA_CENTER.x + dx, ARENA_Y + (tipped ? 0.75 : 0.6), ARENA_CENTER.z + dz),
      rotation: tipped ? Quaternion.fromEulerDegrees(0, rot, 90) : Quaternion.fromEulerDegrees(0, rot, 0),
      scale: Vector3.create(1.5, 1.2, 1.5)
    })
    MeshRenderer.setCylinder(e, 1, 1)
    Material.setPbrMaterial(e, { albedoColor: Color4.create(0.55, 0.42, 0.14, 1), emissiveColor: Color3.create(0.12, 0.08, 0.02), emissiveIntensity: 1, roughness: 1, metallic: 0 })
  }
  const lantern = (dx: number, dz: number) => {
    const post = engine.addEntity()
    Transform.create(post, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x + dx, ARENA_Y + 1.6, ARENA_CENTER.z + dz), scale: Vector3.create(0.14, 3.2, 0.14) })
    MeshRenderer.setBox(post)
    Material.setPbrMaterial(post, { albedoColor: Color4.create(0.12, 0.08, 0.05, 1), roughness: 1 })
    const bulb = engine.addEntity()
    Transform.create(bulb, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x + dx, ARENA_Y + 3.3, ARENA_CENTER.z + dz), scale: Vector3.create(0.45, 0.45, 0.45) })
    MeshRenderer.setSphere(bulb)
    Material.setPbrMaterial(bulb, { albedoColor: Color4.create(1, 0.6, 0.2, 1), emissiveColor: Color3.create(1, 0.55, 0.15), emissiveIntensity: 3 })
    const light = engine.addEntity()
    Transform.create(light, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x + dx, ARENA_Y + 3.2, ARENA_CENTER.z + dz) })
    LightSource.create(light, { active: true, color: Color3.create(1, 0.6, 0.25), intensity: 400, range: 12, shadow: false, type: LightSource.Type.Point({}) })
  }

  // Graveyard in the north-west corner, just outside the fence.
  const g = HALF + 5
  const graves: Array<[number, number, number]> = [
    [-g - 6, g + 2, 95], [-g - 2, g + 5, 80], [-g + 2, g + 1, 100], [-g - 8, g + 7, 70],
    [-g - 3, g + 10, 85], [-g + 4, g + 6, 110], [-g - 10, g + 12, 90], [-g + 1, g + 12, 75]
  ]
  for (const [x, z, r] of graves) prop('models/grave.glb', x, z, r, 2)
  lantern(-g - 5, g + 6)

  // Pumpkin patches: one spilling in from the south-east corner, one along the east fence.
  const patches: Array<[number, number]> = [
    [HALF - 4, -HALF + 3], [HALF - 2, -HALF + 6], [HALF - 6, -HALF + 1], [HALF - 1, -HALF + 1], [HALF - 8, -HALF + 4], [HALF - 3, -HALF + 9],
    [HALF + 3, -HALF - 2], [HALF + 6, -HALF + 1], [HALF + 2, -HALF - 6],
    [HALF + 4, 8], [HALF + 7, 11], [HALF + 3, 14], [HALF + 6, 5]
  ]
  patches.forEach(([x, z], i) => prop('models/pumpkin.glb', x, z, (i * 73) % 360, 1.6 + ((i * 7) % 5) * 0.22))
  lantern(HALF + 5, -HALF - 4)

  // Hay bales stacked by the north fence and a few tumbled in the field.
  bale(-6, HALF + 4, 20)
  bale(-3.6, HALF + 4, 95)
  bale(-4.8, HALF + 4, 60, true)
  bale(4, HALF + 5, 15)
  bale(-HALF + 6, -8, 40, true)
  bale(10, HALF - 7, 75)
  bale(-12, -HALF + 5, 10)
  lantern(0, HALF + 7)
  lantern(-HALF - 4, 0)

  // Angry farmers along the fence, shaking pitchforks at the sky.
  for (let i = 0; i < FARMER_NAMES.length; i++) {
    const side = i % 4
    const along = ((i >> 2) === 0 ? -1 : 1) * (HALF * 0.45) + ((i * 37) % 7) - 3
    const out = HALF + 2.2 + (i % 3) * 0.6
    const dx = side === 0 ? along : side === 1 ? out : side === 2 ? along : -out
    const dz = side === 0 ? out : side === 1 ? along : side === 2 ? -out : along
    const avatar = engine.addEntity()
    Transform.create(avatar, { parent: ROOT,
      position: Vector3.create(ARENA_CENTER.x + dx, ARENA_Y, ARENA_CENTER.z + dz),
      rotation: Quaternion.fromEulerDegrees(0, (Math.atan2(-dx, -dz) * 180) / Math.PI, 0)
    })
    AvatarShape.create(avatar, {
      id: `farmer-${i}`,
      name: FARMER_NAMES[i],
      bodyShape: `${BASE_AVATAR}:${i % 3 === 1 ? 'BaseFemale' : 'BaseMale'}`,
      wearables: [BUTCHER_SUIT, PITCHFORK, `${BASE_AVATAR}:eyes_00`, `${BASE_AVATAR}:eyebrows_00`, `${BASE_AVATAR}:mouth_00`],
      emotes: [],
      skinColor: { r: 0.85, g: 0.65, b: 0.5 },
      hairColor: { r: 0.3, g: 0.2, b: 0.1 },
      eyeColor: { r: 0.3, g: 0.2, b: 0.1 },
      expressionTriggerId: ANGRY[i % ANGRY.length],
      expressionTriggerTimestamp: Date.now()
    })
    farmers.push({ avatar, next: 3 + i * 0.9, emote: i })
  }
  engine.addSystem((dt) => {
    for (const f of farmers) {
      f.next -= dt
      if (f.next > 0) continue
      f.emote = (f.emote + 1) % ANGRY.length
      f.next = 5 + Math.random() * 4
      const shape = AvatarShape.getMutable(f.avatar)
      shape.expressionTriggerId = ANGRY[f.emote]
      shape.expressionTriggerTimestamp = Date.now()
    }
  })
}

function createArena() {
  const pasture = engine.addEntity()
  Transform.create(pasture, { parent: ROOT, position: Vector3.clone(ARENA_CENTER), rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(ARENA_SIZE, ARENA_SIZE, 1) })
  MeshRenderer.setPlane(pasture)
  Material.setPbrMaterial(pasture, { albedoColor: Color4.create(0.07, 0.14, 0.07, 1), emissiveColor: Color3.create(0.02, 0.05, 0.02), emissiveIntensity: 1, roughness: 1 })

  // The playable field: brighter grass, glowing fence line, and invisible walls so the
  // saucer slides along the edge instead of leaving.
  const field = engine.addEntity()
  Transform.create(field, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x, ARENA_Y + 0.02, ARENA_CENTER.z), rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(GAME.fieldSize, GAME.fieldSize, 1) })
  MeshRenderer.setPlane(field)
  Material.setPbrMaterial(field, { albedoColor: Color4.create(0.1, 0.2, 0.09, 1), emissiveColor: Color3.create(0.03, 0.08, 0.03), emissiveIntensity: 1, roughness: 1 })
  for (let i = 0; i < 4; i++) {
    const along = i < 2
    const sign = i % 2 === 0 ? -1 : 1
    const edge = engine.addEntity()
    Transform.create(edge, { parent: ROOT,
      position: Vector3.create(ARENA_CENTER.x + (along ? 0 : sign * HALF), ARENA_Y + 0.3, ARENA_CENTER.z + (along ? sign * HALF : 0)),
      scale: along ? Vector3.create(GAME.fieldSize + 0.4, 0.6, 0.25) : Vector3.create(0.25, 0.6, GAME.fieldSize + 0.4)
    })
    MeshRenderer.setBox(edge)
    Material.setPbrMaterial(edge, { albedoColor: Color4.create(0.1, 0.3, 0.2, 1), emissiveColor: Color3.create(0.3, 1, 0.6), emissiveIntensity: 2 })
    const wall = engine.addEntity()
    Transform.create(wall, { parent: ROOT,
      position: Vector3.create(ARENA_CENTER.x + (along ? 0 : sign * (HALF + 0.5)), FLY_Y + 4, ARENA_CENTER.z + (along ? sign * (HALF + 0.5) : 0)),
      scale: along ? Vector3.create(GAME.fieldSize + 2, 12, 1) : Vector3.create(1, 12, GAME.fieldSize + 2)
    })
    MeshCollider.setBox(wall, ColliderLayer.CL_PHYSICS)
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4
    const ring = engine.addEntity()
    Transform.create(ring, { parent: ROOT,
      position: Vector3.create(ARENA_CENTER.x + Math.sin(a) * 14, ARENA_Y + 0.04, ARENA_CENTER.z + Math.cos(a) * 14),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(6, 6, 1)
    })
    MeshRenderer.setPlane(ring)
    Material.setPbrMaterial(ring, { albedoColor: Color4.create(0.13, 0.18, 0.08, 1), emissiveColor: Color3.create(0.08, 0.14, 0.05), emissiveIntensity: 1 })
  }

  // Invisible deck the player (saucer) hovers on.
  const deck = engine.addEntity()
  Transform.create(deck, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x, FLY_Y - 0.1, ARENA_CENTER.z), scale: Vector3.create(ARENA_SIZE, 0.2, ARENA_SIZE) })
  MeshCollider.setBox(deck, ColliderLayer.CL_PHYSICS)

  // Up here you are a saucer: first person so nothing blocks the view of the field.
  const mods = engine.addEntity()
  // Covers the whole pasture volume, from below the grass to well above flying height, so
  // other players are hidden whether they are flying, landing or standing on the field.
  Transform.create(mods, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x, ARENA_Y + 14, ARENA_CENTER.z) })
  AvatarModifierArea.create(mods, {
    area: Vector3.create(ARENA_SIZE + 4, 44, ARENA_SIZE + 4),
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_DISABLE_PASSPORTS],
    excludeIds: []
  })
  CameraModeArea.create(mods, { area: Vector3.create(ARENA_SIZE + 4, 44, ARENA_SIZE + 4), mode: CameraType.CT_FIRST_PERSON })

  const moon = engine.addEntity()
  Transform.create(moon, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x, ARENA_Y + 30, ARENA_CENTER.z) })
  LightSource.create(moon, { active: true, color: Color3.create(0.6, 0.7, 1), intensity: 3000, range: 90, shadow: false, type: LightSource.Type.Point({}) })

  playerUfo = engine.addEntity()
  Transform.create(playerUfo, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x, FLY_Y, ARENA_CENTER.z), scale: Vector3.create(1.6, 1.6, 1.6) })
  GltfContainer.create(playerUfo, { src: 'models/ufo.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  VisibilityComponent.create(playerUfo, { visible: false })

  playerBeam = engine.addEntity()
  Transform.create(playerBeam, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x, ARENA_Y + BEAM_H / 2, ARENA_CENTER.z), scale: Vector3.Zero() })
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
  Transform.create(playerLight, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x, FLY_Y - 1, ARENA_CENTER.z), rotation: Quaternion.fromEulerDegrees(90, 0, 0) })
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
  Transform.create(aimMarker, { parent: ROOT, position: Vector3.create(ARENA_CENTER.x, ARENA_Y + 0.08, ARENA_CENTER.z), scale: Vector3.create(GAME.beamRadius, 1, GAME.beamRadius) })
  GltfContainer.create(aimMarker, { src: 'models/marker.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  VisibilityComponent.create(aimMarker, { visible: false })
  tintMarker('ready')

  for (let i = 0; i < GAME.cowCount; i++) {
    const entity = engine.addEntity()
    Transform.create(entity, { parent: ROOT, position: Vector3.clone(ARENA_CENTER), scale: Vector3.create(COW_SCALE, COW_SCALE, COW_SCALE) })
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
      const t = (ARENA_Y - (cam.position.y - FLOOR_Y)) / fwd.y
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
  playGlobal(SFX.beamCharge, 0.8)
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
      moo(Vector3.create(best.x, ARENA_Y + 1, best.z), 1)
      playGlobal(SFX.catch, 1)
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
      if (!beam.locked) playGlobal(SFX.miss, 0.7)
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
  banked = false
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
  playGlobal(SFX.roundEnd, 0.9)
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
  hud.results = {
    score: run.score,
    cows: run.cows,
    attempts: run.attempts,
    successes: run.successes,
    best: sessionBest,
    isBest,
    saved:
      run.cows > 0
        ? run.cows === 1
          ? t('1 cow beamed into the CARGO BAY. Carry it to the COW LAUNCHER for kudos.')
          : t('{0} cows beamed into the CARGO BAY. Carry them to the COW LAUNCHER for kudos.', run.cows)
        : t('no cows caught: nothing for the cargo bay this time')
  }
  hud.mode = 'results'
  hud.countdown = ''
  Transform.getMutable(playerBeam).scale = Vector3.Zero()
  VisibilityComponent.createOrReplace(aimMarker, { visible: false })
  bankCows()
}

let banked = false
/** Send the round to the server once: every caught cow lands in the cargo bay, even if we leave early. */
function bankCows() {
  if (banked || run.cows <= 0) return
  banked = true
  room.send('scoreSubmit', { score: run.score, cows: run.cows, attempts: run.attempts, ruleset: RULESET, name: getPlayer()?.name || 'Visitor' })
}

/** The line for leaving mid-round: what made it to the cargo bay. */
function leaveMessage(fallback: string) {
  if (run.cows <= 0 || banked) return fallback
  return run.cows === 1
    ? t('1 cow beamed into the CARGO BAY. Carry it to the COW LAUNCHER for kudos.')
    : t('{0} cows beamed into the CARGO BAY. Carry them to the COW LAUNCHER for kudos.', run.cows)
}

function scoreMessage() {
  return run.cows === 1 ? t('You scored {0} with 1 cow. It appears to be enjoying it.', run.score) : t('You scored {0} with {1} cows. They appear to be enjoying it.', run.score, run.cows)
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
  releasePod()
  void movePlayerTo({ newRelativePosition: sceneToWorld(Vector3.create(LANDING.x, 0.2, LANDING.z)), cameraTarget: sceneToWorld(Vector3.create(CENTER.x, 3, CENTER.z)) })
  if (message) toast(message, 8)
  phase = 'idle'
  phaseTime = 0
}

// ---------------------------------------------------------------------------

function gameSystem(dt: number) {
  phaseTime += dt

  // --- sealed in the pod, charging, then transferred --------------------------
  if (phase === 'pickup' && phaseTime >= POD_CHARGE_SECONDS) {
    phase = 'arriving'
    phaseTime = 0
    launchPod()
    setInputLocked(false)
    void movePlayerTo({
      newRelativePosition: sceneToWorld(Vector3.create(ARENA_CENTER.x, FLY_Y + 0.5, ARENA_CENTER.z)),
      cameraTarget: sceneToWorld(Vector3.create(ARENA_CENTER.x + 10, ARENA_Y, ARENA_CENTER.z + 10))
    })
  }

  // --- up on the pasture ------------------------------------------------------
  if (phase === 'idle' || phase === 'pickup') return
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return
  const px = player.position.x
  const pz = player.position.z

  if (phase === 'arriving') {
    // The explorer takes a moment to apply movePlayerTo; nothing starts until we are up there.
    if (player.position.y - FLOOR_Y > ARENA_Y + 2) {
      if (practiced) beginCountdown(px, pz)
      else beginPractice(px, pz)
    } else if (phaseTime > 8) {
      returnToDome(t('The transfer failed. Step into the pod again.'))
    }
    return
  }

  // Left the pasture (fell, teleported, walked out): the run is abandoned, nothing is submitted.
  if (player.position.y - FLOOR_Y < ARENA_Y - 2) {
    const msg = leaveMessage(t('You slipped out of the saucer. The round does not count.'))
    bankCows()
    returnToDome(msg)
    return
  }

  // Saucer under your feet; in first person you see its rim when you look down.
  const ut = Transform.getMutable(playerUfo)
  ut.position = Vector3.lerp(ut.position, Vector3.create(px, player.position.y - FLOOR_Y - 2.2, pz), Math.min(1, dt * 12))
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
      playGlobal(SFX.roundStart, 0.9)
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
    else if (phaseTime > 60) returnToDome(scoreMessage())
  }

  drawBeam(aim)
  for (const cow of cows) updateCow(cow, dt, px, pz)
}

// ---------------------------------------------------------------------------
// Leaderboard panel in the dome

function createLeaderboard() {
  // Mounted on the window pane behind LEADERBOARD, filling it. The board was laid out at
  // 10.5 x 13.5 m, so the whole root is scaled down to the pane and lifted so the panel's
  // centre lands at the pane's centre.
  const BOARD_W = 10.5
  const BOARD_H = 13.5
  const k = Math.min(PANE_W / BOARD_W, PANE_H / BOARD_H)
  const mount = paneMount(LEADERBOARD)
  const root = engine.addEntity()
  Transform.create(root, {
    parent: ROOT,
    position: Vector3.create(mount.position.x, PANE_Y - (BOARD_H / 2) * k, mount.position.z),
    rotation: mount.rotation,
    scale: Vector3.create(k, k, k)
  })

  const panel = engine.addEntity()
  Transform.create(panel, { parent: root, position: Vector3.create(0, BOARD_H / 2, 0), scale: Vector3.create(BOARD_W, BOARD_H, 0.2) })
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

  const makeText = (x: number, y: number, text: string, align: TextAlignMode, size: number, color: Color4, font = Font.F_MONOSPACE) => {
    const entity = engine.addEntity()
    Transform.create(entity, { parent: root, position: Vector3.create(x, y, -0.1) })
    TextShape.create(entity, {
      text,
      fontSize: size,
      font,
      textColor: color,
      outlineColor: Color4.Black(),
      outlineWidth: 0.13,
      textAlign: align
    })
    return entity
  }

  const headerColor = Color4.create(0.4, 0.95, 1, 1)
  makeText(-4.35, 9.15, t('RANK'), TextAlignMode.TAM_MIDDLE_LEFT, 1.05, headerColor)
  makeText(-3.15, 9.15, t('PILOT'), TextAlignMode.TAM_MIDDLE_LEFT, 1.05, headerColor)
  makeText(2.65, 9.15, t('SCORE'), TextAlignMode.TAM_MIDDLE_RIGHT, 1.05, headerColor)
  makeText(4.35, 9.15, t('COWS'), TextAlignMode.TAM_MIDDLE_RIGHT, 1.05, headerColor)

  const rankColors = [
    Color4.create(1, 0.82, 0.25, 1),
    Color4.create(0.82, 0.9, 1, 1),
    Color4.create(0.9, 0.56, 0.28, 1)
  ]
  const rows: Array<{ rank: Entity; name: Entity; score: Entity; cows: Entity }> = []
  for (let i = 0; i < 10; i++) {
    const y = 8.35 - i * 0.72
    const strip = engine.addEntity()
    Transform.create(strip, { parent: root, position: Vector3.create(0, y, -0.055), scale: Vector3.create(9.2, 0.58, 0.025) })
    MeshRenderer.setBox(strip)
    const stripColor =
      i === 0
        ? Color4.create(0.8, 0.58, 0.08, 0.2)
        : i === 1
          ? Color4.create(0.45, 0.65, 0.8, 0.15)
          : i === 2
            ? Color4.create(0.72, 0.34, 0.12, 0.16)
            : Color4.create(0.04, 0.3, 0.38, i % 2 === 0 ? 0.1 : 0.055)
    Material.setPbrMaterial(strip, {
      albedoColor: stripColor,
      emissiveColor: Color3.create(stripColor.r, stripColor.g, stripColor.b),
      emissiveIntensity: i < 3 ? 0.8 : 0.25,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false
    })
    const rowColor = rankColors[i] ?? Color4.White()
    rows.push({
      rank: makeText(-4.2, y, '', TextAlignMode.TAM_MIDDLE_LEFT, 1.15, rowColor),
      name: makeText(-3.15, y, '', TextAlignMode.TAM_MIDDLE_LEFT, 1.08, rowColor),
      score: makeText(2.65, y, '', TextAlignMode.TAM_MIDDLE_RIGHT, 1.15, rowColor),
      cows: makeText(4.25, y, '', TextAlignMode.TAM_MIDDLE_RIGHT, 1.1, rowColor)
    })
  }

  const note = engine.addEntity()
  Transform.create(note, { parent: root, position: Vector3.create(0, 0.72, -0.1) })
  TextShape.create(note, {
    text: t('BEST ROUND PER PILOT  ·  CURRENT RULESET  ·  COMMUNITY BOARD'),
    fontSize: 0.85,
    font: Font.F_SANS_SERIF,
    textColor: Color4.create(0.65, 0.9, 1, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.1,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  room.onMessage('leaderboard', (data) => {
    for (let i = 0; i < rows.length; i++) {
      const entry = data.entries[i]
      TextShape.getMutable(rows[i].rank).text = entry ? (i < 3 ? ['1ST', '2ND', '3RD'][i] : `${i + 1}TH`) : ''
      TextShape.getMutable(rows[i].name).text = entry ? entry.name.toUpperCase().slice(0, 18) : i === 0 ? t('NO SCORES YET — ENTER THE UFO BEAM') : ''
      TextShape.getMutable(rows[i].score).text = entry ? entry.score.toLocaleString() : ''
      TextShape.getMutable(rows[i].cows).text = entry ? `${entry.cows}` : ''
    }
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
    playGlobal(SFX.uiClick, 0.8)
    const player = Transform.getOrNull(engine.PlayerEntity)
    beginCountdown(player?.position.x ?? ARENA_CENTER.x, player?.position.z ?? ARENA_CENTER.z)
  }
  hud.onExit = () => {
    if (phase !== 'results') return
    returnToDome(scoreMessage())
  }
  hud.onLeave = () => {
    if (phase !== 'practice' && phase !== 'countdown' && phase !== 'playing' && phase !== 'finalizing') return
    playGlobal(SFX.uiClick, 0.8)
    const msg = leaveMessage(t('Back on the ground. The cows will be waiting.'))
    bankCows()
    returnToDome(msg)
  }
  createLaunchPad()
  createArena()
  createArenaDressing()
  createLeaderboard()
  engine.addSystem(gameSystem)
}
