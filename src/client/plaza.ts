import {
  Billboard,
  BillboardMode,
  ColliderLayer,
  EasingFunction,
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
  triggerAreaEventsSystem,
  Tween,
  TweenLoop,
  TweenSequence
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { changeRealm, openExternalUrl } from '~system/RestrictedActions'
import { CENTER, COSTUME_COLLECTION_URL, DOME_RADIUS, EMOTE_COLLECTION_URL, FORMATION, WORLD_DUNGEONS } from '../layout'
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

/** A pedestal with a slowly spinning exhibit on top; click to open a Marketplace page. */
function createExhibit(position: Vector3, model: string, modelScale: number, modelY: number, title: string, hover: string, url: string) {
  const plinth = engine.addEntity()
  Transform.create(plinth, { position: Vector3.create(position.x, 0.5, position.z), scale: Vector3.create(2.2, 1, 2.2) })
  MeshRenderer.setCylinder(plinth, 1, 0.9)
  MeshCollider.setCylinder(plinth, 1, 0.9, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  Material.setPbrMaterial(plinth, {
    albedoColor: Color4.create(0.08, 0.08, 0.1, 1),
    emissiveColor: Color3.create(0.3, 0.9, 1),
    emissiveIntensity: 0.6,
    metallic: 0.4,
    roughness: 0.4
  })

  const exhibit = engine.addEntity()
  Transform.create(exhibit, {
    position: Vector3.create(position.x, modelY, position.z),
    scale: Vector3.create(modelScale, modelScale, modelScale)
  })
  GltfContainer.create(exhibit, {
    src: model,
    visibleMeshesCollisionMask: ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })
  Tween.create(exhibit, {
    mode: Tween.Mode.Rotate({ start: Quaternion.fromEulerDegrees(0, 0, 0), end: Quaternion.fromEulerDegrees(0, 180, 0) }),
    duration: 6000,
    easingFunction: EasingFunction.EF_LINEAR
  })
  TweenSequence.create(exhibit, {
    sequence: [
      {
        mode: Tween.Mode.Rotate({ start: Quaternion.fromEulerDegrees(0, 180, 0), end: Quaternion.fromEulerDegrees(0, 360, 0) }),
        duration: 6000,
        easingFunction: EasingFunction.EF_LINEAR
      }
    ],
    loop: TweenLoop.TL_RESTART
  })

  const anchor = engine.addEntity()
  Transform.create(anchor, { position: Vector3.create(position.x, 0, position.z) })
  label(anchor, title, 4.2, Color4.create(0.6, 1, 0.8, 1), 3)

  const open = () => {
    void openExternalUrl({ url })
  }
  pointerEventsSystem.onPointerDown({ entity: plinth, opts: { button: InputAction.IA_POINTER, hoverText: hover, maxDistance: 10 } }, open)
  pointerEventsSystem.onPointerDown({ entity: exhibit, opts: { button: InputAction.IA_POINTER, hoverText: hover, maxDistance: 10 } }, open)
}

/** Marketplace corner: the Abducted! emotes and the alien costumes. */
export function createKiosk() {
  const c = FORMATION.SE
  createExhibit(Vector3.create(c.x - 3, 0, c.z), 'models/cow.glb', 1.3, 1.05, 'ABDUCTED! EMOTES', 'Abducted! emotes on the Marketplace', EMOTE_COLLECTION_URL)
  createExhibit(Vector3.create(c.x + 3, 0, c.z), 'models/ufo.glb', 1.1, 1.3, 'ALIEN COSTUMES', 'Alien costumes on the Marketplace', COSTUME_COLLECTION_URL)
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
