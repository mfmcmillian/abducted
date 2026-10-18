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
  VideoEvent,
  VideoPlayer,
  VideoState,
  VirtualCamera
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS, VIDEO_URL } from '../layout'
import { EARTH_MODELS, EarthModel } from './earthManifest'
import { burstExplosion, PALETTES, startFx } from './fx'
import { playAt, playGlobal, SFX } from './sfx'
import { earthEntity, earthPosition, EARTH_SCALE, setEarthFrozen } from './space'
import { toast, zoomUi } from './ui'

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
 * Purely client-side: a VirtualCamera entity moved along a spline every frame.
 */

// ---- layout (set coordinates: origin = Earth centre, street along X on the -Z side) ----
const GROUND_Y = -4.2 // keep in sync with tools/build-earth-sets.mjs
/** The set is authored for a 11.6 m sky sphere; the Earth's ocean is at ~11.2 m, so shrink the lot to stay inside it. */
const SET_SCALE = 0.8
const ROAD_Z = -8.5
const HOUSE_SCALE = 4.6
const HOUSE_POS = Vector3.create(0, GROUND_Y + 0.707 * HOUSE_SCALE, 0) // model bbox y min is -0.707
// NOTE: the explorer mirrors glTF content in X (right- to left-handed), so anything measured in a
// model's own coordinates lands at -x in the scene. Scene-side placements below already account for it.
const ROOM_POS = Vector3.create(-0.6, GROUND_Y + 0.04, 1.23) // room front wall lands on the house front wall (z = -0.97)
const WINDOW_C = Vector3.create(-2.14, GROUND_Y + 2.35, -0.97) // centre of the (open) picture window: see tools/cut-window.mjs
const ROOM_H = 3.2
// room coordinates (origin: room centre on the floor)
const TV_SCALE = 0.7
const TV_POS = Vector3.create(0.4, 0.6 + 0.811 * TV_SCALE, 1.75)
// the CRT glass, measured on an orthographic render of the model: x -0.81..0.44, y -0.41..0.31,
// bulging to z 0.48 at the centre. The plane is a 16:9 rectangle inset in that, just proud of the bulge.
const TV_SCREEN = Vector3.create(TV_POS.x - 0.185 * TV_SCALE, TV_POS.y - 0.05 * TV_SCALE, TV_POS.z - 0.49 * TV_SCALE) // faces -Z after the 180 turn
const TV_SCREEN_SIZE = { w: 1.21 * TV_SCALE, h: 0.68 * TV_SCALE }
/** Distance at which the screen exactly fills a 60 degree (16:9) view, plus a hair of margin. */
const FIT_DISTANCE = Math.max(TV_SCREEN_SIZE.h / 2 / Math.tan(Math.PI / 6), TV_SCREEN_SIZE.w / 2 / (Math.tan(Math.PI / 6) * (16 / 9))) * 1.04
/** Static stays on the fitted screen this long before the TV changes channel (s). */
const STATIC_HOLD = 0.6
/** The dome music drops to this while the TV plays its copy of the video (dome.ts starts it at 0.8). */
const MUSIC_VOLUME = 0.8
const DUCKED_VOLUME = 0.1
/** How long we will sit on the screen waiting for the video to finish before giving up (s). */
const MAX_HOLD = 15 * 60

const NO_COLLIDE = { visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE }
const rand = (a: number, b: number) => a + Math.random() * (b - a)

let setRoot: Entity
let roomRoot: Entity
let aerialRoot: Entity
let townRoot: Entity
const PARK = Vector3.create(0, -400, 0) // where the countryside waits while we are in the street (set coords)

// ---- nesting (set coords unless stated) ----
const COUNTRY_SCALE = 11
const CITY_SCALE = 2 // the downtown diorama as a town on the countryside
const EMBED = 0.25 // the street set's scale when it sits on the countryside
/** The countryside's flat fields are ~0.13 model units above its bbox bottom; lift the layer so they are at y = 0. */
const TERRAIN_LOCAL_Y = GROUND_Y + 0.13 * COUNTRY_SCALE
const AERIAL_LIFT = Vector3.create(0, -TERRAIN_LOCAL_Y, 0)
/** Where the street set's ground centre sits on the countryside (a flat field; countryside yawed 180). */
const PATCH = Vector3.create(0, 0.15, -6.3)
/** The camera's first street-set key (town-local coords): over the road, 5.7 m up, looking 70 degrees down. */
const TOWN_Q0 = Vector3.create(-0.8, 1.5, -8.5)
const TOWN_LOOK0 = Vector3.create(-0.6, GROUND_Y, -6.4)
/** town-local -> set while embedded: set = TOWN_EMBED_POS + EMBED * q */
const TOWN_EMBED_POS = Vector3.subtract(PATCH, Vector3.scale(Vector3.create(0, GROUND_Y, 0), EMBED))
/** camera position (set coords) at the swap */
const SWAP_POS = Vector3.add(TOWN_EMBED_POS, Vector3.scale(TOWN_Q0, EMBED))
/** town-local -> set at full size, scaled up around SWAP_POS: set = TOWN_FULL_POS + q */
const TOWN_FULL_POS = Vector3.subtract(SWAP_POS, TOWN_Q0)
const SWAP_T = 14.8

