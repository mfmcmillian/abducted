import {
  AvatarShape,
  Billboard,
  BillboardMode,
  ColliderLayer,
  engine,
  Entity,
  Font,
  GltfContainer,
  GltfNodeModifiers,
  InputAction,
  LightSource,
  Material,
  MeshCollider,
  MeshRenderer,
  pointerEventsSystem,
  SkyboxTime,
  TextAlignMode,
  TextShape,
  TextureFilterMode,
  TextureWrapMode,
  Transform,
  TransitionMode,
  TriggerArea,
  triggerAreaEventsSystem
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { executeTask } from '@dcl/sdk/ecs'
import { changeRealm, movePlayerTo, openExternalUrl } from '~system/RestrictedActions'
import {
  CENTER,
  COSTUME_COLLECTION,
  COSTUME_URNS,
  DOME_RADIUS,
  EMOTE_COLLECTION,
  EMOTE_URNS,
  FORMATION,
  WORLD_DUNGEONS
} from '../layout'
import { music } from './music'
import { toast } from './ui'
import { moo, playGlobal, SFX } from './sfx'
import { FLOOR_Y, ROOT } from './root'
import { PANE_H, PANE_W, PANE_Y, paneMount } from './pane'

/** Permanent night: 01:00. */
export function createNightSky() {
  SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: 3600, transitionMode: TransitionMode.TM_FORWARD })
}

/** Ground, crop circles and the path to the door (models/plaza.glb, tools/build-plaza.mjs). */
export function createGround(): Entity {
  const plaza = engine.addEntity()
  Transform.create(plaza, { parent: ROOT, position: CENTER })
  GltfContainer.create(plaza, {
    src: 'models/plaza.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  const spaceTexture = Material.Texture.Common({
    src: 'images/space-stars.jpg',
    wrapMode: TextureWrapMode.TWM_MIRROR,
    filterMode: TextureFilterMode.TFM_BILINEAR,
    tiling: { x: 6, y: 6 }
  })
  GltfNodeModifiers.create(plaza, {
    modifiers: [{
      path: 'SpaceGround',
      material: {
        material: {
          $case: 'pbr',
          pbr: {
            texture: spaceTexture,
            emissiveTexture: spaceTexture,
            emissiveColor: Color3.White(),
            emissiveIntensity: 1,
            albedoColor: Color4.White(),
            metallic: 0,
            roughness: 1,
            specularIntensity: 0,
            castShadows: false
          }
        }
      },
      castShadows: false
    }]
  })

  // Solid invisible bottom under the lifted dome. The rendered plaza stays unchanged,
  // but this guarantees there are no gaps the player can fall through.
  const bottom = engine.addEntity()
  Transform.create(bottom, {
    parent: ROOT,
    position: Vector3.create(CENTER.x, -0.25, CENTER.z),
    scale: Vector3.create(DOME_RADIUS, 0.5, DOME_RADIUS)
  })
  MeshCollider.setCylinder(bottom, 1, 1, ColliderLayer.CL_PHYSICS)

  // A player already below the lifted floor will not be pushed up by a collider
  // appearing above them. Rescue them to the same X/Z on the dome floor.
  let rescueCooldown = 0
  engine.addSystem((dt) => {
    rescueCooldown -= dt
    if (rescueCooldown > 0) return
    const player = Transform.getOrNull(engine.PlayerEntity)
    if (!player || player.position.y >= FLOOR_Y - 1) return
    const dx = player.position.x - CENTER.x
    const dz = player.position.z - CENTER.z
    if (dx * dx + dz * dz > DOME_RADIUS * DOME_RADIUS) return
    rescueCooldown = 2
    void movePlayerTo({
      newRelativePosition: Vector3.create(player.position.x, FLOOR_Y + 0.2, player.position.z)
    })
  })

  return plaza
}

const RIM_COLORS = [
  Color3.create(0.35, 1, 0.45),
  Color3.create(0.3, 0.9, 1),
  Color3.create(0.6, 0.35, 1),
  Color3.create(1, 0.35, 0.6)
]

