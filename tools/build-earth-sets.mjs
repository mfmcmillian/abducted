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
// models/earth-screen.glb
//   Tray        recessed box filling the hole tools/cut-hole.mjs cuts out of the TV's glass (TV model coords)
//   Screen      16:9 CRT face at the back of the tray, gently domed, 5 cm behind the bezel (TV model coords)
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
const OUT_SCREEN = resolve(__dirname, '..', 'models', 'earth-screen.glb')

export const SKY_R = 11.6
export const GROUND_Y = -4.2
export const ROAD_Z = -8.5
export const ROAD_W = 5
export const ROOM_W = 6.4 // x
export const ROOM_H = 3.2 // y
export const ROOM_D = 4.4 // z
// opening in the front wall: centred on x = WINDOW.x, matches the hole tools/cut-window.mjs cuts
// in the house model (glass x -0.57..-0.36, y -0.31..-0.08 in model units, house scale 4.6,
// yawed 180, room at x 0.6)
export const WINDOW = { x: 1.54, w: 0.96, h: 1.06, sill: 1.82 }
// the casements stand open this far past square, swung outward
export const SASH_OPEN_DEG = 105

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
  // seen from below: this winding faces -Y (the old one faced up and let you see the sky through the roof)
  ceiling.tri(a, b, c)
  ceiling.tri(a, c, d)
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

  // two casement sashes hinged on the jambs, swung outward (-Z) so the camera can fly in
  const frames = new MeshBuf('SashFrames', 5)
  const glass = new MeshBuf('SashGlass', 7)
  const th = Math.PI * (SASH_OPEN_DEG / 180)
  const sw = WINDOW.w / 2 - 0.01, sh = WINDOW.h, bar = 0.05, dep = 0.03
  for (const side of [-1, 1]) {
    const hx = side < 0 ? wx0 : wx1 // hinge x
    // sash axes: u along the sash (away from the hinge), v up, w the sash normal
    const dir = [-side * Math.cos(th), 0, -Math.sin(th)]
    const nrm = [dir[2], 0, -dir[0]]
    const P = (u, v, w) => [hx + u * dir[0] + w * nrm[0], wy0 + v, -hd + u * dir[2] + w * nrm[2]]
    // a box in sash coords u0..u1, v0..v1, thickness +-dep/2
    const box = (m, u0, u1, v0, v1) => {
      const c = [
        [u0, v0, -dep / 2], [u1, v0, -dep / 2], [u1, v1, -dep / 2], [u0, v1, -dep / 2],
        [u0, v0, dep / 2], [u1, v0, dep / 2], [u1, v1, dep / 2], [u0, v1, dep / 2]
      ].map((q) => P(...q))
      const N = (a) => [a[0] * nrm[0] + a[2] * dir[0], a[1], a[0] * nrm[2] + a[2] * dir[2]] // (w, v, u) -> world-ish
      m.quad(c[0], c[3], c[2], c[1], N([-1, 0, 0]), true) // back (-w)
      m.quad(c[4], c[5], c[6], c[7], N([1, 0, 0]), true) // front (+w)
      m.quad(c[0], c[1], c[5], c[4], [0, -1, 0], true) // bottom
      m.quad(c[3], c[7], c[6], c[2], [0, 1, 0], true) // top
      m.quad(c[0], c[4], c[7], c[3], N([0, 0, -1]), true) // hinge end
      m.quad(c[1], c[2], c[6], c[5], N([0, 0, 1]), true) // free end
    }
    box(frames, 0, sw, 0, bar) // bottom rail
    box(frames, 0, sw, sh - bar, sh) // top rail
    box(frames, 0, bar, bar, sh - bar) // hinge stile
    box(frames, sw - bar, sw, bar, sh - bar) // free stile
    box(frames, sw / 2 - bar / 4, sw / 2 + bar / 4, bar, sh - bar) // mullion
    box(frames, bar, sw - bar, sh / 2 - bar / 4, sh / 2 + bar / 4) // transom
    glass.quad(P(bar, bar, 0), P(sw - bar, bar, 0), P(sw - bar, sh - bar, 0), P(bar, sh - bar, 0), nrm, true)
  }
  walls.sashes = frames
  walls.glass = glass
}

// ---- CRT screen: a recessed tray in the hole cut out of the TV, in the TV's own model coords -----
// Both meshes are placed with the TV's Transform (position, yaw 180, scale 0.7), so hole, tray
// and face line up by construction. The TV's front is +Z here; its bezel face is at z ~0.46.
export const TV_HOLE = { x0: -0.82, x1: 0.44, y0: -0.42, y1: 0.34, zMin: 0.3 } // what cut-hole.mjs removes
const TRAY_INSET = 0.005, TRAY_FRONT = 0.455, TRAY_BACK = 0.37
export const TV_FACE = { w: 1.26, h: 1.26 * (9 / 16), cx: (TV_HOLE.x0 + TV_HOLE.x1) / 2, cy: (TV_HOLE.y0 + TV_HOLE.y1) / 2, zEdge: TRAY_BACK + 0.001, bulge: 0.039 }

