import {
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  GltfNodeModifiers,
  InputAction,
  InputModifier,
  inputSystem,
  LightSource,
  MainCamera,
  Material,
  MaterialTransparencyMode,
  MeshCollider,
  MeshRenderer,
  PointerEventType,
  pointerEventsSystem,
  TextureFilterMode,
  TextureWrapMode,
  Transform,
  Tween,
  EasingFunction,
  VideoEvent,
  VideoPlayer,
  VideoState,
  VirtualCamera
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS, LAUNCH_PAD, VIDEO_URL } from '../layout'
import { AERIAL_LIFT, CITY_POS, CITY_SCALE, COUNTRY_SCALE, EMBED, GROUND_Y, HOUSE_SCALE, ROAD_Z, ROOM_H, ROOM_POS, SET_SCALE, TERRAIN_LOCAL_Y, TOWN_EMBED_POS, TOWN_FULL_POS, TV_POS, TV_SCALE, TV_SCREEN, WINDOW_C } from './earthLayout'
import { EARTH_MODELS, EarthModel } from './earthManifest'
import { burstExplosion, PALETTES, puffTrail, startFx } from './fx'
import { launchPod, POD_CHARGE_SECONDS, releasePod, sealPod } from './pod'
import { beginLeg, hidePlayerAt, Leg, legPos, spawnDouble, stepLeg, unhidePlayer } from './zoomActor'
import { playAt, playGlobal, SFX } from './sfx'
import { earthEntity, earthPosition, EARTH_SCALE, setEarthFrozen } from './space'
import { toast, zoomUi } from './ui'
import { authorPath, Frame, Path, toWorld, townFrames } from './zoomPath'
import { ROOT, toScene } from './root'

/**
 * Click the Earth: one continuous camera move from where you stand, out through the glass,
 * over the top of the planet, down through the clouds to a cartoon street, through the
 * picture window of a house, across the living room and into the TV, which is playing the
 * dome's video.
 *
 * Real scale can't do this, so the sets are nested "Powers of Ten" style. The Earth model is
 * hollow: inside it sits an inverted sky sphere, and under that sky:
 *   aerial - a countryside diorama with a small city on it and, on a field, the whole
 *            street set at 1/4 scale (the "patch");
 *   town   - the street, the house (Meshy models, models/earth/) and, inside the house
 *            model, a room box (models/earth-room.glb) with the furniture and the TV.
 * The camera dives at the patch until it fills the frame; at that instant the countryside
 * is parked away and the street set is scaled up x4 *around the camera*, which leaves the
 * picture unchanged, so there is no cut. The only white-out is the real one: the clouds,
 * which hide the crossing of the Earth's shell. Everything here follows the Earth's position.
 *
 * Purely client-side: a VirtualCamera entity moved along a spline every frame. The path itself
 * (keys, timing, spline, roll) is in zoomPath.ts; the numbers are in earthLayout.ts.
 */

/** Static stays on the fitted screen this long before the TV changes channel (s). */
const STATIC_HOLD = 0.6
/** The dome music drops to this while the TV plays its copy of the video (dome.ts starts it at 0.8). */
const MUSIC_VOLUME = 0.8
const DUCKED_VOLUME = 0 // the room's music is cut while the TV plays; back on when we return to the dome
/** How long we will sit on the screen waiting for the video to finish before giving up (s). */
const MAX_HOLD = 15 * 60

const NO_COLLIDE = { visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE }

let setRoot: Entity
let roomRoot: Entity
let aerialRoot: Entity
let townRoot: Entity
const PARK = Vector3.create(0, -400, 0) // where the countryside waits while we are in the street (set coords)

/** Lights parented under the street set: LightSource range/intensity do not follow the parent's scale, so we do it. */
const townLights: { e: Entity; intensity: number; range: number }[] = []

