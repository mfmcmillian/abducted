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
export const PANE_W = 2 * DOME_RADIUS * Math.sin(PANE_STEP / 2) - 0.6 // chord, clear of the mullions
export const PANE_Y = (PANE_BOTTOM + PANE_TOP) / 2

/** Root transform for a poster on the pane nearest the direction of `toward` from the centre. */
export function paneMount(toward: Vector3) {
  const angle = Math.atan2(toward.x - CENTER.x, toward.z - CENTER.z)
  const paneAngle = (Math.round(angle / PANE_STEP - 0.5) + 0.5) * PANE_STEP
  const r = DOME_RADIUS - 0.12
  const position = Vector3.create(CENTER.x + Math.sin(paneAngle) * r, 0, CENTER.z + Math.cos(paneAngle) * r)
  // Plane/Text fronts face local -Z, so add 180 to look toward the centre.
  const yaw = (Math.atan2(CENTER.x - position.x, CENTER.z - position.z) * 180) / Math.PI + 180
  return { position, rotation: Quaternion.fromEulerDegrees(0, yaw, 0) }
}