/** 32 light pylons along the inner wall, a 360 degree equalizer driven by the music bands. */
export function createRimPylons() {
  const COUNT = 32
  const radius = DOME_RADIUS - 2.2
  const pylons: Entity[] = []
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2
    const pylon = engine.addEntity()
    Transform.create(pylon, { parent: ROOT,
      position: Vector3.create(CENTER.x + radius * Math.sin(a), 1.5, CENTER.z + radius * Math.cos(a)),
      scale: Vector3.create(0.5, 3, 0.5)
    })
    MeshRenderer.setBox(pylon)
    Material.setPbrMaterial(pylon, {
      albedoColor: Color4.create(0.04, 0.04, 0.06, 1),
      emissiveColor: RIM_COLORS[i % RIM_COLORS.length],
      emissiveIntensity: 1,
      roughness: 0.3
    })
    pylons.push(pylon)
  }

  let tick = 0
  let hueStep = 0
  engine.addSystem((dt) => {
    if (music.beat) hueStep++
    tick += dt
    if (tick < 1 / 15) return
    tick = 0
    for (let i = 0; i < pylons.length; i++) {
      const band = music.bands[i % 8]
      const height = 1.5 + 6.5 * band
      const t = Transform.getMutable(pylons[i])
      t.scale.y = height
      t.position.y = height / 2
      const m = Material.getMutable(pylons[i])
      if (m.material?.$case !== 'pbr') continue
      m.material.pbr.emissiveColor = RIM_COLORS[(i + hueStep) % RIM_COLORS.length]
      m.material.pbr.emissiveIntensity = 0.3 + 2.2 * band
    }
  })
}

function facingCenter(position: Vector3): Quaternion {
  const dx = CENTER.x - position.x
  const dz = CENTER.z - position.z
  return Quaternion.fromEulerDegrees(0, (Math.atan2(dx, dz) * 180) / Math.PI, 0)
}