function townEmbedded(embedded: boolean) {
  const t = Transform.getMutable(townRoot)
  t.position = embedded ? TOWN_EMBED_POS : TOWN_FULL_POS
  const k = embedded ? EMBED : 1
  t.scale = Vector3.create(k, k, k)
  Transform.getMutable(aerialRoot).position = embedded ? AERIAL_LIFT : PARK
  for (const l of townLights) {
    const ls = LightSource.getMutable(l.e)
    ls.intensity = l.intensity * k * k // inverse-square: same brightness on the scaled surfaces
    ls.range = l.range * k
  }
}
let clickTarget: Entity
/** the saucer we are riding, seen ahead of the camera from the glass until the clouds swallow it */
let ufo: Entity
const SHOW_UFO = false // parked for now: needs a proper reveal and framing
let camera: Entity
/** the camera's parent: sits at the origin except while a Move tween on it pans the camera (one Tween per entity) */
let camRig: Entity
const PAN_T = 1.6
/** the dome's shared player (music); only its volume is touched here */
let videoEntity: Entity
/** the TV's own player: same film, started from the top once the screen fills the view */
let tvPlayer: Entity
/** a looping clip of snow (videos/tv-static.mp4), on the CRT whenever the film is not */
let staticPlayer: Entity
let screen: Entity
/** how many times the TV has been started; nudges `position` so every restart seeks to the top */
let tvPlays = 0

// ---- building the sets -----------------------------------------------------------------------

function tex(src: string) {
  return Material.Texture.Common({ src, wrapMode: TextureWrapMode.TWM_REPEAT, filterMode: TextureFilterMode.TFM_TRILINEAR })
}
// emissiveOnly: black albedo, so the scene lights add nothing and the texture shows at exactly its emissive strength
const pbr = (src: string, extra: Partial<{ roughness: number; emissive: number; emissiveOnly: boolean }> = {}) => ({
  material: {
    $case: 'pbr' as const,
    pbr: {
      texture: tex(src),
      albedoColor: extra.emissiveOnly ? Color4.Black() : Color4.White(),
      metallic: 0,
      roughness: extra.roughness ?? 1,
      specularIntensity: 0,
      transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
      castShadows: false,
      ...(extra.emissive ? { emissiveTexture: tex(src), emissiveColor: Color3.White(), emissiveIntensity: extra.emissive } : {})
    }
  }
})

/** Put a player's picture on the CRT face (same unlit video material the dome uses). */
function tune(player: Entity) {
  const texture = Material.Texture.Video({ videoPlayerEntity: player, wrapMode: TextureWrapMode.TWM_CLAMP, filterMode: TextureFilterMode.TFM_BILINEAR })
  GltfNodeModifiers.createOrReplace(screen, {
    modifiers: [{ path: 'Screen', material: { material: { $case: 'unlit' as const, unlit: { texture, diffuseColor: Color4.White(), castShadows: false } } }, castShadows: false }]
  })
}

/** Place a Meshy model so its bbox bottom sits on y, with the given scale and yaw. */
function prop(parent: Entity, name: EarthModel, x: number, y: number, z: number, scale: number, yaw = 0): Entity {
  const m = EARTH_MODELS[name]
  const e = engine.addEntity()
  Transform.create(e, { parent, position: Vector3.create(x, y - m.min[1] * scale, z), rotation: Quaternion.fromEulerDegrees(0, yaw, 0), scale: Vector3.create(scale, scale, scale) })
  GltfContainer.create(e, { src: m.src, ...NO_COLLIDE })
  return e
}

function light(parent: Entity, pos: Vector3, color: Color3, intensity: number, range: number, inTown = false) {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: pos })
  LightSource.create(e, { active: true, color, intensity, range, shadow: false, type: LightSource.Type.Point({}) })
  if (inTown) townLights.push({ e, intensity, range })
  return e
}

