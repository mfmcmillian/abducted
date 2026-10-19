import { AvatarModifierArea, AvatarModifierType, AvatarShape, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { ROOT } from './root'

/**
 * A stand-in for the player during the Earth zoom: an AvatarShape dressed in their wearables that
 * walks to the pod (and, on Earth, up to the window) while the real avatar is locked and hidden
 * under a small HIDE_AVATARS area where they stand.
 */

const BASE = 'urn:decentraland:off-chain:base-avatars'
const DEFAULT_WEARABLES = [`${BASE}:eyes_00`, `${BASE}:eyebrows_00`, `${BASE}:mouth_00`, `${BASE}:blue_tshirt`, `${BASE}:brown_pants`, `${BASE}:classic_shoes`]

let hideArea: Entity | null = null

/** Spawn the player's double at `position` (local to `parent`), facing `yaw` degrees. */
export function spawnDouble(parent: Entity, position: Vector3, yaw: number, scale = 1): Entity {
  const p = getPlayer()
  const e = engine.addEntity()
  Transform.create(e, { parent, position: Vector3.clone(position), rotation: Quaternion.fromEulerDegrees(0, yaw, 0), scale: Vector3.create(scale, scale, scale) })
  AvatarShape.create(e, {
    id: `double-${e}`,
    name: '',
    bodyShape: p?.avatar?.bodyShapeUrn || `${BASE}:BaseMale`,
    wearables: p?.wearables?.length ? [...p.wearables] : DEFAULT_WEARABLES,
    emotes: [],
    skinColor: p?.avatar?.skinColor,
    hairColor: p?.avatar?.hairColor,
    eyeColor: p?.avatar?.eyesColor
  })
  return e
}

/** Step the double toward `target` at `speed` (units/s), turning to face the way it walks. True when it has arrived. */
export function walkDouble(e: Entity, target: Vector3, speed: number, dt: number): boolean {
  const tr = Transform.getMutable(e)
  const to = Vector3.subtract(target, tr.position)
  to.y = 0
  const d = Vector3.length(to)
  if (d < 0.05) return true
  const step = Math.min(d, speed * dt)
  const dir = Vector3.scale(to, 1 / d)
  tr.position = Vector3.add(tr.position, Vector3.scale(dir, step))
  tr.rotation = Quaternion.slerp(tr.rotation, Quaternion.lookRotation(dir, Vector3.Up()), Math.min(1, dt * 8))
  return step >= d - 1e-4
}

/** Hide the real avatar where it stands (scene coords) for the duration. */
export function hidePlayerAt(position: Vector3) {
  unhidePlayer()
  hideArea = engine.addEntity()
  Transform.create(hideArea, { parent: ROOT, position: Vector3.create(position.x, position.y + 1, position.z) })
  AvatarModifierArea.create(hideArea, { area: Vector3.create(3, 4, 3), modifiers: [AvatarModifierType.AMT_HIDE_AVATARS], excludeIds: [] })
}

export function unhidePlayer() {
  if (hideArea) engine.removeEntity(hideArea)
  hideArea = null
}
