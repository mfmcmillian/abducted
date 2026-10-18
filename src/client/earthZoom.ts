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
  VirtualCamera
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS } from '../layout'
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
 * Real scale can't do this, so the sets are nested inside opaque shells and swapped under
 * cover. The Earth model is hollow: inside it sits an inverted sky sphere, and under that
 * sky three "layers" take turns (the other two are parked far below the scene):
 *   aerial  - countryside diorama seen from altitude
 *   city    - downtown district, flown over at rooftop height
 *   town    - the street, the house (Meshy models, models/earth/) and, inside the house
 *             model, a room box (models/earth-room.glb) with the furniture and the TV.
 * Every layer change and shell crossing happens under a short white-out (clouds / haze).
 * Everything here follows the Earth's position.
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
const ROOM_POS = Vector3.create(0.6, GROUND_Y + 0.04, 1.23) // room front wall lands on the house front wall (z = -0.97)
const WINDOW_C = Vector3.create(2.16, GROUND_Y + 2.33, -0.97) // centre of the picture window, world (set) coords
const ROOM_H = 3.2
// room coordinates (origin: room centre on the floor)
const TV_SCALE = 0.7
const TV_POS = Vector3.create(0.4, 0.6 + 0.811 * TV_SCALE, 1.75)
// the CRT glass bulges, so the plane sits a little proud of the bezel and overlaps it slightly
const TV_SCREEN = Vector3.create(0.4 + 0.195 * TV_SCALE, TV_POS.y - 0.03 * TV_SCALE, 1.75 - 0.54 * TV_SCALE) // faces -Z after the 180 turn
const TV_SCREEN_SIZE = { w: 1.36 * TV_SCALE, h: 0.84 * TV_SCALE }

const NO_COLLIDE = { visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE }
const rand = (a: number, b: number) => a + Math.random() * (b - a)

let setRoot: Entity
let roomRoot: Entity
type Layer = 'aerial' | 'city' | 'town'
const layerRoots = {} as Record<Layer, Entity>
const PARK = Vector3.create(0, -400, 0) // where inactive layers wait (set coords; well under the scene)

function showLayer(active: Layer) {
  for (const name of Object.keys(layerRoots) as Layer[]) Transform.getMutable(layerRoots[name]).position = name === active ? Vector3.Zero() : PARK
}
let clickTarget: Entity
let camera: Entity

// ---- building the sets -----------------------------------------------------------------------

function tex(src: string) {
  return Material.Texture.Common({ src, wrapMode: TextureWrapMode.TWM_REPEAT, filterMode: TextureFilterMode.TFM_TRILINEAR })
}
const pbr = (src: string, extra: Partial<{ roughness: number; emissive: number }> = {}) => ({
  material: {
    $case: 'pbr' as const,
    pbr: {
      texture: tex(src),
      albedoColor: Color4.White(),
      metallic: 0,
      roughness: extra.roughness ?? 1,
      specularIntensity: 0,
      transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
      castShadows: false,
      ...(extra.emissive ? { emissiveTexture: tex(src), emissiveColor: Color3.White(), emissiveIntensity: extra.emissive } : {})
    }
  }
})

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

