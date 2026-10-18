import { Vector3 } from '@dcl/sdk/math'

/**
 * Where everything in the Earth-zoom sets sits. Pure numbers, no engine: shared by the scene
 * code (earthZoom.ts), the camera path (zoomPath.ts) and the offline path dump (tools/zoom-dump.mjs).
 *
 * Spaces used throughout:
 *   set   - origin at the Earth's centre, scaled by SET_SCALE into the world
 *   town  - the street set's own metres (origin under the hero house); sits on the countryside
 *           at EMBED scale before the swap and at full size after it
 *   room  - town-local, offset by ROOM_POS
 */

// ---- layout (set coordinates: street along X on the -Z side) ----
export const GROUND_Y = -4.2 // keep in sync with tools/build-earth-sets.mjs
/** The set is authored for a 11.6 m sky sphere; the Earth's ocean is at ~11.2 m, so shrink the lot to stay inside it. */
export const SET_SCALE = 0.8
export const ROAD_Z = -8.5
export const HOUSE_SCALE = 4.6
// NOTE: the explorer mirrors glTF content in X (right- to left-handed), so anything measured in a
// model's own coordinates lands at -x in the scene. Scene-side placements below already account for it.
export const ROOM_POS = Vector3.create(-0.6, GROUND_Y + 0.04, 1.23) // room front wall lands on the house front wall (z = -0.97)
export const WINDOW_C = Vector3.create(-2.14, GROUND_Y + 2.35, -0.97) // centre of the (open) picture window: see tools/cut-window.mjs
export const ROOM_H = 3.2
// room coordinates (origin: room centre on the floor)
export const TV_SCALE = 0.7
export const TV_POS = Vector3.create(0.4, 0.6 + 0.811 * TV_SCALE, 1.75)
// The TV's baked glass (model x -0.82..0.44, y -0.42..0.34, domed to z 0.48, proud of the bezel at
// 0.46) is cut out by tools/cut-hole.mjs; models/earth-screen.glb puts a recessed tray in the hole
// with a 16:9 face at its back, domed from z 0.371 to 0.41 (keep in sync with tools/build-earth-sets.mjs
// TV_HOLE / TV_FACE). The face centre in room coords: the TV is yawed 180 and the explorer mirrors X,
// so model x keeps its sign and model z flips.
const TV_FACE_MODEL = Vector3.create(-0.19, -0.04, 0.41)
export const TV_SCREEN = Vector3.create(TV_POS.x + TV_FACE_MODEL.x * TV_SCALE, TV_POS.y + TV_FACE_MODEL.y * TV_SCALE, TV_POS.z - TV_FACE_MODEL.z * TV_SCALE) // faces -Z
export const TV_SCREEN_SIZE = { w: 1.26 * TV_SCALE, h: 1.26 * (9 / 16) * TV_SCALE }
/** Distance at which the screen exactly fills a 60 degree (16:9) view, plus a hair of margin. */
export const FIT_DISTANCE = Math.max(TV_SCREEN_SIZE.h / 2 / Math.tan(Math.PI / 6), TV_SCREEN_SIZE.w / 2 / (Math.tan(Math.PI / 6) * (16 / 9))) * 1.04

// ---- nesting (set coords unless stated) ----
export const COUNTRY_SCALE = 11
export const CITY_SCALE = 2 // the downtown diorama as a town on the countryside
export const EMBED = 0.25 // the street set's scale when it sits on the countryside
/** The countryside's flat fields are ~0.13 model units above its bbox bottom; lift the layer so they are at y = 0. */
export const TERRAIN_LOCAL_Y = GROUND_Y + 0.13 * COUNTRY_SCALE
export const AERIAL_LIFT = Vector3.create(0, -TERRAIN_LOCAL_Y, 0)
/** Where the street set's ground centre sits on the countryside (a flat field; countryside yawed 180). */
export const PATCH = Vector3.create(0, 0.15, -6.3)
/** The downtown diorama's position on the countryside (set coords). */
export const CITY_POS = Vector3.create(0.5, 0.5, -1)
/** The camera's first street-set key (town-local coords): over the road, 5.7 m up, looking 70 degrees down. */
export const TOWN_Q0 = Vector3.create(-0.8, 1.5, -8.5)
export const TOWN_LOOK0 = Vector3.create(-0.6, GROUND_Y, -6.4)
/** town-local -> set while embedded: set = TOWN_EMBED_POS + EMBED * q */
export const TOWN_EMBED_POS = Vector3.subtract(PATCH, Vector3.scale(Vector3.create(0, GROUND_Y, 0), EMBED))
/** camera position (set coords) at the swap */
export const SWAP_POS = Vector3.add(TOWN_EMBED_POS, Vector3.scale(TOWN_Q0, EMBED))
/** town-local -> set at full size, scaled up around SWAP_POS: set = TOWN_FULL_POS + q */
export const TOWN_FULL_POS = Vector3.subtract(SWAP_POS, TOWN_Q0)
