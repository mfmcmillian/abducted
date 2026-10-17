import {
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
  TextAlignMode,
  TextShape,
  Transform
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { FORMATION } from '../layout'
import { room } from '../shared/messages'
import { toast } from './ui'

/**
 * The ring altar on the south-west crop circle. One Antrom Guildstone Ring per wallet;
 * the server (src/server/ringServer.ts) holds the Rewards key and the claim record.
 */

let claimed: boolean | null = null
let pending = 0 // seconds left waiting for the server, 0 = idle

function createAltar(): Entity {
  const c = FORMATION.SW
  const plinth = engine.addEntity()
  Transform.create(plinth, { position: Vector3.create(c.x, 0.6, c.z), scale: Vector3.create(2.6, 1.2, 2.6) })
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
  Transform.create(ring, {
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
  Transform.create(light, { position: Vector3.create(c.x, 3.2, c.z) })
  LightSource.create(light, {
    active: true,
    color: Color3.create(1, 0.78, 0.3),
    intensity: 700,
    range: 14,
    shadow: false,
    type: LightSource.Type.Point({})
  })

  const anchor = engine.addEntity()
  Transform.create(anchor, { position: Vector3.create(c.x, 0, c.z) })
  const title = engine.addEntity()
  Transform.create(title, { parent: anchor, position: Vector3.create(0, 4.6, 0) })
  TextShape.create(title, {
    text: 'ANTROM GUILDSTONE RING',
    fontSize: 3.2,
    font: Font.F_SANS_SERIF,
    textColor: Color4.create(1, 0.85, 0.45, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.15,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(title, { billboardMode: BillboardMode.BM_Y })
  const sub = engine.addEntity()
  Transform.create(sub, { parent: anchor, position: Vector3.create(0, 4.0, 0) })
  TextShape.create(sub, {
    text: 'claim one per wallet',
    fontSize: 1.8,
    font: Font.F_SANS_SERIF,
    textColor: Color4.create(0.85, 0.75, 0.5, 1),
    outlineColor: Color4.Black(),
    outlineWidth: 0.12,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(sub, { billboardMode: BillboardMode.BM_Y })

  // Spin and float.
  let clock = 0
  engine.addSystem((dt) => {
    clock += dt
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

export function createRingAltar() {
  createAltar()

  room.onMessage('ringStatus', (data) => {
    claimed = data.claimed
    pending = 0
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
