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
  InputAction,
  inputSystem,
  LightSource,
  Material,
  MaterialTransparencyMode,
  MeshCollider,
  MeshRenderer,
  PointerEventType,
  TextAlignMode,
  TextShape,
  Transform,
  TriggerArea,
  triggerAreaEventsSystem,
  VisibilityComponent
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'
import { ARENA_FLY_HEIGHT, ARENA_SIZE, ARENA_Y, CENTER, LANDING, LAUNCH_PAD, LEADERBOARD, ROUND_SECONDS } from '../layout'
import { room } from '../shared/messages'
import { hud, toast } from './ui'

/**
 * The cow game. Stand on the launch pad for three seconds and a saucer comes down,
 * beams you up and drops you on the sky pasture above the dome, where you ARE the
 * saucer: hover over cows and drop the beam. Three minutes, then you are returned
 * to the dome and your score goes on the board.
 */

type Phase = 'idle' | 'countdown' | 'pickup' | 'playing' | 'over'

const COUNTDOWN = 3
const COW_COUNT = 18
const CATCH_RADIUS = 4.2
const BEAM_COOLDOWN = 1.0
const FLEE_RADIUS = 9
const EDGE = ARENA_SIZE / 2 - 4
const ARENA_CENTER = Vector3.create(CENTER.x, ARENA_Y, CENTER.z)
const FLY_Y = ARENA_Y + ARENA_FLY_HEIGHT

let phase: Phase = 'idle'
let phaseTime = 0
let onPad = false
let score = 0
let beamCooldown = 0
let roundLeft = 0
let pickupMoved = false

let padText: Entity
let padDisc: Entity
let padFill: Entity
const padRings: Entity[] = []
let liftUfo: Entity
let liftBeam: Entity
let liftLight: Entity
const liftIdle = Vector3.create(LAUNCH_PAD.x, 17, LAUNCH_PAD.z)
const liftDown = Vector3.create(LAUNCH_PAD.x, 12, LAUNCH_PAD.z)
/** Set once the explorer has actually put us on the pasture; guards the fall check. */
let arrived = false
let spinAngle = 0

let playerUfo: Entity
let playerBeam: Entity
let playerLight: Entity
let beamShown = 0

interface GameCow {
  entity: Entity
  x: number
  z: number
  heading: number
  speed: number
  turnTimer: number
  bob: number
  /** >0 while being beamed up (0..1 progress) */
  caught: number
}
const cows: GameCow[] = []

let boardText: Entity

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

// ---------------------------------------------------------------------------
// Launch pad in the dome

