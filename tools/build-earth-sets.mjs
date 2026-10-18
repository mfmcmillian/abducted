// Generates models/earth-sky.glb, models/earth-sets.glb and models/earth-room.glb: the nested
// sets hidden inside the Earth model for the Earth zoom (src/client/earthZoom.ts). Origin = Earth
// centre, y up, the street side is -Z. The sky is its own file because it stays while the
// countryside / city / neighbourhood layers are swapped underneath it.
//
//   Sky         inverted sphere (normals inward) just under the Earth's surface; equirect UVs
//   Ground      lawn disc at GROUND_Y, planar UVs (one tile per 4 m)
//   Road        asphalt strip across the lawn at z = ROAD_Z, UVs along its length
//   Path        paving strip from the road to the front door
//   RoomFloor   living room floor, planks (one tile per 2 m)
//   RoomWalls   four walls, normals inward, with a window opening in the front (-Z) wall
//   RoomCeiling ceiling, normals down
//
// The room sits at the origin, front wall at z = -ROOM_D / 2. The scene positions the whole
// room entity so the opening lines up with the house model's picture window.
//
// Run: node tools/build-earth-sets.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshBuf, buildGlb } from './glb.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'models', 'earth-sets.glb')
const OUT_ROOM = resolve(__dirname, '..', 'models', 'earth-room.glb')
const OUT_SKY = resolve(__dirname, '..', 'models', 'earth-sky.glb')

export const SKY_R = 11.6
export const GROUND_Y = -4.2
export const ROAD_Z = -8.5
export const ROAD_W = 5
export const ROOM_W = 6.4 // x
export const ROOM_H = 3.2 // y
export const ROOM_D = 4.4 // z
// opening in the front wall: centred on x = WINDOW.x, matches the house model picture window
export const WINDOW = { x: 1.56, w: 1.2, h: 1.2, sill: 1.7 }

const TAU = Math.PI * 2
const groundR = Math.sqrt(SKY_R * SKY_R - GROUND_Y * GROUND_Y) - 0.3

// ---- sky: inverted UV sphere -------------------------------------------------------------
const sky = new MeshBuf('Sky', 0)
{
  const SEG = 48
  const RINGS = 24
  const rows = []
  for (let r = 0; r <= RINGS; r++) {
    const v = r / RINGS
    const lat = v * Math.PI - Math.PI / 2 // -90..90, v=1 at the top
    const y = Math.sin(lat) * SKY_R
    const rad = Math.cos(lat) * SKY_R
    const row = []
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG
      const a = u * TAU
      const p = [Math.sin(a) * rad, y, Math.cos(a) * rad]
      const n = [-p[0] / SKY_R, -p[1] / SKY_R, -p[2] / SKY_R]
      row.push(sky.vertex(p, n, [u, 1 - v]))
    }
    rows.push(row)
  }
  for (let r = 0; r < RINGS; r++) {
    for (let s = 0; s < SEG; s++) {
      const a = rows[r][s], b = rows[r][s + 1], c = rows[r + 1][s + 1], d = rows[r + 1][s]
      // inward facing winding
      sky.tri(a, c, b)
      sky.tri(a, d, c)
    }
  }
}

// ---- ground disc with planar UVs ---------------------------------------------------------
const ground = new MeshBuf('Ground', 1)
{
  const SEG = 64
  const TILE = 4
  const centre = ground.vertex([0, GROUND_Y, 0], [0, 1, 0], [0.5, 0.5])
  const rim = []
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * TAU
    const x = Math.sin(a) * groundR
    const z = Math.cos(a) * groundR
    rim.push(ground.vertex([x, GROUND_Y, z], [0, 1, 0], [0.5 + x / TILE, 0.5 + z / TILE]))
  }
  for (let i = 0; i < SEG; i++) ground.tri(centre, rim[i], rim[i + 1])
}