function buildSets() {
  setRoot = engine.addEntity()
  Transform.create(setRoot, { parent: ROOT, position: earthPosition(), scale: Vector3.create(SET_SCALE, SET_SCALE, SET_SCALE) })

  // the sky: stays put while the layers underneath it are swapped
  const sky = engine.addEntity()
  Transform.create(sky, { parent: setRoot })
  GltfContainer.create(sky, { src: 'models/earth-sky.glb', ...NO_COLLIDE })
  // plain albedo texture: the same modifier path the lawn/road/wallpaper use (known to render). The
  // emissive-only variant came out flat white (emissiveTexture is dropped by the explorer).
  // the sky picture is baked into the GLB (double-sided, emissive); node modifiers never took on this mesh
  // daylight: a warm "sun" high on the +Z side and a cool fill (shared by every layer)
  light(setRoot, Vector3.create(5, 9, -8), Color3.create(1, 0.96, 0.85), 2600, 40)
  light(setRoot, Vector3.create(-6, 5, 6), Color3.create(0.7, 0.8, 1), 600, 26)

  aerialRoot = engine.addEntity()
  Transform.create(aerialRoot, { parent: setRoot, position: AERIAL_LIFT })
  townRoot = engine.addEntity()
  Transform.create(townRoot, { parent: setRoot })

  // the countryside from altitude: one diorama filling the ground disc, a downtown on one of the
  // flat fields (sunk a little so its plinth meets the terrain), the street set on another (below)
  prop(aerialRoot, 'countryside', 0, GROUND_Y, 0, COUNTRY_SCALE, 180)
  prop(aerialRoot, 'city', CITY_POS.x, TERRAIN_LOCAL_Y - 0.1, CITY_POS.z, CITY_SCALE)

  // the street. Lawn, road, path, hero house facing the road, neighbours either side, props.
  const town = townRoot
  const sets = engine.addEntity()
  Transform.create(sets, { parent: town })
  GltfContainer.create(sets, { src: 'models/earth-sets.glb', ...NO_COLLIDE })
  GltfNodeModifiers.create(sets, {
    modifiers: [
      { path: 'Ground', material: pbr('images/earth-lawn.png'), castShadows: false },
      { path: 'Road', material: pbr('images/earth-road.png'), castShadows: false },
      { path: 'Path', material: pbr('images/earth-path.png'), castShadows: false }
    ]
  })
  // porch light: makes the picture window read as glass before we go through it
  light(town, Vector3.create(WINDOW_C.x, WINDOW_C.y + 0.6, WINDOW_C.z - 1.6), Color3.create(1, 0.85, 0.6), 220, 6, true)
  prop(town, 'house', 0, GROUND_Y, 0, HOUSE_SCALE, 180)
  prop(town, 'house-neighbour', -8.6, GROUND_Y, 1.5, 4.2, 180)
  prop(town, 'house-neighbour', 8.8, GROUND_Y, 1.2, 4.2, 180)
  prop(town, 'tree', -5.2, GROUND_Y, -4.2, 3.2)
  prop(town, 'tree', 6.4, GROUND_Y, -3.6, 2.6, 120)
  prop(town, 'tree', -3, GROUND_Y, 7, 3.6, 40)
  prop(town, 'tree', 5, GROUND_Y, 7.5, 3)
  for (let i = -2; i <= 2; i++) if (i !== 0) prop(town, 'fence', i * 1.9 + (i > 0 ? 0.6 : -0.6), GROUND_Y, -5.6, 1)
  prop(town, 'mailbox', 1.4, GROUND_Y, -5.9, 0.75, 180)
  prop(town, 'car', 3.5, GROUND_Y, ROAD_Z + 1.4, 2.2)
  prop(town, 'car', -5.5, GROUND_Y, ROAD_Z - 1.2, 2.2, 180)

  // the living room, inside the house model
  roomRoot = engine.addEntity()
  Transform.create(roomRoot, { parent: town, position: ROOM_POS })
  const room = engine.addEntity()
  Transform.create(room, { parent: roomRoot })
  GltfContainer.create(room, { src: 'models/earth-room.glb', ...NO_COLLIDE })
  GltfNodeModifiers.create(room, {
    modifiers: [
      { path: 'RoomFloor', material: pbr('images/room-wood.png', { roughness: 0.6 }), castShadows: false },
      { path: 'RoomWalls', material: pbr('images/room-wallpaper.png'), castShadows: false }
    ]
  })
  light(roomRoot, Vector3.create(0.4, ROOM_H - 0.3, 0.6), Color3.create(1, 0.93, 0.8), 320, 8, true)
  light(roomRoot, Vector3.create(-1.5, 2.4, -1.6), Color3.create(0.9, 0.95, 1), 140, 5, true) // window light

  // furniture (room coords, origin room centre on the floor; TV wall is +Z)
  prop(roomRoot, 'sofa', 0.4, 0, -0.9, 1.05, 0) // faces the TV (+Z)
  prop(roomRoot, 'armchair', -2.0, 0, 0.5, 0.8, 70)
  prop(roomRoot, 'coffee-table', 0.4, 0, 0.3, 0.85)
  prop(roomRoot, 'cow-rug', 0.4, 0.01, 0.4, 1.8, 15)
  prop(roomRoot, 'lamp', -2.4, 0, 1.7, 0.95)
  prop(roomRoot, 'bookshelf', 2.9, 0, 1.0, 1.0, -90)
  prop(roomRoot, 'plant', 2.9, 0, -1.4, 0.75)
  const cabinet = engine.addEntity()
  Transform.create(cabinet, { parent: roomRoot, position: Vector3.create(0.4, 0.3, 1.75), scale: Vector3.create(1.6, 0.6, 0.7) })
  MeshRenderer.setBox(cabinet)
  Material.setPbrMaterial(cabinet, { albedoColor: Color4.create(0.45, 0.3, 0.18, 1), roughness: 0.6, metallic: 0 })
  const tv = prop(roomRoot, 'tv', TV_POS.x, 0.6, TV_POS.z, TV_SCALE, 180)

  // the screen: a recessed tray and domed CRT face sitting in the hole cut out of the TV's glass.
  // Built in the TV's model coordinates, so it takes the TV's exact transform. It shows snow until
  // the camera has settled on it, then the TV's own copy of the dome video, from the top.
  screen = engine.addEntity()
  const tvTr = Transform.get(tv)
  Transform.create(screen, { parent: roomRoot, position: Vector3.clone(tvTr.position), rotation: Quaternion.fromEulerDegrees(0, 180, 0), scale: Vector3.clone(tvTr.scale) })
  GltfContainer.create(screen, { src: 'models/earth-screen.glb', ...NO_COLLIDE })
  tvPlayer = engine.addEntity()
  Transform.create(tvPlayer, { parent: roomRoot, position: TV_SCREEN })
  VideoPlayer.create(tvPlayer, { src: VIDEO_URL, playing: false, loop: false, volume: 1 })
  staticPlayer = engine.addEntity()
  Transform.create(staticPlayer, { parent: roomRoot, position: TV_SCREEN })
  VideoPlayer.create(staticPlayer, { src: 'videos/tv-static.mp4', playing: true, loop: true, volume: 0.35 }) // the clip carries a quiet hiss
  tune(staticPlayer)
  light(roomRoot, Vector3.add(TV_SCREEN, Vector3.create(0, 0.2, -0.8)), Color3.create(0.6, 0.75, 1), 110, 3.5, true)

  // click target: an invisible sphere the size of the planet
  clickTarget = engine.addEntity()
  Transform.create(clickTarget, { parent: ROOT, position: earthPosition(), scale: Vector3.create(EARTH_SCALE * 1.85, EARTH_SCALE * 1.85, EARTH_SCALE * 1.85) })
  MeshCollider.setSphere(clickTarget, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown({ entity: clickTarget, opts: { button: InputAction.IA_POINTER, hoverText: 'Zoom to Earth', maxDistance: 220, showFeedback: true } }, () => startZoom())

  townEmbedded(true)

  ufo = engine.addEntity()
  Transform.create(ufo, { parent: ROOT, position: Vector3.create(0, -100, 0), scale: Vector3.Zero() })
  GltfContainer.create(ufo, { src: 'models/ufo.glb', ...NO_COLLIDE })

  // the camera
  camRig = engine.addEntity()
  Transform.create(camRig, { parent: ROOT })
  camera = engine.addEntity()
  Transform.create(camera, { parent: camRig, position: Vector3.create(0, -100, 0) })
  VirtualCamera.create(camera, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0) } })
}