function createLaunchPad() {
  const trigger = engine.addEntity()
  Transform.create(trigger, { position: Vector3.create(LAUNCH_PAD.x, 1.5, LAUNCH_PAD.z), scale: Vector3.create(4.5, 3, 4.5) })
  TriggerArea.setBox(trigger)
  triggerAreaEventsSystem.onTriggerEnter(trigger, () => {
    onPad = true
    if (phase === 'idle') {
      phase = 'countdown'
      phaseTime = 0
    }
  })
  triggerAreaEventsSystem.onTriggerExit(trigger, () => {
    onPad = false
    if (phase === 'countdown') {
      phase = 'idle'
      setPadText('STAND HERE TO FLY')
    }
  })

  // The pad itself: a raised glowing disc you can see from across the dome.
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
  // Three rings hovering over the pad, spinning: the tractor column, waiting.
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
  // Countdown column: grows from the pad up to the saucer while you hold still.
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
  const sub = engine.addEntity()
  Transform.create(sub, { position: Vector3.create(LAUNCH_PAD.x, 5.5, LAUNCH_PAD.z) })
  TextShape.create(sub, {
    text: 'the cow game: 3 minutes, catch cows as a saucer',
    fontSize: 1.5,
    font: Font.F_SANS_SERIF,
    textColor: Color4.create(0.7, 0.85, 0.95, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.12,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(sub, { billboardMode: BillboardMode.BM_Y })

  const glow = engine.addEntity()
  Transform.create(glow, { position: Vector3.create(LAUNCH_PAD.x, 3, LAUNCH_PAD.z) })
  LightSource.create(glow, {
    active: true,
    color: Color3.create(0.4, 0.9, 1),
    intensity: 500,
    range: 12,
    shadow: false,
    type: LightSource.Type.Point({})
  })

  // The pickup saucer, parked under the ceiling above the pad.
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

// ---------------------------------------------------------------------------
// Sky pasture

function createArena() {
  // Pasture (visual only; the player never stands on it).
  const pasture = engine.addEntity()
  Transform.create(pasture, {
    position: Vector3.clone(ARENA_CENTER),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(ARENA_SIZE, ARENA_SIZE, 1)
  })
  MeshRenderer.setPlane(pasture)
  Material.setPbrMaterial(pasture, {
    albedoColor: Color4.create(0.07, 0.14, 0.07, 1),
    emissiveColor: Color3.create(0.02, 0.05, 0.02),
    emissiveIntensity: 1,
    roughness: 1
  })
  // Glowing edge so the boundary reads from above.
  for (let i = 0; i < 4; i++) {
    const edge = engine.addEntity()
    const along = i < 2
    Transform.create(edge, {
      position: Vector3.create(
        ARENA_CENTER.x + (along ? 0 : (i === 2 ? -1 : 1) * (ARENA_SIZE / 2)),
        ARENA_Y + 0.05,
        ARENA_CENTER.z + (along ? (i === 0 ? -1 : 1) * (ARENA_SIZE / 2) : 0)
      ),
      scale: along ? Vector3.create(ARENA_SIZE, 0.1, 0.5) : Vector3.create(0.5, 0.1, ARENA_SIZE)
    })
    MeshRenderer.setBox(edge)
    Material.setPbrMaterial(edge, { albedoColor: Color4.create(0.1, 0.3, 0.2, 1), emissiveColor: Color3.create(0.3, 1, 0.6), emissiveIntensity: 2 })
  }
  // Crop circles for flavour.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const ring = engine.addEntity()
    Transform.create(ring, {
      position: Vector3.create(ARENA_CENTER.x + Math.sin(a) * 30, ARENA_Y + 0.04, ARENA_CENTER.z + Math.cos(a) * 30),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(10, 10, 1)
    })
    MeshRenderer.setPlane(ring)
    Material.setPbrMaterial(ring, { albedoColor: Color4.create(0.13, 0.18, 0.08, 1), emissiveColor: Color3.create(0.08, 0.14, 0.05), emissiveIntensity: 1 })
  }

  // Invisible floor the player (saucer) hovers on, with invisible walls at the edges.
  const deck = engine.addEntity()
  Transform.create(deck, { position: Vector3.create(ARENA_CENTER.x, FLY_Y - 0.1, ARENA_CENTER.z), scale: Vector3.create(ARENA_SIZE, 0.2, ARENA_SIZE) })
  MeshCollider.setBox(deck, ColliderLayer.CL_PHYSICS)
  for (let i = 0; i < 4; i++) {
    const wall = engine.addEntity()
    const along = i < 2
    Transform.create(wall, {
      position: Vector3.create(
        ARENA_CENTER.x + (along ? 0 : (i === 2 ? -1 : 1) * (ARENA_SIZE / 2)),
        FLY_Y + 4,
        ARENA_CENTER.z + (along ? (i === 0 ? -1 : 1) * (ARENA_SIZE / 2) : 0)
      ),
      scale: along ? Vector3.create(ARENA_SIZE + 2, 10, 1) : Vector3.create(1, 10, ARENA_SIZE + 2)
    })
    MeshCollider.setBox(wall, ColliderLayer.CL_PHYSICS)
  }

  // Up here you are a saucer: avatars hidden, third person so you can see yourself hover.
  const mods = engine.addEntity()
  Transform.create(mods, { position: Vector3.create(ARENA_CENTER.x, FLY_Y + 2, ARENA_CENTER.z) })
  AvatarModifierArea.create(mods, {
    area: Vector3.create(ARENA_SIZE + 4, 14, ARENA_SIZE + 4),
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS, AvatarModifierType.AMT_DISABLE_PASSPORTS],
    excludeIds: []
  })
  CameraModeArea.create(mods, { area: Vector3.create(ARENA_SIZE + 4, 14, ARENA_SIZE + 4), mode: CameraType.CT_THIRD_PERSON })

  // Light over the pasture.
  const moon = engine.addEntity()
  Transform.create(moon, { position: Vector3.create(ARENA_CENTER.x, ARENA_Y + 30, ARENA_CENTER.z) })
  LightSource.create(moon, { active: true, color: Color3.create(0.6, 0.7, 1), intensity: 3000, range: 90, shadow: false, type: LightSource.Type.Point({}) })

  // The player's saucer: follows the (hidden) avatar.
  playerUfo = engine.addEntity()
  Transform.create(playerUfo, { position: Vector3.create(ARENA_CENTER.x, FLY_Y, ARENA_CENTER.z), scale: Vector3.create(2.4, 2.4, 2.4) })
  GltfContainer.create(playerUfo, { src: 'models/ufo.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  VisibilityComponent.create(playerUfo, { visible: false })
  playerBeam = engine.addEntity()
  Transform.create(playerBeam, { position: Vector3.create(ARENA_CENTER.x, ARENA_Y + ARENA_FLY_HEIGHT / 2, ARENA_CENTER.z), scale: Vector3.Zero() })
  MeshRenderer.setCylinder(playerBeam, CATCH_RADIUS, 1.0)
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

  for (let i = 0; i < COW_COUNT; i++) cows.push(createGameCow())
  setCowsVisible(false)
}

function randomPastureSpot(awayFrom?: { x: number; z: number }, minDistance = 20) {
  for (let i = 0; i < 30; i++) {
    const x = ARENA_CENTER.x + (Math.random() * 2 - 1) * EDGE
    const z = ARENA_CENTER.z + (Math.random() * 2 - 1) * EDGE
    if (!awayFrom) return { x, z }
    const dx = x - awayFrom.x
    const dz = z - awayFrom.z
    if (dx * dx + dz * dz > minDistance * minDistance) return { x, z }
  }
  return { x: ARENA_CENTER.x, z: ARENA_CENTER.z }
}

function createGameCow(): GameCow {
  const spot = randomPastureSpot()
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(spot.x, ARENA_Y, spot.z),
    rotation: Quaternion.fromEulerDegrees(0, Math.random() * 360, 0),
    scale: Vector3.create(1.6, 1.6, 1.6)
  })
  GltfContainer.create(entity, { src: 'models/cow.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  return { entity, x: spot.x, z: spot.z, heading: Math.random() * Math.PI * 2, speed: 1.2, turnTimer: Math.random() * 3, bob: Math.random() * 6, caught: 0 }
}

function setCowsVisible(visible: boolean) {
  for (const cow of cows) VisibilityComponent.createOrReplace(cow.entity, { visible })
}

function resetCows(playerX: number, playerZ: number) {
  for (const cow of cows) {
    const spot = randomPastureSpot({ x: playerX, z: playerZ }, 12)
    cow.x = spot.x
    cow.z = spot.z
    cow.caught = 0
    cow.heading = Math.random() * Math.PI * 2
    const t = Transform.getMutable(cow.entity)
    t.position = Vector3.create(cow.x, ARENA_Y, cow.z)
    t.scale = Vector3.create(1.6, 1.6, 1.6)
  }
}

// ---------------------------------------------------------------------------
// Leaderboard panel in the dome

function createLeaderboard() {
  const yaw = (Math.atan2(LAUNCH_PAD.x - LEADERBOARD.x, LAUNCH_PAD.z - LEADERBOARD.z) * 180) / Math.PI
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.clone(LEADERBOARD), rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })

  const panel = engine.addEntity()
  Transform.create(panel, { parent: root, position: Vector3.create(0, 4, 0), scale: Vector3.create(7.5, 7, 0.3) })
  MeshRenderer.setBox(panel)
  MeshCollider.setBox(panel, ColliderLayer.CL_PHYSICS)
  Material.setPbrMaterial(panel, { albedoColor: Color4.create(0.03, 0.05, 0.06, 1), emissiveColor: Color3.create(0.1, 0.3, 0.35), emissiveIntensity: 0.6, metallic: 0.3, roughness: 0.5 })
  for (const side of [-1, 1]) {
    const post = engine.addEntity()
    Transform.create(post, { parent: root, position: Vector3.create(side * 3.9, 2.5, 0), scale: Vector3.create(0.3, 5, 0.3) })
    MeshRenderer.setBox(post)
    Material.setPbrMaterial(post, { albedoColor: Color4.create(0.05, 0.05, 0.07, 1), emissiveColor: Color3.create(0.3, 0.9, 1), emissiveIntensity: 1.5 })
  }

  const title = engine.addEntity()
  Transform.create(title, { parent: root, position: Vector3.create(0, 6.8, 0.2) })
  TextShape.create(title, {
    text: 'COW CATCHERS',
    fontSize: 4,
    font: Font.F_SANS_SERIF,
    textColor: Color4.create(0.5, 0.95, 1, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.12,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  boardText = engine.addEntity()
  Transform.create(boardText, { parent: root, position: Vector3.create(0, 3.6, 0.2) })
  TextShape.create(boardText, {
    text: 'no rounds yet\nstand on the pad',
    fontSize: 2.2,
    font: Font.F_SANS_SERIF,
    textColor: Color4.White(),
    outlineColor: Color4.Black(),
    outlineWidth: 0.08,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    lineSpacing: 10
  })

  room.onMessage('leaderboard', (data) => {
    const lines = data.entries.map((e, i) => `${i + 1}.  ${e.name}   ${e.score}`)
    TextShape.getMutable(boardText).text = lines.length ? lines.join('\n') : 'no rounds yet\nstand on the pad'
  })
  room.send('leaderboardGet', { v: 1 })
}

// ---------------------------------------------------------------------------
// Round flow

function startRound() {
  score = 0
  roundLeft = ROUND_SECONDS
  beamCooldown = 0
  hud.visible = true
  hud.score = 0
  hud.secondsLeft = roundLeft
  hud.banner = ''
  hud.bannerSub = ''
  arrived = false
  VisibilityComponent.createOrReplace(playerUfo, { visible: true })
  setCowsVisible(true)
  resetCows(ARENA_CENTER.x, ARENA_CENTER.z)
  LightSource.getMutable(playerLight).active = true
  void movePlayerTo({
    newRelativePosition: Vector3.create(ARENA_CENTER.x, FLY_Y + 0.5, ARENA_CENTER.z),
    cameraTarget: Vector3.create(ARENA_CENTER.x + 10, ARENA_Y, ARENA_CENTER.z + 10)
  })
}

function endRound() {
  phase = 'over'
  phaseTime = 0
  hud.banner = `ROUND OVER: ${score} COW${score === 1 ? '' : 'S'}`
  hud.bannerSub = 'the saucer is taking you back down'
  Transform.getMutable(playerBeam).scale = Vector3.Zero()
  LightSource.getMutable(playerLight).active = false
  const name = getPlayer()?.name || 'Visitor'
  room.send('scoreSubmit', { score, name })
}

function returnToDome() {
  hud.visible = false
  hud.banner = ''
  VisibilityComponent.createOrReplace(playerUfo, { visible: false })
  setCowsVisible(false)
  void movePlayerTo({ newRelativePosition: Vector3.create(LANDING.x, 0.2, LANDING.z), cameraTarget: Vector3.create(CENTER.x, 3, CENTER.z) })
  toast(`You caught ${score} cow${score === 1 ? '' : 's'}. They appear to be enjoying it.`, 8)
  phase = 'idle'
  phaseTime = 0
  setPadText('STAND HERE TO FLY')
}

function fireBeam(px: number, pz: number) {
  beamCooldown = BEAM_COOLDOWN
  beamShown = 0.45
  const t = Transform.getMutable(playerBeam)
  t.position = Vector3.create(px, ARENA_Y + ARENA_FLY_HEIGHT / 2, pz)
  t.scale = Vector3.create(1, ARENA_FLY_HEIGHT, 1)
  for (const cow of cows) {
    if (cow.caught > 0) continue
    const dx = cow.x - px
    const dz = cow.z - pz
    if (dx * dx + dz * dz <= CATCH_RADIUS * CATCH_RADIUS) {
      cow.caught = 0.0001
      score++
      hud.score = score
    }
  }
}

function gameSystem(dt: number) {
  phaseTime += dt

  // --- pad countdown and pickup -------------------------------------------
  if (phase === 'countdown') {
    const left = Math.ceil(COUNTDOWN - phaseTime)
    setPadText(onPad ? `HOLD STILL...  ${Math.max(1, left)}` : 'STAND HERE TO FLY')
    if (phaseTime >= COUNTDOWN) {
      phase = 'pickup'
      phaseTime = 0
      pickupMoved = false
      setPadText('')
      toast('They are coming for you.', 4)
    }
  }

  // Pad visuals: rings spin (faster while counting down), the column fills with the countdown.
  const progress = phase === 'countdown' ? Math.min(1, phaseTime / COUNTDOWN) : phase === 'pickup' ? 1 : 0
  const spin = phase === 'countdown' ? 40 + progress * 260 : phase === 'pickup' ? 360 : 40
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
      // Rise in the beam, then off to the pasture.
      void movePlayerTo({ newRelativePosition: Vector3.create(LAUNCH_PAD.x, liftDown.y - 2.5, LAUNCH_PAD.z), duration: 1.3 })
    }
    if (phaseTime > 3.4) {
      phase = 'playing'
      phaseTime = 0
      beamT.scale = Vector3.Zero()
      LightSource.getMutable(liftLight).active = false
      startRound()
    }
  } else {
    // Park the saucer, slowly spinning, and shrink the beam if it was left on.
    ufoT.position = Vector3.lerp(ufoT.position, Vector3.create(liftIdle.x + Math.sin(phaseTime * 0.4) * 2, liftIdle.y + Math.sin(phaseTime * 0.9) * 0.6, liftIdle.z), Math.min(1, dt * 1.5))
    beamT.scale = Vector3.Zero()
  }
  ufoT.rotation = Quaternion.fromEulerDegrees(Math.sin(phaseTime * 1.3) * 3, phaseTime * 35, Math.cos(phaseTime * 1.1) * 3)

  // --- round --------------------------------------------------------------
  if (phase !== 'playing' && phase !== 'over') return
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return
  const px = player.position.x
  const pz = player.position.z

  // Saucer follows the hidden avatar.
  const ut = Transform.getMutable(playerUfo)
  ut.position = Vector3.lerp(ut.position, Vector3.create(px, player.position.y + 0.9, pz), Math.min(1, dt * 12))
  ut.rotation = Quaternion.fromEulerDegrees(0, phaseTime * 60, 0)
  const lt = Transform.getMutable(playerLight)
  lt.position = Vector3.create(px, player.position.y - 0.5, pz)

  if (phase === 'playing') {
    if (!arrived) {
      // The explorer takes a moment to apply movePlayerTo; the clock starts when we are up there.
      if (player.position.y > ARENA_Y + 2) {
        arrived = true
        phaseTime = 0
      } else if (phaseTime > 8) {
        // Never made it (move refused?). Back to the dome without a score.
        toast('The saucer lost its grip. Try the pad again.', 6)
        hud.visible = false
        VisibilityComponent.createOrReplace(playerUfo, { visible: false })
        setCowsVisible(false)
        phase = 'idle'
        phaseTime = 0
        setPadText('STAND HERE TO FLY')
      }
      return
    }
    roundLeft -= dt
    hud.secondsLeft = roundLeft
    beamCooldown = Math.max(0, beamCooldown - dt)
    if (
      beamCooldown === 0 &&
      (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN) ||
        inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN))
    ) {
      fireBeam(px, pz)
    }
    // Fell off somehow, or the round ran out.
    if (roundLeft <= 0 || player.position.y < ARENA_Y - 2) endRound()
  }

  if (beamShown > 0) {
    beamShown -= dt
    if (beamShown <= 0) Transform.getMutable(playerBeam).scale = Vector3.Zero()
  }

  // Cows: wander, flee the shadow, rise when caught.
  for (const cow of cows) {
    const t = Transform.getMutable(cow.entity)
    if (cow.caught > 0) {
      cow.caught = Math.min(1, cow.caught + dt / 0.7)
      const k = easeInOut(cow.caught)
      t.position = Vector3.create(cow.x, ARENA_Y + k * (ARENA_FLY_HEIGHT - 1), cow.z)
      t.rotation = Quaternion.fromEulerDegrees(k * 40, cow.bob * 90 + k * 540, k * 200)
      t.scale = Vector3.create(1.6 * (1 - k * 0.8), 1.6 * (1 - k * 0.8), 1.6 * (1 - k * 0.8))
      if (cow.caught >= 1) {
        // Beamed up; a new cow wanders in somewhere else.
        const spot = randomPastureSpot({ x: px, z: pz }, 18)
        cow.x = spot.x
        cow.z = spot.z
        cow.caught = 0
        cow.heading = Math.random() * Math.PI * 2
        t.position = Vector3.create(cow.x, ARENA_Y, cow.z)
        t.scale = Vector3.create(1.6, 1.6, 1.6)
      }
      continue
    }
    const dx = cow.x - px
    const dz = cow.z - pz
    const d2 = dx * dx + dz * dz
    let speed = cow.speed
    if (d2 < FLEE_RADIUS * FLEE_RADIUS) {
      // Run away from the saucer's shadow.
      cow.heading = Math.atan2(dx, dz) + Math.sin(cow.bob) * 0.3
      speed = 4.2
    } else {
      cow.turnTimer -= dt
      if (cow.turnTimer <= 0) {
        cow.turnTimer = 1.5 + Math.random() * 3
        cow.heading += (Math.random() - 0.5) * 1.6
      }
    }
    let nx = cow.x + Math.sin(cow.heading) * speed * dt
    let nz = cow.z + Math.cos(cow.heading) * speed * dt
    if (Math.abs(nx - ARENA_CENTER.x) > EDGE || Math.abs(nz - ARENA_CENTER.z) > EDGE) {
      cow.heading = Math.atan2(ARENA_CENTER.x - cow.x, ARENA_CENTER.z - cow.z) + (Math.random() - 0.5)
      nx = cow.x
      nz = cow.z
    }
    cow.x = nx
    cow.z = nz
    cow.bob += dt * (speed > 2 ? 16 : 8)
    t.position = Vector3.create(cow.x, ARENA_Y + Math.abs(Math.sin(cow.bob)) * 0.06, cow.z)
    t.rotation = Quaternion.fromEulerDegrees(0, (cow.heading * 180) / Math.PI, Math.sin(cow.bob) * 2)
  }

  if (phase === 'over' && phaseTime > 4.5) returnToDome()
}

export function createCowGame() {
  createLaunchPad()
  createArena()
  createLeaderboard()
  engine.addSystem(gameSystem)
}