const tray = new MeshBuf('Tray', 9)
{
  const x0 = TV_HOLE.x0 + TRAY_INSET, x1 = TV_HOLE.x1 - TRAY_INSET, y0 = TV_HOLE.y0 + TRAY_INSET, y1 = TV_HOLE.y1 - TRAY_INSET
  const zf = TRAY_FRONT, zb = TRAY_BACK
  const q = (a, b, c, d, n) => tray.quad(a, b, c, d, n, true)
  q([x0, y0, zb], [x1, y0, zb], [x1, y1, zb], [x0, y1, zb], [0, 0, 1]) // back plate
  q([x0, y0, zf], [x1, y0, zf], [x1, y0, zb], [x0, y0, zb], [0, 1, 0]) // bottom wall
  q([x0, y1, zf], [x1, y1, zf], [x1, y1, zb], [x0, y1, zb], [0, -1, 0]) // top wall
  q([x0, y0, zf], [x0, y1, zf], [x0, y1, zb], [x0, y0, zb], [1, 0, 0]) // left wall
  q([x1, y0, zf], [x1, y1, zf], [x1, y1, zb], [x1, y0, zb], [-1, 0, 0]) // right wall
}

const screen = new MeshBuf('Screen', 8)
{
  const NX = 24, NY = 16
  const { w, h, cx, cy, zEdge, bulge } = TV_FACE
  const P = []
  const idx = []
  for (let j = 0; j <= NY; j++) {
    const row = []
    const v = j / NY, ny = 2 * v - 1
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, nx = 2 * u - 1
      // domed toward the viewer (+Z): zEdge at the corners, zEdge + bulge at the centre
      const z = zEdge + bulge * (1 - 0.5 * (nx * nx + ny * ny))
      const dzu = -bulge * nx * 2, dzv = -bulge * ny * 2 // dz/dnx, dz/dny
      const n = [-dzu, -dzv, 1]
      const l = Math.hypot(...n)
      // u runs with +x, v = 0 at the top (glTF texture origin)
      const p = [cx + (u - 0.5) * w, cy + (0.5 - v) * h, z]
      P.push(p)
      row.push(screen.vertex(p, n.map((c) => c / l), [u, v]))
    }
    idx.push(row)
  }
  const faceOut = (a, b, c) => {
    const [pa, pb, pc] = [P[a], P[b], P[c]]
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]
    const nz = e1[0] * e2[1] - e1[1] * e2[0]
    if (nz > 0) screen.tri(a, b, c)
    else screen.tri(a, c, b)
  }
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const a = idx[j][i], b = idx[j][i + 1], c = idx[j + 1][i + 1], d = idx[j + 1][i]
      faceOut(a, b, c)
      faceOut(a, c, d)
    }
  }
}

const materials = [
  { name: 'Sky', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, emissiveFactor: [1, 1, 1], doubleSided: false },
  { name: 'Lawn', pbrMetallicRoughness: { baseColorFactor: [0.45, 0.75, 0.3, 1], metallicFactor: 0, roughnessFactor: 1 } },
  { name: 'Road', pbrMetallicRoughness: { baseColorFactor: [0.25, 0.26, 0.28, 1], metallicFactor: 0, roughnessFactor: 1 } },
  { name: 'Path', pbrMetallicRoughness: { baseColorFactor: [0.7, 0.66, 0.6, 1], metallicFactor: 0, roughnessFactor: 1 } },
  // the room shell is double sided: the camera is always inside it, and nothing may show through
  { name: 'Wood', pbrMetallicRoughness: { baseColorFactor: [0.6, 0.42, 0.25, 1], metallicFactor: 0, roughnessFactor: 0.7 }, doubleSided: true },
  { name: 'Plaster', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.94, 0.9, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true },
  { name: 'Wallpaper', pbrMetallicRoughness: { baseColorFactor: [0.85, 0.8, 0.7, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true },
  { name: 'Glass', pbrMetallicRoughness: { baseColorFactor: [0.75, 0.85, 0.95, 0.3], metallicFactor: 0, roughnessFactor: 0.1 }, alphaMode: 'BLEND', doubleSided: true },
  { name: 'Screen', pbrMetallicRoughness: { baseColorFactor: [0.08, 0.08, 0.09, 1], metallicFactor: 0, roughnessFactor: 0.3 } },
  { name: 'Tray', pbrMetallicRoughness: { baseColorFactor: [0.03, 0.03, 0.035, 1], metallicFactor: 0, roughnessFactor: 0.9 } }
]

mkdirSync(dirname(OUT), { recursive: true })
for (const [out, meshes, name] of [
  [OUT_SKY, [sky], 'EarthSky'],
  [OUT, [ground, road, path], 'EarthSets'],
  [OUT_ROOM, [floor, ceiling, walls, walls.reveal, walls.sashes, walls.glass], 'EarthRoom'],
  [OUT_SCREEN, [tray, screen], 'EarthScreen']
]) {
  const glb = buildGlb(meshes, materials, name, 'abducted-dome build-earth-sets.mjs')
  writeFileSync(out, glb)
  console.log(`wrote ${out} (${(glb.length / 1024).toFixed(1)} KB)`, meshes.map((m) => `${m.name}:${m.triCount}`).join(' '))
}
