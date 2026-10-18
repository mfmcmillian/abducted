import { engine, InputAction, inputSystem, PrimaryPointerInfo, UiCanvasInformation } from '@dcl/sdk/ecs'

/**
 * Click-and-hold to move a UI window (same approach as the Antrom ring menus): mouse-down on
 * the window's title arms a drag, then a system follows PrimaryPointerInfo.screenCoordinates
 * until the pointer is released. Offsets are fractions of the canvas so the layout survives a
 * resolution change; a double tap on the title snaps the window back to its home spot.
 */
export type DragId = 'kudos'
type Offset = { x: number; y: number }
const LIMIT = 0.48
const DOUBLE_TAP_MS = 350

const layout: Record<DragId, Offset> = { kudos: { x: 0, y: 0 } }
const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-LIMIT, Math.min(LIMIT, v)) : 0)

export function canvasSize(): { w: number; h: number } {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  return { w: canvas?.width || 1920, h: canvas?.height || 1080 }
}

/** Current offset of a window in canvas pixels. */
export function dragOffsetPx(id: DragId): { dx: number; dy: number } {
  const { w, h } = canvasSize()
  return { dx: layout[id].x * w, dy: layout[id].y * h }
}

function pointer(): { x: number; y: number } | null {
  const info = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const p = info?.screenCoordinates
  if (!p) return null
  const ratio = UiCanvasInformation.getOrNull(engine.RootEntity)?.devicePixelRatio || 1
  return { x: p.x / ratio, y: p.y / ratio }
}

let active: { id: DragId; startX: number; startY: number; baseX: number; baseY: number } | null = null
let lastTap: { id: DragId; at: number } | null = null

export function startDrag(id: DragId) {
  const now = Date.now()
  if (lastTap && lastTap.id === id && now - lastTap.at < DOUBLE_TAP_MS) {
    lastTap = null
    active = null
    layout[id] = { x: 0, y: 0 }
    return
  }
  lastTap = { id, at: now }
  const p = pointer()
  if (!p) return
  active = { id, startX: p.x, startY: p.y, baseX: layout[id].x, baseY: layout[id].y }
}

export const isDragging = () => active !== null

engine.addSystem(() => {
  if (!active) return
  if (!inputSystem.isPressed(InputAction.IA_POINTER)) {
    active = null
    return
  }
  const p = pointer()
  if (!p) return
  const { w, h } = canvasSize()
  layout[active.id] = { x: clamp(active.baseX + (p.x - active.startX) / w), y: clamp(active.baseY + (p.y - active.startY) / h) }
})
