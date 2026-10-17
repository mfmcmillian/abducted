import { AvatarShape, engine, Entity, InputAction, MeshCollider, pointerEventsSystem, ColliderLayer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { openExternalUrl } from '~system/RestrictedActions'
import { ABDUCTED_EMOTE_URN, CENTER, COSTUME_COLLECTION, COSTUME_URNS } from '../layout'

/**
 * Four NPC avatars in the alien costumes dancing around the diorama, one of them
 * getting abducted on repeat. Click one to see its costume on the Marketplace.
 */

const BASE = 'urn:decentraland:off-chain:base-avatars'
const DANCES = ['dance', 'disco', 'tektonik', 'robot', 'handsair', 'tik', 'hammer', 'dab', 'fistpump', 'shrug']
const NAMES = ['Zorp', 'Blee', 'Gleep', 'Xanthe']
const RING = 7.5

interface Dancer {
  entity: Entity
  index: number
  timer: number
}

const dancers: Dancer[] = []

function createDancer(index: number): Dancer {
  const a = (index / 4) * Math.PI * 2 + Math.PI / 4
  const position = Vector3.create(CENTER.x + RING * Math.sin(a), 0, CENTER.z + RING * Math.cos(a))
  const entity = engine.addEntity()
  // Face the diorama in the middle.
  const yaw = (Math.atan2(CENTER.x - position.x, CENTER.z - position.z) * 180) / Math.PI
  Transform.create(entity, { position, rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })
  AvatarShape.create(entity, {
    id: `alien-${index}`,
    name: NAMES[index],
    bodyShape: index % 2 === 0 ? `${BASE}:BaseMale` : `${BASE}:BaseFemale`,
    wearables: [COSTUME_URNS[index], `${BASE}:eyes_00`, `${BASE}:eyebrows_00`, `${BASE}:mouth_00`],
    emotes: [ABDUCTED_EMOTE_URN],
    skinColor: { r: 0.45, g: 0.85, b: 0.5 },
    hairColor: { r: 0.1, g: 0.1, b: 0.12 },
    eyeColor: { r: 0.1, g: 0.1, b: 0.1 },
    expressionTriggerId: index === 0 ? ABDUCTED_EMOTE_URN : DANCES[index % DANCES.length],
    expressionTriggerTimestamp: Date.now()
  })

  // Avatars have no pointer collider of their own: an invisible pillar takes the click.
  const hit = engine.addEntity()
  Transform.create(hit, { parent: entity, position: Vector3.create(0, 1, 0), scale: Vector3.create(0.9, 2, 0.9) })
  MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: `${NAMES[index]}'s costume`, maxDistance: 10 } },
    () => {
      void openExternalUrl({ url: `https://decentraland.org/marketplace/contracts/${COSTUME_COLLECTION}/items/${index}` })
    }
  )

  return { entity, index, timer: 4 + index * 2.5 }
}

export function createAliens() {
  for (let i = 0; i < 4; i++) dancers.push(createDancer(i))

  engine.addSystem((dt) => {
    for (const d of dancers) {
      d.timer -= dt
      if (d.timer > 0) continue
      const shape = AvatarShape.getMutable(d.entity)
      if (d.index === 0) {
        // Zorp gets taken over and over. The emote is ~8 s long.
        shape.expressionTriggerId = ABDUCTED_EMOTE_URN
        d.timer = 9
      } else {
        shape.expressionTriggerId = DANCES[Math.floor(Math.random() * DANCES.length)]
        d.timer = 6 + Math.random() * 6
      }
      shape.expressionTriggerTimestamp = Date.now()
    }
  })
}