// ---- the move ----------------------------------------------------------------------------------

interface Zoom {
  path: Path
  /** town-local -> world, before and after the swap (the Earth is frozen for the duration) */
  frames: { embedded: Frame; full: Frame }
  swapT: number
  t: number
  end: number
  phase: 'walk' | 'fly' | 'porch' | 'hold' | 'out'
  /** walk: the player's double on its way to the pod; 0 to the doorway, 1 inside, 2 sealed and charging */
  double: Entity | null
  stage: number
  leg: Leg | null
  /** walk: the camera blends from camFrom to the current shot over BLEND_T seconds after each cut */
  camFrom: { cam: Vector3; look: Vector3 }
  camCur: { cam: Vector3; look: Vector3 }
  blendT: number
  /** white-out left over from the pod launch, fading through the first seconds of flight */
  flash: number
  /** porch: the double beamed down in front of the house, walking to the window */
  townDouble: Entity | null
  porchDone: boolean
  porchT: number
  flyT: number
  cloudsDone: boolean
  windowDone: boolean
  swapped: boolean
  /** hold: has the TV been told to play */
  tvStarted: boolean
  /** hold: is the video (not the snow) on the screen */
  tvShowing: boolean
  /** last seen video offset, to notice it stopping or wrapping */
  holdOffset: number
  /** seconds of hold left if the video events stop coming */
  holdLeft: number
}
let zoom: Zoom | null = null

