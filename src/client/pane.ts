import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS, DOME_WALL } from '../layout'

/**
 * The observation deck's window panes: 128 wall columns with a mullion every 4 => 32 panes
 * of 11.25 degrees, glass from ring 2 to ring 9 of 10 (tools/build-dome-pods.mjs).
 * Posters mounted on a pane fill it mullion to mullion, sill to head.
 */
const PANE_STEP = (Math.PI * 2) / 32
export const PANE_BOTTOM = DOME_WALL * 0.2
export const PANE_TOP = DOME_WALL * 0.9
export const PANE_H = PANE_TOP - PANE_BOTTOM - 0.1
/** Width of a flat poster spanning `panes` adjacent panes: the chord, clear of the end mullions. */
export const paneWidth = (panes = 1) => 2 * DOME_RADIUS * Math.sin((panes * PANE_STEP) / 2) - 0.6
export const PANE_W = paneWidth(1)
export const PANE_Y = (PANE_BOTTOM + PANE_TOP) / 2

/**
 * Root transform for a flat poster over the `panes` panes nearest the direction of `toward`
 * from the centre. An odd count centres on a pane, an even count on the mullion between two.
 * The poster is pulled in just enough that its edges stay inside the glass (and in front of
 * any mullion it covers).
 */
/**
 * A spot beside a poster: `lateral` metres along the poster's face from its centre, pulled in
 * from the glass so it sits `radius` from the dome centre (the walk barrier is at DOME_RADIUS - 4).
 * Returns the point in the mount's local frame (x along the face, -z toward the centre).
 */
export function besidePaneLocal(mount: { position: Vector3 }, lateral: number, radius: number) {
  const rm = Math.hypot(mount.position.x - CENTER.x, mount.position.z - CENTER.z)
  const depth = rm - Math.sqrt(Math.max(0, radius * radius - lateral * lateral))
  return Vector3.create(lateral, 0, -depth)
}

/** Same spot in world (scene) coordinates. */
export function besidePane(mount: { position: Vector3; rotation: Quaternion }, lateral: number, radius: number) {
  return Vector3.add(mount.position, Vector3.rotate(besidePaneLocal(mount, lateral, radius), mount.rotation))
}

export function paneMount(toward: Vector3, panes = 1) {
  const angle = Math.atan2(toward.x - CENTER.x, toward.z - CENTER.z)
  const half = panes % 2 ? 0.5 : 0
  const paneAngle = (Math.round(angle / PANE_STEP - half) + half) * PANE_STEP
  const w = paneWidth(panes)
  const rim = DOME_RADIUS - 0.12
  const r = Math.sqrt(rim * rim - (w / 2) * (w / 2))
  const position = Vector3.create(CENTER.x + Math.sin(paneAngle) * r, 0, CENTER.z + Math.cos(paneAngle) * r)
  // Plane/Text fronts face local -Z, so add 180 to look toward the centre.
  const yaw = (Math.atan2(CENTER.x - position.x, CENTER.z - position.z) * 180) / Math.PI + 180
  return { position, rotation: Quaternion.fromEulerDegrees(0, yaw, 0) }
}