// ---- road and path -----------------------------------------------------------------------
const road = new MeshBuf('Road', 2)
{
  const y = GROUND_Y + 0.02
  const half = Math.sqrt(Math.max(0, groundR * groundR - ROAD_Z * ROAD_Z)) - 0.2
  const z0 = ROAD_Z - ROAD_W / 2, z1 = ROAD_Z + ROAD_W / 2
  // u runs along the road (x), v across it; texture repeats every 8 m
  const n = [0, 1, 0]
  const STEPS = 8
  for (let i = 0; i < STEPS; i++) {
    const xa = -half + (2 * half * i) / STEPS
    const xb = -half + (2 * half * (i + 1)) / STEPS
    const ua = (xa + half) / 8, ub = (xb + half) / 8
    const a = road.vertex([xa, y, z0], n, [ua, 0])
    const b = road.vertex([xb, y, z0], n, [ub, 0])
    const c = road.vertex([xb, y, z1], n, [ub, 1])
    const d = road.vertex([xa, y, z1], n, [ua, 1])
    road.tri(a, c, b)
    road.tri(a, d, c)
  }
}
const path = new MeshBuf('Path', 3)
{
  const y = GROUND_Y + 0.025
  const w = 1.2
  const z0 = ROAD_Z + ROAD_W / 2, z1 = -4.5 // road edge to the porch steps
  const n = [0, 1, 0]
  const a = path.vertex([-w / 2, y, z0], n, [0, 0])
  const b = path.vertex([w / 2, y, z0], n, [1, 0])
  const c = path.vertex([w / 2, y, z1], n, [1, (z1 - z0) / w])
  const d = path.vertex([-w / 2, y, z1], n, [0, (z1 - z0) / w])
  path.tri(a, b, c)
  path.tri(a, c, d)
}

// ---- living room --------------------------------------------------------------------------
const hw = ROOM_W / 2, hd = ROOM_D / 2
const floor = new MeshBuf('RoomFloor', 4)
{
  const n = [0, 1, 0]
  const T = 2
  const a = floor.vertex([-hw, 0, -hd], n, [0, 0])
  const b = floor.vertex([hw, 0, -hd], n, [ROOM_W / T, 0])
  const c = floor.vertex([hw, 0, hd], n, [ROOM_W / T, ROOM_D / T])
  const d = floor.vertex([-hw, 0, hd], n, [0, ROOM_D / T])
  floor.tri(a, b, c)
  floor.tri(a, c, d)
}
const ceiling = new MeshBuf('RoomCeiling', 5)
{
  const n = [0, -1, 0]
  const a = ceiling.vertex([-hw, ROOM_H, -hd], n, [0, 0])
  const b = ceiling.vertex([hw, ROOM_H, -hd], n, [1, 0])
  const c = ceiling.vertex([hw, ROOM_H, hd], n, [1, 1])
  const d = ceiling.vertex([-hw, ROOM_H, hd], n, [0, 1])
  ceiling.tri(a, c, b)
  ceiling.tri(a, d, c)
}
const walls = new MeshBuf('RoomWalls', 6)
{
  const T = 2 // wallpaper tile (m)
  // wall panel from (x0,z0) to (x1,z1), y from y0 to y1, normal n (inward), u along the run
  const panel = (p0, p1, y0, y1, n, u0) => {
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    const a = walls.vertex([p0[0], y0, p0[1]], n, [u0, y0 / T])
    const b = walls.vertex([p1[0], y0, p1[1]], n, [u0 + len / T, y0 / T])
    const c = walls.vertex([p1[0], y1, p1[1]], n, [u0 + len / T, y1 / T])
    const d = walls.vertex([p0[0], y1, p0[1]], n, [u0, y1 / T])
    // winding chosen so the face points along n: check with the cross product and flip if needed
    const e1 = [p1[0] - p0[0], 0, p1[1] - p0[1]]
    const e2 = [0, y1 - y0, 0]
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const dot = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]
    if (dot > 0) {
      walls.tri(a, b, c)
      walls.tri(a, c, d)
    } else {
      walls.tri(a, c, b)
      walls.tri(a, d, c)
    }
  }
  // back wall (+Z), normal -Z
  panel([hw, hd], [-hw, hd], 0, ROOM_H, [0, 0, -1], 0)
  // left wall (-X), normal +X
  panel([-hw, hd], [-hw, -hd], 0, ROOM_H, [1, 0, 0], 0)
  // right wall (+X), normal -X
  panel([hw, -hd], [hw, hd], 0, ROOM_H, [-1, 0, 0], 0)
  // front wall (-Z), normal +Z, with the window opening
  const wx0 = WINDOW.x - WINDOW.w / 2, wx1 = WINDOW.x + WINDOW.w / 2
  const wy0 = WINDOW.sill, wy1 = WINDOW.sill + WINDOW.h
  const n = [0, 0, 1]
  panel([-hw, -hd], [wx0, -hd], 0, ROOM_H, n, 0) // left of the window
  panel([wx1, -hd], [hw, -hd], 0, ROOM_H, n, (wx1 + hw) / T) // right of it
  panel([wx0, -hd], [wx1, -hd], 0, wy0, n, (wx0 + hw) / T) // under the sill
  panel([wx0, -hd], [wx1, -hd], wy1, ROOM_H, n, (wx0 + hw) / T) // above the head
  // window reveals (thickness 0.25 m toward the outside), plain
  const t = 0.25
  const reveal = new MeshBuf('WindowReveal', 5)
  const q = (p0, p1, p2, p3, nn) => reveal.quad(p0, p1, p2, p3, nn, true)
  q([wx0, wy0, -hd], [wx1, wy0, -hd], [wx1, wy0, -hd - t], [wx0, wy0, -hd - t], [0, 1, 0]) // sill
  q([wx0, wy1, -hd], [wx1, wy1, -hd], [wx1, wy1, -hd - t], [wx0, wy1, -hd - t], [0, -1, 0]) // head
  q([wx0, wy0, -hd], [wx0, wy1, -hd], [wx0, wy1, -hd - t], [wx0, wy0, -hd - t], [1, 0, 0]) // left jamb
  q([wx1, wy0, -hd], [wx1, wy1, -hd], [wx1, wy1, -hd - t], [wx1, wy0, -hd - t], [-1, 0, 0]) // right jamb
  walls.reveal = reveal
}