function setPlayerLocked(locked: boolean) {
  if (locked) InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  else if (InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
}

function startZoom() {
  if (zoom) return
  if (!earthEntity()) return
  setEarthFrozen(true)
  const E = earthPosition()
  const podTop = Vector3.create(LAUNCH_PAD.x, 13, LAUNCH_PAD.z)
  const path = authorPath({ E, start: podTop, forward: Vector3.normalize(Vector3.subtract(E, podTop)) })
  const frames = townFrames(E)
  // the player's double walks to the pod while the real avatar stays put, hidden
  const pt = Transform.get(engine.PlayerEntity)
  const P = toScene(pt.position)
  hidePlayerAt(P)
  const double = spawnDouble(ROOT, P, Quaternion.toEulerAngles(pt.rotation).y)
  const cam0 = Transform.get(engine.CameraEntity)
  const view = { cam: toScene(cam0.position), look: Vector3.add(toScene(cam0.position), Vector3.rotate(Vector3.Forward(), cam0.rotation)) }
  zoom = { path, frames, swapT: path.key('swap').t, t: 0, end: path.end, phase: 'walk', double, stage: 0, leg: null, camFrom: view, camCur: view, blendT: 0, flash: 0, townDouble: null, porchDone: false, porchT: 0, flyT: 0, cloudsDone: false, windowDone: false, swapped: false, tvStarted: false, tvShowing: false, holdOffset: -1, holdLeft: 45 }
  townEmbedded(true)
  const tr = Transform.getMutable(camera)
  tr.position = view.cam
  tr.rotation = Quaternion.fromLookAt(view.cam, view.look)
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: camera })
  setPlayerLocked(true)
  zoomUi.active = true
  zoomUi.white = 0
  zoomUi.hint = 'E to skip'
  playGlobal(SFX.zoom, 0.9)
}

function finishZoom() {
  if (!zoom) return
  if (zoom.double) engine.removeEntity(zoom.double)
  if (Tween.has(camera)) Tween.deleteFrom(camera)
  if (Tween.has(camRig)) Tween.deleteFrom(camRig)
  Transform.getMutable(camRig).position = Vector3.Zero()
  Transform.getMutable(ufo).scale = Vector3.Zero()
  if (zoom.townDouble) engine.removeEntity(zoom.townDouble)
  unhidePlayer()
  releasePod(false)
  zoom = null
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
  setPlayerLocked(false)
  setEarthFrozen(false)
  zoomUi.active = false
  zoomUi.hint = ''
  zoomUi.white = 1 // fades out below
  toast('Back on the deck. Click the Earth any time to watch again.', 6)
  townEmbedded(true)
  // the TV goes back to snow and the dome music comes back up
  VideoPlayer.getMutable(tvPlayer).playing = false
  VideoPlayer.getMutable(videoEntity).volume = MUSIC_VOLUME
  tune(staticPlayer)
}

const BLEND_T = 1.2
/** A camera cut during the walk: start blending from the current pose. */
function cut(z: Zoom) {
  z.camFrom = z.camCur
  z.blendT = 0
}