function townEmbedded(embedded: boolean) {
  const t = Transform.getMutable(townRoot)
  t.position = embedded ? TOWN_EMBED_POS : TOWN_FULL_POS
  const k = embedded ? EMBED : 1
  t.scale = Vector3.create(k, k, k)
  Transform.getMutable(aerialRoot).position = embedded ? AERIAL_LIFT : PARK
}
let clickTarget: Entity
let camera: Entity
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

function light(parent: Entity, pos: Vector3, color: Color3, intensity: number, range: number) {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: pos })
  LightSource.create(e, { active: true, color, intensity, range, shadow: false, type: LightSource.Type.Point({}) })
  return e
}

function buildSets() {
  setRoot = engine.addEntity()
  Transform.create(setRoot, { position: earthPosition(), scale: Vector3.create(SET_SCALE, SET_SCALE, SET_SCALE) })

  // the sky: stays put while the layers underneath it are swapped
  const sky = engine.addEntity()
  Transform.create(sky, { parent: setRoot })
  GltfContainer.create(sky, { src: 'models/earth-sky.glb', ...NO_COLLIDE })
  GltfNodeModifiers.create(sky, { modifiers: [{ path: 'Sky', material: pbr('images/earth-sky.png', { emissive: 0.95, emissiveOnly: true }), castShadows: false }] })
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
  prop(aerialRoot, 'city', 0.5, TERRAIN_LOCAL_Y - 0.1, -1, CITY_SCALE)

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
  light(town, Vector3.create(WINDOW_C.x, WINDOW_C.y + 0.6, WINDOW_C.z - 1.6), Color3.create(1, 0.85, 0.6), 220, 6)
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
  light(roomRoot, Vector3.create(0.4, ROOM_H - 0.3, 0.6), Color3.create(1, 0.93, 0.8), 320, 8)
  light(roomRoot, Vector3.create(-1.5, 2.4, -1.6), Color3.create(0.9, 0.95, 1), 140, 5) // window light

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
  prop(roomRoot, 'tv', TV_POS.x, 0.6, TV_POS.z, TV_SCALE, 180)

  // the screen: a domed CRT face over the model's glass. It shows snow until the camera has
  // settled on it, then the TV's own copy of the dome video, from the top.
  screen = engine.addEntity()
  Transform.create(screen, { parent: roomRoot, position: TV_SCREEN, scale: Vector3.create(TV_SCREEN_SIZE.w, TV_SCREEN_SIZE.h, 1) })
  GltfContainer.create(screen, { src: 'models/earth-screen.glb', ...NO_COLLIDE })
  tvPlayer = engine.addEntity()
  Transform.create(tvPlayer, { parent: roomRoot, position: TV_SCREEN })
  VideoPlayer.create(tvPlayer, { src: VIDEO_URL, playing: false, loop: false, volume: 1 })
  staticPlayer = engine.addEntity()
  Transform.create(staticPlayer, { parent: roomRoot, position: TV_SCREEN })
  VideoPlayer.create(staticPlayer, { src: 'videos/tv-static.mp4', playing: true, loop: true, volume: 0 })
  tune(staticPlayer)
  light(roomRoot, Vector3.add(TV_SCREEN, Vector3.create(0, 0.2, -0.8)), Color3.create(0.6, 0.75, 1), 110, 3.5)

  // click target: an invisible sphere the size of the planet
  clickTarget = engine.addEntity()
  Transform.create(clickTarget, { position: earthPosition(), scale: Vector3.create(EARTH_SCALE * 1.85, EARTH_SCALE * 1.85, EARTH_SCALE * 1.85) })
  MeshCollider.setSphere(clickTarget, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown({ entity: clickTarget, opts: { button: InputAction.IA_POINTER, hoverText: 'Zoom to Earth', maxDistance: 220, showFeedback: true } }, () => startZoom())

  townEmbedded(true)

  // the camera
  camera = engine.addEntity()
  Transform.create(camera, { position: Vector3.create(0, -100, 0) })
  VirtualCamera.create(camera, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0) } })
}