function label(parent: Entity, text: string, y: number, color: Color4, fontSize = 4) {
  const e = engine.addEntity()
  Transform.create(e, { parent, position: Vector3.create(0, y, 0) })
  TextShape.create(e, {
    text,
    fontSize,
    font: Font.F_SANS_SERIF,
    textColor: color,
    outlineColor: Color4.Black(),
    outlineWidth: 0.15,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(e, { billboardMode: BillboardMode.BM_Y })
  return e
}

/** Illustrated gate to another World. Walk through or click it to travel. */
function createPortal(position: Vector3, world: string, title: string, texture: string) {
  // Mounted on the window pane behind the formation, filling it mullion to mullion.
  const portal = engine.addEntity()
  Transform.create(portal, { parent: ROOT, ...paneMount(position) })

  const artwork = engine.addEntity()
  Transform.create(artwork, { parent: portal, position: Vector3.create(0, PANE_Y, 0), scale: Vector3.create(PANE_W, PANE_H, 0.12) })
  MeshRenderer.setPlane(artwork)
  MeshCollider.setBox(artwork, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  Material.setBasicMaterial(artwork, {
    texture: Material.Texture.Common({
      src: texture,
      wrapMode: TextureWrapMode.TWM_CLAMP,
      filterMode: TextureFilterMode.TFM_BILINEAR
    }),
    diffuseColor: Color4.White(),
    castShadows: false
  })

  const glow = engine.addEntity()
  Transform.create(glow, { parent: portal, position: Vector3.create(0, PANE_Y, -1.6) })
  LightSource.create(glow, {
    active: true,
    color: Color3.create(0.6, 0.3, 1),
    intensity: 500,
    range: 14,
    shadow: false,
    type: LightSource.Type.Point({})
  })

  const go = () => {
    void changeRealm({ realm: world, message: `Travel to ${title}?` })
  }
  pointerEventsSystem.onPointerDown(
    { entity: artwork, opts: { button: InputAction.IA_POINTER, hoverText: `Enter ${title} — get the alien suit`, maxDistance: 14 } },
    go
  )

  // Walk-up trigger in front of the pane, just inside the invisible barrier (4 m in from the glass).
  const trigger = engine.addEntity()
  Transform.create(trigger, { parent: portal, position: Vector3.create(0, 3, -5.5), scale: Vector3.create(PANE_W, 6, 2) })
  TriggerArea.setBox(trigger)
  let armed = true
  triggerAreaEventsSystem.onTriggerEnter(trigger, () => {
    if (!armed) return
    armed = false
    go()
  })
  triggerAreaEventsSystem.onTriggerExit(trigger, () => {
    armed = true
  })

  return portal
}

export function createPortals() {
  createPortal(FORMATION.NW, WORLD_DUNGEONS, 'Dungeons of Antrom', 'images/doa-alien-suit-portal.jpg')
}

const BASE_AVATAR = 'urn:decentraland:off-chain:base-avatars'
const EMOTE_NAMES = ['RED', 'PURPLE', 'GREEN', 'CYAN']
const COSTUME_NAMES = ["EARTH'S AMBASSADOR", 'WAVED AT THE LIGHTS', 'THAT MEANS YES', 'GETTING BANNED']
const COSTUME_THUMBS = ['images/costume-0.png', 'images/costume-1.png', 'images/costume-2.png', 'images/costume-3.png']
const EMOTE_THUMBS = ['images/emote-red.png', 'images/emote-purple.png', 'images/emote-green.png', 'images/emote-cyan.png']

/** Price line per emote item. Starts from the last known Marketplace listing, refreshed live. */
const EMOTE_PRICES: { mana: number; onSale: boolean; available: number }[] = [
  { mana: 0, onSale: false, available: 0 },
  { mana: 5, onSale: true, available: 96 },
  { mana: 15, onSale: true, available: 8 },
  { mana: 0.5, onSale: true, available: 970 }
]
const priceLabel = (i: number) => {
  const p = EMOTE_PRICES[i]
  if (!p.onSale) return 'NOT FOR SALE'
  if (p.available <= 0) return 'SOLD OUT'
  return `${p.mana} MANA\n${p.available} LEFT`
}

interface Showcase {
  kind: 'emote' | 'costume'
  avatar: Entity
  status: Entity
  marketCow: Entity
  buyText?: Entity
  tiles?: Entity[]
  prices?: Entity[]
  highlight?: Entity
  index: number
  replay: number
  cowPhase: number
}

const showcases: Showcase[] = []

/** Pull current listing prices from the Marketplace API; keeps the baked values on failure. */
function refreshEmotePrices() {
  executeTask(async () => {
    try {
      const res = await fetch(`https://marketplace-api.decentraland.org/v1/items?contractAddress=${EMOTE_COLLECTION}`)
      const body = (await res.json()) as { data?: { itemId: string; price: string; isOnSale: boolean; available: string | number }[] }
      for (const it of body.data ?? []) {
        const i = Number(it.itemId)
        if (!(i >= 0 && i < 4)) continue
        // price is wei as a decimal string; 18 digits of fraction.
        const wei = it.price.padStart(19, '0')
        const mana = Number(`${wei.slice(0, -18)}.${wei.slice(-18)}`)
        EMOTE_PRICES[i] = { mana: Math.round(mana * 100) / 100, onSale: !!it.isOnSale, available: Number(it.available) }
      }
      for (const d of showcases) if (d.kind === 'emote') d.prices?.forEach((e, i) => (TextShape.getMutable(e).text = priceLabel(i)))
    } catch (e) {
      console.log('[plaza] marketplace prices unavailable', e)
    }
  })
}

const TILE = 1.7
const TILE_Y = 4.35
const TILE_GAP = 2.35

/**
 * A real AvatarShape collection display. The illustrated panel is the backdrop, the
 * glowing pedestal/avatar cycles the four collection items, and a separate button opens
 * the currently displayed item on Marketplace.
 */
function createAvatarShowcase(kind: 'emote' | 'costume', position: Vector3, texture: string, glowColor: Color3) {
  const root = engine.addEntity()
  const towardCentre = facingCenter(position)
  Transform.create(root, { parent: ROOT,
    position,
    // Plane/Text fronts face local -Z.
    rotation: Quaternion.multiply(towardCentre, Quaternion.fromEulerDegrees(0, 180, 0))
  })

  const backdrop = engine.addEntity()
  Transform.create(backdrop, { parent: root, position: Vector3.create(0, 4.5, 0), scale: Vector3.create(11, 8.25, 0.15) })
  MeshRenderer.setPlane(backdrop)
  MeshCollider.setBox(backdrop, ColliderLayer.CL_PHYSICS)
  Material.setBasicMaterial(backdrop, {
    texture: Material.Texture.Common({
      src: texture,
      wrapMode: TextureWrapMode.TWM_CLAMP,
      filterMode: TextureFilterMode.TFM_BILINEAR
    }),
    diffuseColor: Color4.White(),
    castShadows: false
  })

  const plinth = engine.addEntity()
  Transform.create(plinth, { parent: root, position: Vector3.create(0, 0.3, -2), scale: Vector3.create(4.4, 0.6, 4.4) })
  MeshRenderer.setCylinder(plinth, 1, 0.9)
  MeshCollider.setCylinder(plinth, 1, 0.9, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  Material.setPbrMaterial(plinth, {
    albedoColor: Color4.create(0.025, 0.035, 0.055, 1),
    emissiveColor: glowColor,
    emissiveIntensity: 2.2,
    metallic: 0.65,
    roughness: 0.25
  })

  const avatar = engine.addEntity()
  Transform.create(avatar, { parent: root, position: Vector3.create(0, 0.6, -2), rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  AvatarShape.create(avatar, {
    id: `${kind}-showcase`,
    name: kind === 'emote' ? 'Abducted! Emote' : 'Alien Costume',
    bodyShape: `${BASE_AVATAR}:BaseMale`,
    wearables:
      kind === 'costume'
        ? [COSTUME_URNS[0], `${BASE_AVATAR}:eyes_00`, `${BASE_AVATAR}:eyebrows_00`, `${BASE_AVATAR}:mouth_00`]
        : [
            `${BASE_AVATAR}:eyes_00`,
            `${BASE_AVATAR}:eyebrows_00`,
            `${BASE_AVATAR}:mouth_00`,
            `${BASE_AVATAR}:blue_tshirt`,
            `${BASE_AVATAR}:brown_pants`,
            `${BASE_AVATAR}:classic_shoes`,
            `${BASE_AVATAR}:short_hair`
          ],
    emotes: kind === 'emote' ? EMOTE_URNS : [],
    skinColor: { r: 0.55, g: 0.9, b: 0.62 },
    hairColor: { r: 0.08, g: 0.08, b: 0.1 },
    eyeColor: { r: 0.08, g: 0.08, b: 0.1 },
    expressionTriggerId: kind === 'emote' ? EMOTE_URNS[0] : 'dance',
    expressionTriggerTimestamp: Date.now()
  })

  // AvatarShape has no pointer collider.
  const hit = engine.addEntity()
  Transform.create(hit, { parent: avatar, position: Vector3.create(0, 1.2, 0), scale: Vector3.create(1.4, 2.5, 1.4) })
  MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)

  const status = engine.addEntity()
  Transform.create(status, { parent: root, position: Vector3.create(0, 1.15, -3.65) })
  TextShape.create(status, {
    text: `${kind === 'emote' ? EMOTE_NAMES[0] : COSTUME_NAMES[0]}  ·  1 / 4`,
    fontSize: 2,
    font: Font.F_SANS_SERIF,
    textColor: kind === 'emote' ? Color4.create(0.3, 0.95, 1, 1) : Color4.create(0.7, 1, 0.35, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.15,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })

  // The Marketplace control is an anti-gravity cow, not a UI-looking box.
  const marketCow = engine.addEntity()
  Transform.create(marketCow, {
    parent: root,
    position: Vector3.create(3.8, 1.7, -3.4),
    rotation: Quaternion.fromEulerDegrees(-8, 0, 10),
    scale: Vector3.create(1.15, 1.15, 1.15)
  })
  GltfContainer.create(marketCow, {
    src: 'models/cow.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  const cowGlow = engine.addEntity()
  Transform.create(cowGlow, { parent: marketCow, position: Vector3.create(0, -0.5, 0) })
  LightSource.create(cowGlow, { active: true, color: glowColor, intensity: 700, range: 7, shadow: false, type: LightSource.Type.Point({}) })
  const cowAction = engine.addEntity()
  Transform.create(cowAction, { parent: root, position: Vector3.create(3.8, 0.55, -3.45) })
  TextShape.create(cowAction, {
    text: kind === 'emote' ? 'CLICK COW TO OPEN\nMARKETPLACE ITEM' : 'NOT FOR SALE\nEARNED IN DUNGEONS OF ANTROM',
    fontSize: kind === 'emote' ? 1.15 : 1.05,
    font: Font.F_SANS_SERIF,
    textColor: kind === 'emote' ? Color4.create(0.45, 0.95, 1, 1) : Color4.create(0.75, 1, 0.35, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.14,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    lineSpacing: 9
  })

  const light = engine.addEntity()
  Transform.create(light, { parent: root, position: Vector3.create(0, 3.5, -2) })
  LightSource.create(light, { active: true, color: glowColor, intensity: 1500, range: 14, shadow: false, type: LightSource.Type.Point({}) })

  const display: Showcase = { kind, avatar, status, marketCow, index: 0, replay: 8, cowPhase: kind === 'emote' ? 0 : Math.PI }
  showcases.push(display)

  if (kind === 'emote') {
    // 3D "BUY HERE" floating over the Marketplace cow (built by tools/build-text.mjs, reads from -Z).
    const buyText = engine.addEntity()
    Transform.create(buyText, { parent: root, position: Vector3.create(3.8, 3.4, -3.4), scale: Vector3.create(0.7, 0.7, 0.7) })
    GltfContainer.create(buyText, { src: 'models/text-buy.glb', visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    Billboard.create(buyText, { billboardMode: BillboardMode.BM_Y })
    display.buyText = buyText

  }

  // Row of the four item thumbnails on the backdrop (emotes: middle of the panel with the
  // Marketplace price under each; costumes: the empty strip at the bottom of the guide).
  // Clicking one shows that item; the glowing frame marks the one on the pedestal.
  {
    const thumbs = kind === 'emote' ? EMOTE_THUMBS : COSTUME_THUMBS
    const tileY = kind === 'emote' ? TILE_Y : 1.8
    const tileSize = kind === 'emote' ? TILE : 1.15
    const tileGap = kind === 'emote' ? TILE_GAP : 2.8
    const highlight = engine.addEntity()
    Transform.create(highlight, { parent: root, position: Vector3.create(-1.5 * tileGap, tileY, -0.06), scale: Vector3.create(tileSize + 0.22, tileSize + 0.22, 1) })
    MeshRenderer.setPlane(highlight)
    Material.setPbrMaterial(highlight, { albedoColor: Color4.create(0.1, 0.5, 0.6, 1), emissiveColor: glowColor, emissiveIntensity: 1.6, roughness: 1, metallic: 0 })
    display.highlight = highlight
    display.tiles = []
    display.prices = []
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * tileGap
      const tile = engine.addEntity()
      Transform.create(tile, { parent: root, position: Vector3.create(x, tileY, -0.1), scale: Vector3.create(tileSize, tileSize, 1) })
      MeshRenderer.setPlane(tile)
      MeshCollider.setPlane(tile, ColliderLayer.CL_POINTER)
      Material.setBasicMaterial(tile, {
        texture: Material.Texture.Common({ src: thumbs[i], wrapMode: TextureWrapMode.TWM_CLAMP, filterMode: TextureFilterMode.TFM_BILINEAR }),
        diffuseColor: Color4.White(),
        castShadows: false
      })
      const price = engine.addEntity()
      Transform.create(price, { parent: root, position: Vector3.create(x, tileY - tileSize / 2 - 0.42, -0.1) })
      TextShape.create(price, {
        text: kind === 'emote' ? priceLabel(i) : '',
        fontSize: 1.25,
        font: Font.F_SANS_SERIF,
        textColor: Color4.create(1, 0.9, 0.45, 1),
        outlineColor: Color4.Black(),
        outlineWidth: 0.15,
        textAlign: TextAlignMode.TAM_TOP_CENTER,
        lineSpacing: 9
      })
      pointerEventsSystem.onPointerDown(
        { entity: tile, opts: { button: InputAction.IA_POINTER, hoverText: kind === 'emote' ? `Show ${EMOTE_NAMES[i].toLowerCase()} emote` : `Show suit: ${COSTUME_NAMES[i].toLowerCase()}`, maxDistance: 16 } },
        () => show(i)
      )
      display.tiles.push(tile)
      display.prices.push(price)
    }
  }

  const show = (index: number) => {
    display.index = index
    display.replay = 8
    playGlobal(SFX.uiClick, 0.7)
    const shape = AvatarShape.getMutable(display.avatar)
    if (kind === 'emote') {
      shape.emotes = EMOTE_URNS
      shape.expressionTriggerId = EMOTE_URNS[display.index]
    } else {
      shape.wearables = [
        COSTUME_URNS[display.index],
        `${BASE_AVATAR}:eyes_00`,
        `${BASE_AVATAR}:eyebrows_00`,
        `${BASE_AVATAR}:mouth_00`
      ]
      shape.expressionTriggerId = 'dance'
    }
    shape.expressionTriggerTimestamp = Date.now()
    TextShape.getMutable(status).text = `${kind === 'emote' ? EMOTE_NAMES[display.index] : COSTUME_NAMES[display.index]}  ·  ${display.index + 1} / 4`
    if (display.highlight) Transform.getMutable(display.highlight).position.x = (display.index - 1.5) * (kind === 'emote' ? TILE_GAP : 2.8)
  }
  const cycle = () => show((display.index + 1) % 4)
  const cycleOptions = { button: InputAction.IA_POINTER, hoverText: `Next ${kind}`, maxDistance: 14 }
  pointerEventsSystem.onPointerDown({ entity: hit, opts: cycleOptions }, cycle)
  pointerEventsSystem.onPointerDown({ entity: plinth, opts: cycleOptions }, cycle)
  pointerEventsSystem.onPointerDown(
    {
      entity: marketCow,
      opts: {
        button: InputAction.IA_POINTER,
        hoverText: kind === 'emote' ? 'Open selected emote on Marketplace' : 'Not for sale — earned in Dungeons of Antrom',
        maxDistance: 40
      }
    },
    () => {
      moo(Vector3.add(position, Vector3.create(0, 1.7, 0)), 0.9)
      if (kind === 'costume') {
        toast('Alien costumes are not for sale. Earn them in Dungeons of Antrom through the purple portal.', 7)
        return
      }
      const collection = kind === 'emote' ? EMOTE_COLLECTION : COSTUME_COLLECTION
      void openExternalUrl({ url: `https://decentraland.org/marketplace/contracts/${collection}/items/${display.index}` })
    }
  )
}

/**
 * Invisible ring of box colliders a few metres inside the glass so nobody walks up to the
 * windows (the parallax trick outside only holds from a distance). No renderer: a hollow
 * cylinder collider is not reliable from the inside.
 */
export function createBarrier() {
  const RADIUS = DOME_RADIUS - 4
  const SEGMENTS = 56
  const HEIGHT = 8
  const step = (Math.PI * 2) / SEGMENTS
  const width = 2 * RADIUS * Math.tan(step / 2) + 0.3 // slight overlap so there are no gaps
  for (let i = 0; i < SEGMENTS; i++) {
    const a = (i + 0.5) * step
    const wall = engine.addEntity()
    Transform.create(wall, { parent: ROOT,
      position: Vector3.create(CENTER.x + Math.sin(a) * RADIUS, HEIGHT / 2, CENTER.z + Math.cos(a) * RADIUS),
      rotation: Quaternion.fromEulerDegrees(0, (a * 180) / Math.PI, 0),
      scale: Vector3.create(width, HEIGHT, 0.4)
    })
    MeshCollider.setBox(wall, ColliderLayer.CL_PHYSICS)
  }
}

/** Separate interactive collection areas: emotes northeast, costumes southeast. */
export function createKiosk() {
  createAvatarShowcase('emote', FORMATION.NE, 'images/abducted-emote-showcase.jpg', Color3.create(0.15, 0.85, 1))
  createAvatarShowcase('costume', FORMATION.SE, 'images/alien-costume-showcase.jpg', Color3.create(0.65, 0.25, 1))
  refreshEmotePrices()

  engine.addSystem((dt) => {
    for (const display of showcases) {
      display.cowPhase += dt
      const cow = Transform.getMutable(display.marketCow)
      cow.position.y = 1.7 + Math.sin(display.cowPhase * 1.6) * 0.35
      if (display.buyText) Transform.getMutable(display.buyText).position.y = cow.position.y + 1.6
      cow.rotation = Quaternion.fromEulerDegrees(
        -8 + Math.sin(display.cowPhase * 1.1) * 6,
        display.cowPhase * 32,
        10 + Math.cos(display.cowPhase * 1.3) * 7
      )

      if (display.kind === 'emote') {
        display.replay -= dt
        if (display.replay <= 0) {
          const shape = AvatarShape.getMutable(display.avatar)
          shape.expressionTriggerId = EMOTE_URNS[display.index]
          shape.expressionTriggerTimestamp = Date.now()
          display.replay = 8
        }
      }
    }
  })
}