/** Tracking shot on the walking double: ahead and to the side, looking back at it. */
function walkShot(at: Vector3, toward?: Vector3): { cam: Vector3; look: Vector3 } {
  const dir = toward ? Vector3.normalize(Vector3.create(toward.x - at.x, 0, toward.z - at.z)) : Vector3.create(0, 0, 1)
  const side = Vector3.create(dir.z, 0, -dir.x)
  return { cam: Vector3.add(at, Vector3.create(side.x * 4.2 + dir.x * 3.2, 2.2, side.z * 4.2 + dir.z * 3.2)), look: Vector3.add(at, Vector3.create(0, 1.2, 0)) }
}

/** Straight in front of the pod, looking in through the doorway at the beam and whoever is in it. */
function podShot(inward: Vector3): { cam: Vector3; look: Vector3 } {
  return { cam: Vector3.add(LAUNCH_PAD, Vector3.create(inward.x * 11, 3.2, inward.z * 11)), look: Vector3.add(LAUNCH_PAD, Vector3.create(0, 3.4, 0)) }
}

/** End of a pan: drop the tweens, rig back at the origin, camera parked on the shot. */
function settleCamera(shot: { cam: Vector3; look: Vector3 }) {
  if (Tween.has(camRig)) Tween.deleteFrom(camRig)
  if (Tween.has(camera)) Tween.deleteFrom(camera)
  Transform.getMutable(camRig).position = Vector3.Zero()
  const tr = Transform.getMutable(camera)
  tr.position = shot.cam
  tr.rotation = Quaternion.fromLookAt(shot.cam, shot.look)
}