const materials = [
  { name: 'Sky', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, emissiveFactor: [1, 1, 1], doubleSided: false },
  { name: 'Lawn', pbrMetallicRoughness: { baseColorFactor: [0.45, 0.75, 0.3, 1], metallicFactor: 0, roughnessFactor: 1 } },
  { name: 'Road', pbrMetallicRoughness: { baseColorFactor: [0.25, 0.26, 0.28, 1], metallicFactor: 0, roughnessFactor: 1 } },
  { name: 'Path', pbrMetallicRoughness: { baseColorFactor: [0.7, 0.66, 0.6, 1], metallicFactor: 0, roughnessFactor: 1 } },
  { name: 'Wood', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.42, 0.25, 1], metallicFactor: 0, roughnessFactor: 0.7 } },
  { name: 'Plaster', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.94, 0.9, 1], metallicFactor: 0, roughnessFactor: 1 } },
  { name: 'Wallpaper', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.8, 0.7, 1], metallicFactor: 0, roughnessFactor: 1 } }
]

mkdirSync(dirname(OUT), { recursive: true })
for (const [out, meshes, name] of [
  [OUT_SKY, [sky], 'EarthSky'],
  [OUT, [ground, road, path], 'EarthSets'],
  [OUT_ROOM, [floor, ceiling, walls, walls.reveal], 'EarthRoom']
]) {
  const glb = buildGlb(meshes, materials, name, 'abducted-dome build-earth-sets.mjs')
  writeFileSync(out, glb)
  console.log(`wrote ${out} (${(glb.length / 1024).toFixed(1)} KB)`, meshes.map((m) => `${m.name}:${m.triCount}`).join(' '))
}