// ---- the move ----------------------------------------------------------------------------------

interface Key {
  t: number
  pos: Vector3
  look: Vector3
}

interface Zoom {
  keys: Key[]
  t: number
  end: number
  phase: 'fly' | 'hold' | 'out'
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

/** Cardinal (Catmull-Rom style) spline through the keys with time-scaled tangents. */
function sample(keys: Key[], t: number, pick: (k: Key) => Vector3): Vector3 {
  if (t <= keys[0].t) return pick(keys[0])
  if (t >= keys[keys.length - 1].t) return pick(keys[keys.length - 1])
  let i = 0
  while (keys[i + 1].t <= t) i++
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)]
  const dt = k2.t - k1.t
  const u = (t - k1.t) / dt
  const p1 = pick(k1), p2 = pick(k2)
  const m1 = Vector3.scale(Vector3.subtract(p2, pick(k0)), dt / (k2.t - k0.t))
  const m2 = Vector3.scale(Vector3.subtract(pick(k3), p1), dt / (k3.t - k1.t))
  const u2 = u * u, u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2
  return Vector3.add(Vector3.add(Vector3.scale(p1, h00), Vector3.scale(m1, h10)), Vector3.add(Vector3.scale(p2, h01), Vector3.scale(m2, h11)))
}

function buildKeys(): Key[] {
  const E = earthPosition()
  const cam = Transform.get(engine.CameraEntity)
  const start = Vector3.clone(cam.position)
  const forward = Vector3.rotate(Vector3.Forward(), cam.rotation)
  // horizontal direction from the Earth back to the player: we approach along it and go over the top
  const toPlayer = Vector3.normalize(Vector3.create(start.x - E.x, 0, start.z - E.z))
  const local = (x: number, y: number, z: number) => Vector3.add(E, Vector3.create(x * SET_SCALE, y * SET_SCALE, z * SET_SCALE))
  // a point on the Earth-player line at horizontal distance d from the Earth, at absolute height y
  const onLine = (d: number, y: number) => Vector3.create(E.x + toPlayer.x * d, y, E.z + toPlayer.z * d)
  // the Earth's near side is only ~3 m outside the glass, so we slip past it sideways (towards the
  // street side of the set when there is a choice) and climb over the top
  const sideRaw = Vector3.create(toPlayer.z, 0, -toPlayer.x)
  const side = sideRaw.z <= 0 ? sideRaw : Vector3.scale(sideRaw, -1)
  const beside = (p: Vector3, m: number) => Vector3.add(p, Vector3.scale(side, m))
  // street-set coords at full size (after the swap) -> world
  const town = (q: Vector3) => local(TOWN_FULL_POS.x + q.x, TOWN_FULL_POS.y + q.y, TOWN_FULL_POS.z + q.z)
  // ... and while it is still the patch on the countryside
  const patch = (q: Vector3) => local(TOWN_EMBED_POS.x + q.x * EMBED, TOWN_EMBED_POS.y + q.y * EMBED, TOWN_EMBED_POS.z + q.z * EMBED)
  const room = (x: number, y: number, z: number) => town(Vector3.create(ROOM_POS.x + x, ROOM_POS.y + y, ROOM_POS.z + z))
  const city = local(0.5, 0.5, -1)
  const up = Vector3.Up()
  const far = Vector3.add(E, Vector3.scale(toPlayer, 30))
  // horizontal distance from the Earth to the dome glass along the approach line
  const glassD = Math.hypot(E.x - CENTER.x, E.z - CENTER.z) - DOME_RADIUS
  const windowFocus = town(WINDOW_C)
  const screen = room(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.z)
  return [
    { t: 0, pos: start, look: Vector3.add(start, Vector3.scale(forward, 40)) },
    { t: 3.5, pos: Vector3.add(start, Vector3.scale(Vector3.normalize(Vector3.subtract(far, start)), Vector3.distance(start, far) * 0.55)), look: E },
    { t: 5.8, pos: beside(onLine(glassD + 4, 11.5), 6), look: E }, // inside, at window height
    { t: 7.0, pos: beside(onLine(glassD - 3, 14), 13), look: E }, // through the glass (glint), beside the planet
    { t: 8.5, pos: beside(Vector3.add(Vector3.add(E, Vector3.scale(toPlayer, 3)), Vector3.scale(up, 15.5)), 5), look: Vector3.add(E, Vector3.scale(up, 2)) },
    // from here on the heading stays +Z: a near-vertical look with a heading flip makes the
    // picture spin, which is what we are avoiding. Out of the clouds the downtown is in view
    // ahead; the dive steepens onto the patch (the street set at 1/4) until it fills the frame.
    { t: 9.8, pos: local(0.3, 8.5, -7), look: city },
    { t: 12.3, pos: local(0.3, 5.2, -7.8), look: Vector3.lerp(city, patch(TOWN_LOOK0), 0.55) },
    { t: SWAP_T, pos: patch(TOWN_Q0), look: patch(TOWN_LOOK0) }, // == town(TOWN_Q0): the swap is seamless
    // the street at full size
    { t: 16.8, pos: town(Vector3.create(-2.2, GROUND_Y + 3.4, -9.3)), look: windowFocus },
    { t: 19.3, pos: town(Vector3.create(WINDOW_C.x, WINDOW_C.y, WINDOW_C.z - 2.2)), look: windowFocus },
    { t: 20.3, pos: town(Vector3.create(WINDOW_C.x, WINDOW_C.y, WINDOW_C.z + 0.6)), look: screen }, // in through the open window
    { t: 22.3, pos: room(1.2, 1.6, -0.6), look: screen },
    { t: 24.3, pos: room(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.z - 1.3), look: screen },
    { t: 25.8, pos: room(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.z - FIT_DISTANCE), look: screen } // the picture fills the view
  ]
}

