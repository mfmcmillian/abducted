import { Vector3 } from '@dcl/sdk/math'

/** 4 x 4 parcels: 64 m square, dome in the middle. Keep in sync with tools/build-*.mjs. */
export const PLOT = 64
export const CENTER = Vector3.create(32, 0, 32)
export const DOME_RADIUS = 22
export const DOME_WALL = 6
/** The south door of the dome (dome centre minus radius along z). */
export const DOOR = Vector3.create(32, 0, 32 - DOME_RADIUS)

/** Crop-circle formation centres in scene space (plaza.glb is centred on CENTER). */
export const FORMATION = {
  NW: Vector3.create(CENTER.x - 23, 0, CENTER.z + 23),
  NE: Vector3.create(CENTER.x + 23, 0, CENTER.z + 23),
  SW: Vector3.create(CENTER.x - 23, 0, CENTER.z - 21),
  SE: Vector3.create(CENTER.x + 23, 0, CENTER.z - 21)
}

// "They appear to be enjoying it" music video, 720p30, hosted on the KOA Firebase project bucket.
export const VIDEO_URL = 'https://storage.googleapis.com/koa-db-media/alien-dome/enjoying-720p.mp4'

// Abducted! emote collection (Red / Purple / Green / Cyan) and the alien costume wearables.
export const EMOTE_COLLECTION = '0x95e2e9e7e8796e79fd7ebeff5b7ddc9879fbbc88'
export const COSTUME_COLLECTION = '0x36a8a03f5c048953b0ceda9e05755df3f1004ae8'
export const EMOTE_URL = `https://decentraland.org/marketplace/contracts/${EMOTE_COLLECTION}/items/2`
export const COSTUME_URL = `https://decentraland.org/marketplace/contracts/${COSTUME_COLLECTION}/items/0`
export const EMOTE_COLLECTION_URL = `https://decentraland.org/marketplace/collections/${EMOTE_COLLECTION}`
export const COSTUME_COLLECTION_URL = `https://decentraland.org/marketplace/collections/${COSTUME_COLLECTION}`
export const ABDUCTED_EMOTE_URN = `urn:decentraland:matic:collections-v2:${EMOTE_COLLECTION}:2`
export const COSTUME_URNS = [0, 1, 2, 3].map((i) => `urn:decentraland:matic:collections-v2:${COSTUME_COLLECTION}:${i}`)

export const WORLD_DUNGEONS = 'dungeons.dcl.eth'
export const WORLD_KOA = 'KoA.dcl.eth'

/** Horizontal distance between two points. */
export function flatDistance(a: Vector3, b: Vector3) {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}
