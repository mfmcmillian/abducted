import {
  AvatarShape,
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
import { changeRealm, openExternalUrl } from '~system/RestrictedActions'
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

/** Permanent night: 01:00. */
export function createNightSky() {
  SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: 3600, transitionMode: TransitionMode.TM_FORWARD })
}

/** Ground, crop circles and the path to the door (models/plaza.glb, tools/build-plaza.mjs). */
export function createGround(): Entity {
  const plaza = engine.addEntity()
  Transform.create(plaza, { position: CENTER })
  GltfContainer.create(plaza, {
    src: 'models/plaza.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
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
    Transform.create(pylon, {
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
  const portal = engine.addEntity()
  // Plane/Text fronts face local -Z. Rotate the portal's back toward the centre so its
  // illustrated front is what players approaching from the dome centre see.
  const facing = facingCenter(position)
  Transform.create(portal, {
    position,
    rotation: Quaternion.multiply(facing, Quaternion.fromEulerDegrees(0, 180, 0))
  })

  const artwork = engine.addEntity()
  Transform.create(artwork, { parent: portal, position: Vector3.create(0, 5, 0), scale: Vector3.create(7.5, 10, 0.12) })
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
  Transform.create(glow, { parent: portal, position: Vector3.create(0, 4.5, -1) })
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

  // Walk-through trigger in front of the illustrated portal.
  const trigger = engine.addEntity()
  Transform.create(trigger, { parent: portal, position: Vector3.create(0, 3, -1), scale: Vector3.create(5.5, 6, 2) })
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
const COSTUME_NAMES = ['ALIEN 01', 'ALIEN 02', 'ALIEN 03', 'ALIEN 04']

interface Showcase {
  kind: 'emote' | 'costume'
  avatar: Entity
  status: Entity
  marketCow: Entity
  index: number
  replay: number
  cowPhase: number
}

const showcases: Showcase[] = []

/**
 * A real AvatarShape collection display. The illustrated panel is the backdrop, the
 * glowing pedestal/avatar cycles the four collection items, and a separate button opens
 * the currently displayed item on Marketplace.
 */
function createAvatarShowcase(kind: 'emote' | 'costume', position: Vector3, texture: string, glowColor: Color3) {
  const root = engine.addEntity()
  const towardCentre = facingCenter(position)
  Transform.create(root, {
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
    text: kind === 'emote' ? 'RED  ·  1 / 4' : 'ALIEN 01  ·  1 / 4',
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

  const light = engine.addEntity()
  Transform.create(light, { parent: root, position: Vector3.create(0, 3.5, -2) })
  LightSource.create(light, { active: true, color: glowColor, intensity: 1500, range: 14, shadow: false, type: LightSource.Type.Point({}) })

  const display: Showcase = { kind, avatar, status, marketCow, index: 0, replay: 8, cowPhase: kind === 'emote' ? 0 : Math.PI }
  showcases.push(display)

  const cycle = () => {
    display.index = (display.index + 1) % 4
    display.replay = 8
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
  }
  const cycleOptions = { button: InputAction.IA_POINTER, hoverText: `Next ${kind}`, maxDistance: 14 }
  pointerEventsSystem.onPointerDown({ entity: hit, opts: cycleOptions }, cycle)
  pointerEventsSystem.onPointerDown({ entity: plinth, opts: cycleOptions }, cycle)
  pointerEventsSystem.onPointerDown(
    { entity: marketCow, opts: { button: InputAction.IA_POINTER, hoverText: 'Floating cow: view current item', maxDistance: 14 } },
    () => {
      const collection = kind === 'emote' ? EMOTE_COLLECTION : COSTUME_COLLECTION
      void openExternalUrl({ url: `https://decentraland.org/marketplace/contracts/${collection}/items/${display.index}` })
    }
  )
}

/** Separate interactive collection areas: emotes northeast, costumes southeast. */
export function createKiosk() {
  createAvatarShowcase('emote', FORMATION.NE, 'images/abducted-emote-showcase.jpg', Color3.create(0.15, 0.85, 1))
  createAvatarShowcase('costume', FORMATION.SE, 'images/alien-costume-showcase.jpg', Color3.create(0.65, 0.25, 1))

  engine.addSystem((dt) => {
    for (const display of showcases) {
      display.cowPhase += dt
      const cow = Transform.getMutable(display.marketCow)
      cow.position.y = 1.7 + Math.sin(display.cowPhase * 1.6) * 0.35
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

/** Pumpkins and gravestones from the emote, scattered around the dome floor (dome-centred offsets). */
export function createDecor() {
  const place = (model: string, dx: number, dz: number, rot: number, scale: number) => {
    const e = engine.addEntity()
    Transform.create(e, {
      position: Vector3.create(CENTER.x + dx, 0, CENTER.z + dz),
      rotation: Quaternion.fromEulerDegrees(0, rot, 0),
      scale: Vector3.create(scale, scale, scale)
    })
    GltfContainer.create(e, { src: model, visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  }
  const graves: Array<[number, number, number]> = [
    [-40, 6, 80],
    [-38, -4, 100],
    [40, 4, -80],
    [38, -8, -70],
    [-8, 40, 20],
    [10, 41, -30],
    [-36, 20, 50],
    [34, 22, -50]
  ]
  for (const [x, z, r] of graves) place('models/grave.glb', x, z, r, 2.2)
  const pumpkins: Array<[number, number, number]> = [
    [-20, 36, 20],
    [22, 34, -40],
    [-42, -14, 60],
    [42, -16, -60],
    [-24, -36, 120],
    [20, -38, 200],
    [0, 42, 30],
    [-14, -22, -20],
    [16, -24, 70]
  ]
  for (const [x, z, r] of pumpkins) place('models/pumpkin.glb', x, z, r, 2.5)
}