function system(dt: number) {
  // the sets ride on the Earth
  const E = earthPosition()
  Transform.getMutable(setRoot).position = E
  Transform.getMutable(clickTarget).position = E

  if (!zoom) {
    if (zoomUi.white > 0) zoomUi.white = Math.max(0, zoomUi.white - dt * 1.2)
    return
  }
  const z = zoom
  if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN) && z.phase !== 'out') {
    z.phase = 'out'
    z.t = 0
  }

  if (z.phase === 'walk') {
    z.t += dt
    const inward = Vector3.normalize(Vector3.create(CENTER.x - LAUNCH_PAD.x, 0, CENTER.z - LAUNCH_PAD.z))
    const door = Vector3.add(LAUNCH_PAD, Vector3.scale(inward, 3.8))
    const dbl = z.double!
    let shot: { cam: Vector3; look: Vector3 }
    if (z.stage === 0) {
      // to the doorway at a brisk pace, however far away they started (3.5 .. 6 m/s)
      if (!z.leg) {
        z.leg = beginLeg(dbl, door, Math.max(3.5, Math.min(6, Vector3.distance(Transform.get(dbl).position, door) / 4)))
        const b = walkShot(z.leg.to, Vector3.add(z.leg.to, Vector3.subtract(z.leg.to, z.leg.from)))
        // hard cut to the tracking shot; the camera then rides a Tween parallel to the double's leg,
        // so the renderer interpolates both and nothing is moved frame by frame
        const a = walkShot(z.leg.from, z.leg.to)
        const tr = Transform.getMutable(camera)
        tr.position = a.cam
        tr.rotation = Quaternion.fromLookAt(a.cam, a.look)
        Tween.createOrReplace(camera, { mode: Tween.Mode.Move({ start: a.cam, end: b.cam }), duration: z.leg.duration * 1000, easingFunction: EasingFunction.EF_LINEAR })
      }
      shot = walkShot(legPos(z.leg), z.leg.to)
      const b = walkShot(z.leg.to, Vector3.add(z.leg.to, Vector3.subtract(z.leg.to, z.leg.from)))
      if (stepLeg(z.leg, dt)) {
        z.stage = 1
        z.leg = beginLeg(dbl, LAUNCH_PAD, 2.5)
        // pan round to the front of the pod: the rig carries the position, the camera turns
        const front = podShot(inward)
        const tr = Transform.getMutable(camera)
        tr.position = b.cam
        tr.rotation = Quaternion.fromLookAt(b.cam, b.look)
        Tween.createOrReplace(camRig, { mode: Tween.Mode.Move({ start: Vector3.Zero(), end: Vector3.subtract(front.cam, b.cam) }), duration: PAN_T * 1000, easingFunction: EasingFunction.EF_EASEQUAD })
        Tween.createOrReplace(camera, { mode: Tween.Mode.Rotate({ start: tr.rotation, end: Quaternion.fromLookAt(front.cam, front.look) }), duration: PAN_T * 1000, easingFunction: EasingFunction.EF_EASEQUAD })
        cut(z)
      }
    } else if (z.stage === 1) {
      shot = podShot(inward)
      if (z.blendT >= PAN_T && Tween.has(camRig)) settleCamera(shot)
      if (stepLeg(z.leg!, dt)) {
        z.stage = 2
        z.leg = null
        z.t = 0
        sealPod()
        settleCamera(shot)
      }
    } else {
      shot = podShot(inward)
      if (z.t >= POD_CHARGE_SECONDS) {
        // transfer: white-out, the double is gone, and the flight picks up above the pod
        launchPod()
        engine.removeEntity(dbl)
        z.double = null
        z.flash = 1
        z.phase = 'fly'
        z.t = 0
        const first = z.path.pose(0, 0)
        const tr = Transform.getMutable(camera)
        tr.position = toWorld(z.frames.embedded, first.q)
        tr.rotation = first.rotation
        return
      }
    }
    z.camCur = shot
    z.blendT += dt
    zoomUi.white = 0
  } else if (z.phase === 'porch') {
    // dropped off on the lawn: beam down, walk up to the window, then the flight carries on inside
    z.porchT += dt
    const dbl = z.townDouble!
    const tr = Transform.getMutable(dbl)
    const DROP_T = 1.3
    if (z.porchT < DROP_T) {
      const u = z.porchT / DROP_T
      tr.position = Vector3.create(tr.position.x, GROUND_Y + 6 * (1 - u) * (1 - u), tr.position.z)
      if (Math.random() < 0.5) puffTrail(toWorld(z.frames.full, Vector3.add(tr.position, Vector3.create(0, 0.3, 0))), Color3.create(0.5, 1, 0.6), 0.4)
    } else {
      if (!z.leg) {
        tr.position = Vector3.create(tr.position.x, GROUND_Y, tr.position.z)
        z.leg = beginLeg(dbl, Vector3.create(WINDOW_C.x, GROUND_Y, WINDOW_C.z - 1.5), 2.2)
      }
      if (stepLeg(z.leg, dt) && z.porchT > DROP_T + 2.6) {
        z.phase = 'fly'
        z.t = z.flyT
      }
    }
    const pose = z.path.pose(z.flyT, dt)
    const cam = Transform.getMutable(camera)
    cam.position = toWorld(z.frames.full, pose.q)
    cam.rotation = pose.rotation
  } else if (z.phase === 'fly') {
    z.t += dt
    z.flash = Math.max(0, z.flash - dt * 1.1)
    const t = Math.min(z.t, z.end)
    if (!z.porchDone && t >= z.path.key('street').t) {
      // in front of the house: the double is dropped off and walks to the window
      z.porchDone = true
      z.phase = 'porch'
      z.porchT = 0
      z.flyT = t
      z.townDouble = spawnDouble(townRoot, Vector3.create(WINDOW_C.x, GROUND_Y + 6, WINDOW_C.z - 5.5), 0)
      z.leg = null
      playAt(SFX.lift, toWorld(z.frames.full, Vector3.create(WINDOW_C.x, GROUND_Y + 2, WINDOW_C.z - 5.5)), 0.6)
      return
    }
    const pose = z.path.pose(t, dt)
    const c = pose.white // clouds: the one white-out, on while the camera is inside the Earth's shell
    // the patch fills the frame: grow the street set around the camera, park the countryside.
    // The path is in town-local space, so only the frame it is mapped through changes.
    if (!z.swapped && t >= z.swapT) {
      z.swapped = true
      townEmbedded(false)
    }
    const pos = toWorld(z.swapped ? z.frames.full : z.frames.embedded, pose.q)
    const tr = Transform.getMutable(camera)
    tr.position = pos
    tr.rotation = pose.rotation

    // our saucer flies ahead of us from the glass over the top of the planet and into the clouds
    const u = Transform.getMutable(ufo)
    if (SHOW_UFO && t >= z.path.key('glass').t && c < 0.98) {
      const lead = Vector3.add(Vector3.add(pos, Vector3.scale(pose.dir, 7.5)), Vector3.create(0, -1.4, 0))
      u.position = lead
      u.scale = Vector3.create(1.7, 1.7, 1.7)
      const flat = Vector3.normalize(Vector3.create(pose.dir.x, 0, pose.dir.z))
      const yaw = (Math.atan2(flat.x, flat.z) * 180) / Math.PI
      u.rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, yaw, 0), Quaternion.fromEulerDegrees(pose.dir.y * -40 + 8, z.t * 240, Math.sin(z.t * 3) * 6))
    } else u.scale = Vector3.Zero()

    // dome glass: a faint glint as the camera passes the pane (it is see-through, so keep it subtle)
    const g = 1 - Math.min(1, Math.abs(Math.hypot(pos.x - CENTER.x, pos.z - CENTER.z) - DOME_RADIUS) / 0.8)
    zoomUi.white = Math.max(c, g * 0.35, z.flash)
    if (!z.cloudsDone && c > 0) {
      z.cloudsDone = true
      burstExplosion(Vector3.add(E, Vector3.create(0, 12.8 * SET_SCALE, -2 * SET_SCALE)), 2.5, { ...PALETTES.cow, fire0: Color3.White(), fire1: Color3.create(0.9, 0.93, 1), smoke: Color3.White(), spark: Color3.White(), flash: Color3.White() })
      playAt(SFX.ufoPass, pos, 0.5, 0.6)
    }
    if (!z.windowDone && t > z.path.key('window-in').t - 0.2) {
      z.windowDone = true
      playAt(SFX.ufoPass, pos, 0.3, 1.2) // a breath of air through the open window
    }
    if (z.t >= z.end) {
      z.phase = 'hold'
      z.t = 0
      zoomUi.hint = 'E to leave'
    }
  } else if (z.phase === 'hold') {
    // the snow fills the view; then the TV changes channel and we sit through the film, or E
    z.t += dt
    if (zoomUi.white > 0) zoomUi.white = Math.max(0, zoomUi.white - dt * 4)
    if (!z.tvStarted && z.t >= STATIC_HOLD) {
      z.tvStarted = true
      const tv = VideoPlayer.getMutable(tvPlayer)
      tv.playing = true
      tv.position = 0.001 * (tvPlays++ % 10) // a fresh value each time, so the seek is always sent
      VideoPlayer.getMutable(videoEntity).volume = DUCKED_VOLUME
    }
    const { offset, length } = videoInfo()
    if (!z.tvShowing) {
      // swap to the picture once the first frames are really playing (or stop waiting after 6 s)
      if (offset >= 0 || z.t >= STATIC_HOLD + 6) {
        z.tvShowing = true
        z.holdOffset = -1
        tune(tvPlayer)
        zoomUi.white = 0.6 // the channel-change blink
      }
    } else {
      // done when the player reports the end (stops, or wraps if the explorer loops it anyway)
      const stopped = z.holdOffset > 1 && offset < 0
      const wrapped = z.holdOffset >= 0 && offset >= 0 && offset < z.holdOffset - 2
      if (offset > z.holdOffset) z.holdOffset = offset
      z.holdLeft = offset >= 0 && length > 0 ? length - offset + 1 : z.holdLeft - dt
      if (stopped || wrapped || z.holdLeft <= 0 || z.t >= MAX_HOLD) {
        z.phase = 'out'
        z.t = 0
      }
    }
  } else {
    z.t += dt
    zoomUi.white = Math.min(1, z.t / 0.7)
    if (z.t >= 0.8) finishZoom()
  }
}

/** Playback position / length of the TV's video in seconds (-1 / 0 if unknown or not playing). */
function videoInfo(): { offset: number; length: number } {
  if (!VideoEvent.has(tvPlayer)) return { offset: -1, length: 0 }
  let last: { state: VideoState; currentOffset: number; videoLength: number } | null = null
  for (const ev of VideoEvent.get(tvPlayer)) last = ev
  if (!last || last.state !== VideoState.VS_PLAYING) return { offset: -1, length: 0 }
  return { offset: last.currentOffset, length: last.videoLength }
}

export function createEarthZoom(video: Entity) {
  videoEntity = video
  startFx()
  buildSets()
  engine.addSystem(system)
}
