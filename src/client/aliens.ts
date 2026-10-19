import { AvatarShape, engine, Entity, InputAction, MeshCollider, pointerEventsSystem, ColliderLayer, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { openExternalUrl } from '~system/RestrictedActions'
import { ABDUCTED_EMOTE_URN, CENTER, COSTUME_COLLECTION, COSTUME_URNS, FORMATION } from '../layout'
import { ROOT } from './root'
import { t } from './i18n'

/**
 * Eight NPC avatars in the alien costumes dance in front of the Dungeons of Antrom
 * portal, making it clear where the suits come from. Click one to see its costume.
 */

const BASE = 'urn:decentraland:off-chain:base-avatars'
/** The choreography: every dancer runs the same routine in lockstep, ending with all eight abducted. */
const ROUTINE: Array<[string, number]> = [
  ['dance', 8],
  ['disco', 8],
  ['tektonik', 8],
  ['robot', 8],
  ['handsair', 6],
  ['tik', 8],
  ['dab', 4],
  [ABDUCTED_EMOTE_URN, 9.5]
]
const NAMES = ['Zorp', 'Blee', 'Gleep', 'Xanthe', 'Mox', 'Luma', 'Quib', 'Vexa']

interface Dancer {
  entity: Entity
  index: number
}

const dancers: Dancer[] = []

function createDancer(index: number): Dancer {
  const portal = FORMATION.NW
  const dx = CENTER.x - portal.x
  const dz = CENTER.z - portal.z
  const length = Math.sqrt(dx * dx + dz * dz)
  const forwardX = dx / length
  const forwardZ = dz / length
  const rightX = forwardZ
  const rightZ = -forwardX
  const row = Math.floor(index / 4)
  const across = (index % 4 - 1.5) * 2.4
  const depth = 5 + row * 3
  const position = Vector3.create(portal.x + forwardX * depth + rightX * across, 0, portal.z + forwardZ * depth + rightZ * across)
  const entity = engine.addEntity()
  const costume = index % COSTUME_URNS.length
  // Face visitors approaching from the middle of the dome.
  const yaw = (Math.atan2(CENTER.x - position.x, CENTER.z - position.z) * 180) / Math.PI
  Transform.create(entity, { parent: ROOT, position, rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })
  AvatarShape.create(entity, {
    id: `alien-${index}`,
    name: NAMES[index],
    bodyShape: index % 2 === 0 ? `${BASE}:BaseMale` : `${BASE}:BaseFemale`,
    wearables: [COSTUME_URNS[costume], `${BASE}:eyes_00`, `${BASE}:eyebrows_00`, `${BASE}:mouth_00`],
    emotes: [ABDUCTED_EMOTE_URN],
    skinColor: { r: 0.45, g: 0.85, b: 0.5 },
    hairColor: { r: 0.1, g: 0.1, b: 0.12 },
    eyeColor: { r: 0.1, g: 0.1, b: 0.1 },
    expressionTriggerId: ROUTINE[0][0],
    expressionTriggerTimestamp: 1
  })

  // Avatars have no pointer collider of their own: an invisible pillar takes the click.
  const hit = engine.addEntity()
  Transform.create(hit, { parent: entity, position: Vector3.create(0, 1, 0), scale: Vector3.create(0.9, 2, 0.9) })
  MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: t("{0}'s costume", NAMES[index]), maxDistance: 10 } },
    () => {
      void openExternalUrl({ url: `https://decentraland.org/marketplace/contracts/${COSTUME_COLLECTION}/items/${costume}` })
    }
  )

  return { entity, index }
}

export function createAliens() {
  for (let i = 0; i < NAMES.length; i++) dancers.push(createDancer(i))

  // One clock for the whole troupe: every step is triggered on the same frame with the
  // same timestamp so the eight of them stay in sync.
  let step = 0
  let timer = 1.5 // let the costumes load before the first cue
  engine.addSystem((dt) => {
    timer -= dt
    if (timer > 0) return
    step = (step + 1) % ROUTINE.length
    const [emote, seconds] = ROUTINE[step]
    timer = seconds
    const stamp = Date.now()
    for (const d of dancers) {
      const shape = AvatarShape.getMutable(d.entity)
      shape.expressionTriggerId = emote
      shape.expressionTriggerTimestamp = stamp
    }
  })
}
