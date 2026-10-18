import { Vector3 } from '@dcl/sdk/math'

/**
 * 12 x 12 parcels: 192 m square, closed dome in the middle. The extra ring outside the dome
 * exists so the observation-window pods (30 m deep on the diagonals) stay inside the scene
 * bounds. Keep in sync with tools/build-*.mjs.
 */
export const PLOT = 192
export const CENTER = Vector3.create(96, 0, 96)
export const DOME_RADIUS = 62
export const DOME_WALL = 20
/** Where players arrive: in the middle of the dome, directly under the diorama's ship. */
export const SPAWN = Vector3.create(96, 0, 96)

/** Height of the dome ceiling above a point at horizontal distance r from the centre. */
export function ceilingAt(r: number) {
  const c = Math.min(r, DOME_RADIUS - 0.5)
  return DOME_WALL + Math.sqrt(DOME_RADIUS * DOME_RADIUS - c * c)
}

/** Crop-circle formation centres in scene space (plaza.glb is centred on CENTER). All inside the dome. */
export const FORMATION = {
  NW: Vector3.create(CENTER.x - 26, 0, CENTER.z + 24),
  NE: Vector3.create(CENTER.x + 26, 0, CENTER.z + 24),
  SW: Vector3.create(CENTER.x - 30, 0, CENTER.z - 14),
  SE: Vector3.create(CENTER.x + 30, 0, CENTER.z - 14)
}

/** The launch pad: stand here 3 s and the saucer takes you to the cow game. */
export const LAUNCH_PAD = Vector3.create(CENTER.x - 12, 0, CENTER.z - 28)
/** Where the saucer drops you back after a round. */
export const LANDING = Vector3.create(CENTER.x - 5, 0, CENTER.z - 30)
/** Cargo bay: cows beamed up in the pasture wait here to be carried to the launcher. */
export const CARGO_BAY = Vector3.create(CENTER.x + 6, 0, CENTER.z - 36)
export const CARGO_BAY_RADIUS = 5
/** The cow launcher, aimed out through the observation deck. */
export const LAUNCHER = Vector3.create(CENTER.x + 18, 0, CENTER.z - 34)
/** Leaderboard panel next to the pad. */
export const LEADERBOARD = Vector3.create(CENTER.x - 21, 0, CENTER.z - 32)

/** The sky pasture where the cow game is played: a 100 m square floating above the dome. */
export const ARENA_Y = 88 // above the dome apex (82)
export const ARENA_SIZE = 100
export const ARENA_FLY_HEIGHT = 11 // player (as the saucer) hovers this far above the pasture
export const ROUND_SECONDS = 180

// "They appear to be enjoying it" music video, 720p30, hosted on the KOA Firebase project bucket.
export const VIDEO_URL = 'https://storage.googleapis.com/koa-db-media/alien-dome/enjoying-720p.mp4'
// 28 s portrait (9x16) explainer for the Antrom Guildstone Ring, shown on the poster by the altar.
export const RING_VIDEO_URL = 'https://storage.googleapis.com/koa-db-media/alien-dome/ring-explainer-720.mp4'

// Abducted! emote collection (Red / Purple / Green / Cyan) and the alien costume wearables.
export const EMOTE_COLLECTION = '0x95e2e9e7e8796e79fd7ebeff5b7ddc9879fbbc88'
export const COSTUME_COLLECTION = '0x36a8a03f5c048953b0ceda9e05755df3f1004ae8'
export const EMOTE_URL = `https://decentraland.org/marketplace/contracts/${EMOTE_COLLECTION}/items/2`
export const COSTUME_URL = `https://decentraland.org/marketplace/contracts/${COSTUME_COLLECTION}/items/0`
export const EMOTE_COLLECTION_URL = `https://decentraland.org/marketplace/collections/${EMOTE_COLLECTION}`
export const COSTUME_COLLECTION_URL = `https://decentraland.org/marketplace/collections/${COSTUME_COLLECTION}`
export const EMOTE_URNS = [0, 1, 2, 3].map((i) => `urn:decentraland:matic:collections-v2:${EMOTE_COLLECTION}:${i}`)
export const ABDUCTED_EMOTE_URN = EMOTE_URNS[2]
export const COSTUME_URNS = [0, 1, 2, 3].map((i) => `urn:decentraland:matic:collections-v2:${COSTUME_COLLECTION}:${i}`)

export const WORLD_DUNGEONS = 'dungeons.dcl.eth'

/** Horizontal distance between two points. */
export function flatDistance(a: Vector3, b: Vector3) {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}