function buildSets(video: Entity) {
  setRoot = engine.addEntity()
  Transform.create(setRoot, { position: earthPosition(), scale: Vector3.create(SET_SCALE, SET_SCALE, SET_SCALE) })

  // the sky: stays put while the layers underneath it are swapped
  const sky = engine.addEntity()
  Transform.create(sky, { parent: setRoot })
  GltfContainer.create(sky, { src: 'models/earth-sky.glb', ...NO_COLLIDE })
  GltfNodeModifiers.create(sky, { modifiers: [{ path: 'Sky', material: pbr('images/earth-sky.png', { emissive: 1.1 }), castShadows: false }] })
  // daylight: a warm "sun" high on the +Z side and a cool fill (shared by every layer)
  light(setRoot, Vector3.create(5, 9, -8), Color3.create(1, 0.96, 0.85), 2600, 40)
  light(setRoot, Vector3.create(-6, 5, 6), Color3.create(0.7, 0.8, 1), 600, 26)

  for (const name of ['aerial', 'city', 'town'] as Layer[]) {
    layerRoots[name] = engine.addEntity()
    Transform.create(layerRoots[name], { parent: setRoot, position: PARK })
  }

  // layer 1: the countryside from altitude. One diorama filling the whole ground disc.
  prop(layerRoots.aerial, 'countryside', 0, GROUND_Y, 0, 11)

  // layer 2: downtown, flown over at rooftop height
  prop(layerRoots.city, 'city', 0, GROUND_Y, 0, 9.5)
  light(layerRoots.city, Vector3.create(0, GROUND_Y + 6, -4), Color3.create(1, 0.9, 0.8), 500, 14)

  // layer 3: the street. Lawn, road, path, hero house facing the road, neighbours either side, props.
  const town = layerRoots.town
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
  light(roomRoot, Vector3.create(2.2, 2.4, -1.6), Color3.create(0.9, 0.95, 1), 140, 5) // window light

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

  // the screen: the dome's video, slightly proud of the CRT glass
  const screen = engine.addEntity()
  Transform.create(screen, { parent: roomRoot, position: TV_SCREEN, scale: Vector3.create(TV_SCREEN_SIZE.w, TV_SCREEN_SIZE.h, 1) })
  MeshRenderer.setPlane(screen)
  Material.setBasicMaterial(screen, {
    texture: Material.Texture.Video({ videoPlayerEntity: video, wrapMode: TextureWrapMode.TWM_CLAMP, filterMode: TextureFilterMode.TFM_BILINEAR }),
    diffuseColor: Color4.White(),
    castShadows: false
  })
  light(roomRoot, Vector3.add(TV_SCREEN, Vector3.create(0, 0.2, -0.8)), Color3.create(0.6, 0.75, 1), 110, 3.5)

  // click target: an invisible sphere the size of the planet
  clickTarget = engine.addEntity()
  Transform.create(clickTarget, { position: earthPosition(), scale: Vector3.create(EARTH_SCALE * 1.85, EARTH_SCALE * 1.85, EARTH_SCALE * 1.85) })
  MeshCollider.setSphere(clickTarget, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown({ entity: clickTarget, opts: { button: InputAction.IA_POINTER, hoverText: 'Zoom to Earth', maxDistance: 220, showFeedback: true } }, () => startZoom())

  showLayer('town')

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
  /** first key of a new layer: the spline restarts here (the jump before it is hidden by white) */
  cut?: boolean
  /** switch to this layer when the key's time is reached */
  layer?: Layer
}

interface Zoom {
  keys: Key[]
  t: number
  end: number
  phase: 'fly' | 'hold' | 'out'
  cloudsDone: boolean
  windowDone: boolean
  /** index of the next key whose layer switch is pending */
  nextLayerKey: number
  /** haze transitions already puffed */
  hazeDone: Set<number>
}
let zoom: Zoom | null = null

/** Cardinal (Catmull-Rom style) spline through the keys with time-scaled tangents. */
function sample(keys: Key[], t: number, pick: (k: Key) => Vector3): Vector3 {
  if (t <= keys[0].t) return pick(keys[0])
  if (t >= keys[keys.length - 1].t) return pick(keys[keys.length - 1])
  let i = 0
  while (keys[i + 1].t <= t) i++
  const k1 = keys[i], k2 = keys[i + 1]
  const k0 = k1.cut ? k1 : keys[Math.max(0, i - 1)]
  const k3 = k2.cut ? k2 : keys[Math.min(keys.length - 1, i + 2)]
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
  const room = (x: number, y: number, z: number) => local(ROOM_POS.x + x, ROOM_POS.y + y, ROOM_POS.z + z)
  const up = Vector3.Up()
  const far = Vector3.add(E, Vector3.scale(toPlayer, 30))
  // horizontal distance from the Earth to the dome glass along the approach line
  const glassD = Math.hypot(E.x - CENTER.x, E.z - CENTER.z) - DOME_RADIUS
  const streetFocus = local(0, GROUND_Y + 1, -2)
  const windowFocus = local(WINDOW_C.x, WINDOW_C.y, WINDOW_C.z)
  const screen = room(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.z)
  return [
    { t: 0, pos: start, look: Vector3.add(start, Vector3.scale(forward, 40)) },
    { t: 3.5, pos: Vector3.add(start, Vector3.scale(Vector3.normalize(Vector3.subtract(far, start)), Vector3.distance(start, far) * 0.55)), look: E },
    { t: 5.8, pos: beside(onLine(glassD + 4, 11.5), 6), look: E }, // inside, at window height
    { t: 7.0, pos: beside(onLine(glassD - 3, 14), 13), look: E }, // through the glass (glint), beside the planet
    { t: 8.5, pos: beside(Vector3.add(Vector3.add(E, Vector3.scale(toPlayer, 3)), Vector3.scale(up, 15.5)), 5), look: Vector3.add(E, Vector3.scale(up, 2)) },
    // from here on the heading stays +Z: a near-vertical look with a heading flip makes the
    // picture spin, which is what we are avoiding. Each layer starts high and ends low, the
    // next one starts high again under a white-out (see HAZE below).
    // layer 1: countryside, from the cloud base down to the grey town in the middle
    { t: 9.8, pos: local(0.5, 10, -6), look: local(0, -2, -1), cut: true, layer: 'aerial' },
    { t: 12.6, pos: local(0.3, 4.6, -3.8), look: local(0, GROUND_Y, 2) },
    { t: 15.3, pos: local(0.2, GROUND_Y + 2.3, 1.2), look: local(0, GROUND_Y, 5.5) }, // low over the fields (clear of trees)
    // layer 2: downtown, over the towers and down to street level at the edge
    // (the towers stand in x -4..7, z -9..0 and reach y ~5; the low blocks are at z > 4)
    { t: 15.6, pos: local(2.5, 9.5, -7), look: local(2, GROUND_Y + 2, 1), cut: true, layer: 'city' },
    { t: 18.2, pos: local(2.5, 6.5, -1.5), look: local(2.2, GROUND_Y + 0.5, 5) },
    { t: 20.8, pos: local(2.6, GROUND_Y + 3.8, 2.0), look: local(2.4, GROUND_Y + 0.3, 6) }, // down to the low blocks
    // layer 3: the street
    { t: 21.1, pos: local(1, 5.5, -7.5), look: streetFocus, cut: true, layer: 'town' },
    { t: 23.6, pos: local(2.6, GROUND_Y + 3.2, -9.5), look: windowFocus },
    { t: 26.1, pos: local(WINDOW_C.x, WINDOW_C.y, WINDOW_C.z - 2.2), look: windowFocus },
    { t: 27.1, pos: local(WINDOW_C.x, WINDOW_C.y, WINDOW_C.z + 0.6), look: screen }, // through the glass
    { t: 29.1, pos: room(1.2, 1.6, -0.6), look: screen },
    { t: 31.1, pos: room(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.z - 0.7), look: screen },
    { t: 32.6, pos: room(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.z - 0.13), look: screen }
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
  zoom = { keys, t: 0, end: keys[keys.length - 1].t, phase: 'fly', cloudsDone: false, windowDone: false, nextLayerKey: 0, hazeDone: new Set() }
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
  toast('Back on the deck. The TV down there is playing the dome video: click the Earth any time.', 6)
  showLayer('town')
}

/** Haze white-outs covering the layer swaps: [start, full, hold-until, clear]. */
const HAZE: [number, number, number, number][] = [
  [14.9, 15.3, 15.8, 16.4],
  [20.4, 20.8, 21.3, 21.9]
]

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

    // layer swaps happen at their key's time, always under full white
    while (z.nextLayerKey < z.keys.length && z.keys[z.nextLayerKey].t <= t) {
      const k = z.keys[z.nextLayerKey++]
      if (k.layer) showLayer(k.layer)
    }

    // clouds: full white before the Earth's surface (crossed at ~9.45) until we are inside the sky sphere
    let c = t < 8.6 ? 0 : t < 9.2 ? (t - 8.6) / 0.6 : t < 10.7 ? 1 : t < 11.4 ? 1 - (t - 10.7) / 0.7 : 0
    // haze between layers, with a puff of cloud in front of the lens as it starts
    HAZE.forEach(([a, b, h, d], i) => {
      c = Math.max(c, t < a ? 0 : t < b ? (t - a) / (b - a) : t < h ? 1 : t < d ? 1 - (t - h) / (d - h) : 0)
      if (!z.hazeDone.has(i) && t > a) {
        z.hazeDone.add(i)
        const ahead = Vector3.add(pos, Vector3.scale(Vector3.normalize(dir), 1.6))
        burstExplosion(ahead, 0.9, { ...PALETTES.cow, fire0: Color3.White(), fire1: Color3.create(0.92, 0.95, 1), smoke: Color3.White(), spark: Color3.White(), flash: Color3.White() })
        playAt(SFX.ufoPass, pos, 0.4, 0.7)
        if (i === 0) playGlobal(SFX.zoom, 0.6)
      }
    })
    // window: a short glint at the glass (t = 27.1)
    const w = 1 - Math.min(1, Math.abs(t - 27.1) / 0.35)
    // dome glass: a faint glint as the camera passes the pane (it is see-through, so keep it subtle)
    const g = 1 - Math.min(1, Math.abs(Math.hypot(pos.x - CENTER.x, pos.z - CENTER.z) - DOME_RADIUS) / 0.8)
    zoomUi.white = Math.max(c, w * 0.75, g * 0.35)
    if (!z.cloudsDone && t > 8.6) {
      z.cloudsDone = true
      burstExplosion(Vector3.add(E, Vector3.create(0, 12.8 * SET_SCALE, -2 * SET_SCALE)), 2.5, { ...PALETTES.cow, fire0: Color3.White(), fire1: Color3.create(0.9, 0.93, 1), smoke: Color3.White(), spark: Color3.White(), flash: Color3.White() })
      playAt(SFX.ufoPass, pos, 0.5, 0.6)
    }
    if (!z.windowDone && t > 26.9) {
      z.windowDone = true
      playGlobal(SFX.ringChime, 0.5, 1.3)
    }
    if (z.t >= z.end) {
      z.phase = 'hold'
      z.t = 0
    }
  } else if (z.phase === 'hold') {
    z.t += dt
    zoomUi.white = 0
    if (z.t >= 2.5) {
      z.phase = 'out'
      z.t = 0
    }
  } else {
    z.t += dt
    zoomUi.white = Math.min(1, z.t / 0.7)
    if (z.t >= 0.8) finishZoom()
  }
}

export function createEarthZoom(video: Entity) {
  startFx()
  buildSets(video)
  engine.addSystem(system)
}
