import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

/** The whole scene (dome, plaza, space) hangs under ROOT, FLOOR_Y above the parcel ground. */
export const FLOOR_Y = 10
export const ROOT = engine.addEntity()
Transform.create(ROOT, { position: Vector3.create(0, FLOOR_Y, 0) })

/** Player/camera positions arrive in world space; this takes them into scene (ROOT-local) space. */
export const toScene = (v: Vector3) => Vector3.create(v.x, v.y - FLOOR_Y, v.z)
/** Scene-space point to world space, for movePlayerTo and friends. */
export const sceneToWorld = (v: Vector3) => Vector3.create(v.x, v.y + FLOOR_Y, v.z)
