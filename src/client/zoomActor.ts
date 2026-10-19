import { AvatarModifierArea, AvatarModifierType, AvatarShape, EasingFunction, engine, Entity, Transform, Tween } from '@dcl/sdk/ecs'
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

/**
 * One straight walk, moved by a Tween so the renderer interpolates it smoothly (updating the
 * Transform every frame makes avatars stutter). Positions are local to the double's parent.
 */
export interface Leg { e: Entity; from: Vector3; to: Vector3; duration: number; t: number }

export function beginLeg(e: Entity, to: Vector3, speed: number): Leg {
  const tr = Transform.getMutable(e)
  const from = Vector3.clone(tr.position)
  const flat = Vector3.create(to.x - from.x, 0, to.z - from.z)
  const d = Vector3.length(flat)
  if (d > 0.01) tr.rotation = Quaternion.lookRotation(Vector3.scale(flat, 1 / d), Vector3.Up())
  const duration = Math.max(0.05, d / speed)
  Tween.createOrReplace(e, { mode: Tween.Mode.Move({ start: from, end: Vector3.clone(to) }), duration: duration * 1000, easingFunction: EasingFunction.EF_LINEAR })
  return { e, from, to: Vector3.clone(to), duration, t: 0 }
}

/** Advance a leg; returns true once it is over (and the Transform then holds the end point). */
export function stepLeg(leg: Leg, dt: number): boolean {
  leg.t += dt
  if (leg.t < leg.duration) return false
  if (Tween.has(leg.e)) Tween.deleteFrom(leg.e)
  Transform.getMutable(leg.e).position = Vector3.clone(leg.to)
  return true
}

/** Where the double is right now along its leg. */
export const legPos = (leg: Leg) => Vector3.lerp(leg.from, leg.to, Math.min(1, leg.t / leg.duration))

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
