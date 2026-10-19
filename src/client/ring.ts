import {
  Billboard,
  BillboardMode,
  ColliderLayer,
  engine,
  Entity,
  GltfContainer,
  InputAction,
  LightSource,
  Material,
  MeshCollider,
  MeshRenderer,
  pointerEventsSystem,
  TextureFilterMode,
  TextureWrapMode,
  Transform,
  VideoPlayer
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS, DOME_WALL, FORMATION, RING_VIDEO_URL } from '../layout'
import { room } from '../shared/messages'
import { toast } from './ui'
import { playAt, playGlobal, SFX } from './sfx'
import { ROOT } from './root'

/**
 * The ring altar on the south-west crop circle. One Antrom Guildstone Ring per wallet;
 * the server (src/server/ringServer.ts) holds the Rewards key and the claim record.
 */

let claimed: boolean | null = null
let pending = 0 // seconds left waiting for the server, 0 = idle

function createAltar(): Entity {
  const c = FORMATION.SW
  const plinth = engine.addEntity()
  Transform.create(plinth, { parent: ROOT, position: Vector3.create(c.x, 0.6, c.z), scale: Vector3.create(2.6, 1.2, 2.6) })
  MeshRenderer.setCylinder(plinth, 1, 0.75)
  MeshCollider.setCylinder(plinth, 1, 0.75, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  Material.setPbrMaterial(plinth, {
    albedoColor: Color4.create(0.1, 0.08, 0.04, 1),
    emissiveColor: Color3.create(1, 0.75, 0.25),
    emissiveIntensity: 0.5,
    metallic: 0.6,
    roughness: 0.35
  })

  const ring = engine.addEntity()
  Transform.create(ring, { parent: ROOT,
    position: Vector3.create(c.x, 2.5, c.z),
    rotation: Quaternion.fromEulerDegrees(0, 0, 0),
    scale: Vector3.create(30, 30, 30)
  })
  GltfContainer.create(ring, {
    src: 'models/ring.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  const light = engine.addEntity()
  Transform.create(light, { parent: ROOT, position: Vector3.create(c.x, 3.2, c.z) })
  LightSource.create(light, {
    active: true,
    color: Color3.create(1, 0.78, 0.3),
    intensity: 700,
    range: 14,
    shadow: false,
    type: LightSource.Type.Point({})
  })

  const anchor = engine.addEntity()
  Transform.create(anchor, { parent: ROOT, position: Vector3.create(c.x, 0, c.z) })
  // Giant extruded 3D letters ("FREE TO CLAIM" / "CLICK ME!", models/text-claim.glb, built by
  // tools/build-text.mjs at em = 1, readable side -Z like TextShape) hovering above everything.
  const CTA_SCALE = 3.2 // em -> metres; the model is ~4.7 em wide, 1.9 em tall
  const cta = engine.addEntity()
  Transform.create(cta, {
    parent: anchor,
    position: Vector3.create(0, 6.6, 0),
    scale: Vector3.create(CTA_SCALE, CTA_SCALE, CTA_SCALE)
  })
  GltfContainer.create(cta, {
    src: 'models/text-claim.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  Billboard.create(cta, { billboardMode: BillboardMode.BM_Y })
  const ctaLight = engine.addEntity()
  Transform.create(ctaLight, { parent: anchor, position: Vector3.create(0, 8.5, 0) })
  LightSource.create(ctaLight, {
    active: true,
    color: Color3.create(0.45, 1, 0.4),
    intensity: 180,
    range: 14,
    shadow: false,
    type: LightSource.Type.Point({})
  })

  // Spin and float.
  let clock = 0
  engine.addSystem((dt) => {
    clock += dt
    const glow = 0.5 + Math.sin(clock * 3) * 0.5 // 0..1
    const ct = Transform.getMutable(cta)
    const s = CTA_SCALE * (1 + glow * 0.04)
    ct.scale = Vector3.create(s, s, s)
    ct.position.y = 6.6 + Math.sin(clock * 0.9) * 0.25
    LightSource.getMutable(ctaLight).intensity = 120 + glow * 120
    const t = Transform.getMutable(ring)
    t.rotation = Quaternion.fromEulerDegrees(0, clock * 45, 0)
    t.position.y = 2.5 + Math.sin(clock * 1.3) * 0.15
    const l = LightSource.getMutable(light)
    l.intensity = 600 + Math.sin(clock * 2.1) * 150
  })

  const claim = () => {
    if (claimed === true) return toast('You already claimed your Antrom Guildstone Ring.')
    if (pending > 0) return
    pending = 20
    playGlobal(SFX.uiClick, 0.8)
    toast('The aliens are checking your wallet...')
    room.send('ringClaim', { v: 1 })
  }
  for (const e of [plinth, ring]) {
    pointerEventsSystem.onPointerDown(
      { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: 'Claim your Antrom Guildstone Ring', maxDistance: 10 } },
      claim
    )
  }
  return plinth
}

const WINDOW_BOTTOM = DOME_WALL * 0.2
const WINDOW_TOP = DOME_WALL * 0.9
const POSTER_H = WINDOW_TOP - WINDOW_BOTTOM - 0.1 // fills the pane sill to head
const PANE_CHORD = 2 * DOME_RADIUS * Math.sin(Math.PI / 32) // mullion to mullion, ~6.7 m
const POSTER_W = PANE_CHORD - 0.6 // clear of the mullions; the art is stretched to the pane
const POSTER_Y = (WINDOW_BOTTOM + WINDOW_TOP) / 2
const RING_VIDEO_SECONDS = 27.6
const MUSIC_VOLUME = 0.8 // what dome.ts starts the music video at
const DUCKED_VOLUME = 0.12

/**
 * Poster integrated into the window panel behind the altar. Click it and the
 * poster becomes a screen playing the ring explainer; the music ducks meanwhile and the
 * poster comes back when the clip ends (or when clicked again).
 */
function createPoster(domeVideo: Entity) {
  const c = FORMATION.SW
  const dx = c.x - CENTER.x
  const dz = c.z - CENTER.z
  const panelStep = (Math.PI * 2) / 32 // 128 columns, a mullion every 4 => 32 panes of 11.25 degrees
  const formationAngle = Math.atan2(dx, dz)
  const panelAngle = (Math.round(formationAngle / panelStep - 0.5) + 0.5) * panelStep
  const position = Vector3.create(
    CENTER.x + Math.sin(panelAngle) * (DOME_RADIUS - 0.12),
    0,
    CENTER.z + Math.cos(panelAngle) * (DOME_RADIUS - 0.12)
  )
  const yaw = (Math.atan2(CENTER.x - position.x, CENTER.z - position.z) * 180) / Math.PI
  // Plane fronts face local -Z, so add 180 to look toward the centre.
  const facing = Quaternion.fromEulerDegrees(0, yaw + 180, 0)

  const root = engine.addEntity()
  Transform.create(root, { parent: ROOT, position, rotation: facing })

  // Thin frame sits flush against the window panel.
  const frame = engine.addEntity()
  Transform.create(frame, {
    parent: root,
    position: Vector3.create(0, POSTER_Y, 0.08),
    scale: Vector3.create(POSTER_W + 0.5, POSTER_H + 0.5, 0.12)
  })
  MeshRenderer.setBox(frame)
  MeshCollider.setBox(frame, ColliderLayer.CL_PHYSICS)
  Material.setPbrMaterial(frame, {
    albedoColor: Color4.create(0.05, 0.04, 0.03, 1),
    emissiveColor: Color3.create(1, 0.75, 0.25),
    emissiveIntensity: 0.35,
    metallic: 0.7,
    roughness: 0.4
  })

  const screen = engine.addEntity()
  Transform.create(screen, {
    parent: root,
    position: Vector3.create(0, POSTER_Y, 0),
    scale: Vector3.create(POSTER_W, POSTER_H, 1)
  })
  MeshRenderer.setPlane(screen)
  MeshCollider.setPlane(screen, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)

  const player = engine.addEntity()
  Transform.create(player, { parent: root, position: Vector3.create(0, 2.5, 0) })
  VideoPlayer.create(player, { src: RING_VIDEO_URL, playing: false, loop: false, volume: 1 })

  const posterTexture = Material.Texture.Common({
    src: 'images/ring-poster.jpg',
    wrapMode: TextureWrapMode.TWM_CLAMP,
    filterMode: TextureFilterMode.TFM_BILINEAR
  })
  const videoTexture = Material.Texture.Video({
    videoPlayerEntity: player,
    wrapMode: TextureWrapMode.TWM_CLAMP,
    filterMode: TextureFilterMode.TFM_BILINEAR
  })
  const showPoster = () =>
    Material.setPbrMaterial(screen, {
      texture: posterTexture,
      emissiveTexture: posterTexture,
      emissiveColor: Color3.White(),
      emissiveIntensity: 0.6,
      roughness: 1,
      metallic: 0,
      specularIntensity: 0
    })
  const showVideo = () => Material.setBasicMaterial(screen, { texture: videoTexture, diffuseColor: Color4.White() })
  showPoster()

  const light = engine.addEntity()
  Transform.create(light, { parent: root, position: Vector3.create(0, POSTER_Y, -1.6) })
  LightSource.create(light, {
    active: true,
    color: Color3.create(1, 0.85, 0.55),
    intensity: 350,
    range: 9,
    shadow: false,
    type: LightSource.Type.Point({})
  })

  let remaining = 0 // seconds of clip left, 0 = showing the poster
  const stop = () => {
    remaining = 0
    const v = VideoPlayer.getMutable(player)
    v.playing = false
    v.position = 0
    VideoPlayer.getMutable(domeVideo).volume = MUSIC_VOLUME
    showPoster()
  }
  const play = () => {
    remaining = RING_VIDEO_SECONDS + 1
    const v = VideoPlayer.getMutable(player)
    v.position = 0
    v.playing = true
    VideoPlayer.getMutable(domeVideo).volume = DUCKED_VOLUME
    showVideo()
  }
  pointerEventsSystem.onPointerDown(
    { entity: screen, opts: { button: InputAction.IA_POINTER, hoverText: 'Watch: how the Guildstone Ring works', maxDistance: 14 } },
    () => {
      playGlobal(SFX.uiClick, 0.8)
      remaining > 0 ? stop() : play()
    }
  )
  engine.addSystem((dt) => {
    if (remaining <= 0) return
    remaining -= dt
    if (remaining <= 0) stop()
  })
}

export function createRingAltar(domeVideo: Entity) {
  createAltar()
  createPoster(domeVideo)

  room.onMessage('ringStatus', (data) => {
    claimed = data.claimed
    pending = 0
    if (data.ok) playAt(SFX.ringChime, Vector3.create(FORMATION.SW.x, 2.5, FORMATION.SW.z), 1)
    if (data.text) toast(data.text, data.ok ? 10 : 7)
  })

  // The room queues sends until the server connection is up, so no need to gate on isStateSyncronized().
  room.send('ringHello', { v: 1 })

  engine.addSystem((dt) => {
    if (pending > 0) {
      pending -= dt
      if (pending <= 0) {
        pending = 0
        toast('No answer from the mothership. The ring server may be offline, try again later.')
      }
    }
  })
}