function setPlayerLocked(locked: boolean) {
  if (locked) InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  else if (InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
}

function startZoom() {
  if (zoom) return
  if (!earthEntity()) return
  setEarthFrozen(true)
  const keys = buildKeys()
  zoom = { keys, t: 0, end: keys[keys.length - 1].t, phase: 'fly', cloudsDone: false, windowDone: false, swapped: false, tvStarted: false, tvShowing: false, holdOffset: -1, holdLeft: 45 }
  townEmbedded(true)
  const start = keys[0]
  const tr = Transform.getMutable(camera)
  tr.position = Vector3.clone(start.pos)
  tr.rotation = Quaternion.lookRotation(Vector3.subtract(start.look, start.pos), Vector3.Up())
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: camera })
  setPlayerLocked(true)
  zoomUi.active = true
  zoomUi.white = 0
  zoomUi.hint = 'E to skip'
  playGlobal(SFX.zoom, 0.9)
}

function finishZoom() {
  if (!zoom) return
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

  if (z.phase === 'fly') {
    z.t += dt
    const t = Math.min(z.t, z.end)
    const pos = sample(z.keys, t, (k) => k.pos)
    const look = sample(z.keys, t, (k) => k.look)
    const tr = Transform.getMutable(camera)
    tr.position = pos
    const dir = Vector3.subtract(look, pos)
    if (Vector3.lengthSquared(dir) > 1e-6) tr.rotation = Quaternion.lookRotation(Vector3.normalize(dir), Vector3.Up())

    // the patch fills the frame: grow the street set around the camera, park the countryside
    if (!z.swapped && t >= SWAP_T) {
      z.swapped = true
      townEmbedded(false)
    }

    // clouds: full white before the Earth's surface (crossed at ~9.1) until we are inside the sky sphere (~9.7)
    const c = t < 8.3 ? 0 : t < 8.9 ? (t - 8.3) / 0.6 : t < 10.7 ? 1 : t < 11.4 ? 1 - (t - 10.7) / 0.7 : 0
    // dome glass: a faint glint as the camera passes the pane (it is see-through, so keep it subtle)
    const g = 1 - Math.min(1, Math.abs(Math.hypot(pos.x - CENTER.x, pos.z - CENTER.z) - DOME_RADIUS) / 0.8)
    zoomUi.white = Math.max(c, g * 0.35)
    if (!z.cloudsDone && t > 8.3) {
      z.cloudsDone = true
      burstExplosion(Vector3.add(E, Vector3.create(0, 12.8 * SET_SCALE, -2 * SET_SCALE)), 2.5, { ...PALETTES.cow, fire0: Color3.White(), fire1: Color3.create(0.9, 0.93, 1), smoke: Color3.White(), spark: Color3.White(), flash: Color3.White() })
      playAt(SFX.ufoPass, pos, 0.5, 0.6)
    }
    if (!z.windowDone && t > 20.1) {
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
