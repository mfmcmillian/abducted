// Generates models/dome.glb: a closed, inside-out video dome for the 8x8 World build.
//
// Geometry is centred on the local origin; the scene places it at (64, 0, 64).
// Nodes (all root level, so GltfNodeModifiers paths are just the names):
//   DomeInner   - cap facing inward, video plays on it
//   WallMachine - machinery strips below the sill and above the head of the window ring
//   WindowGlass - tinted panes all the way around
//   WindowFrame - head/sill reveals, face bands and mullions
//   SpaceBack0..3 - curved back wall of the star ring, 8 sectors cycling 4 space pictures
//   SpaceStars  - top and bottom of the star ring (tileable starfield)
//   PodHull     - outside skin of the star ring (seen from the sky pasture)
//   DomeOuter   - slightly larger shell facing outward, video plays on it too
// Windows and pods are built in build-dome-pods.mjs.
//   DoorFrame  - only when CLOSED is false: dark jambs + lintel around the door
//   Floor      - dark grass disc
//
// UV layout on both shells: u runs 0..1 on the east half and 1..0 (mirrored) on the
// west half, so the two video copies meet edge-to-edge with no visible seam at north or
// south, v runs 0 at the floor to 1 at the apex along the
// arc length, so the picture climbs the wall and pinches at the top.
//
// Run: node tools/build-dome.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshBuf, buildGlb } from './glb.mjs'
import { makeWindowBuilders } from './build-dome-pods.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'models', 'dome.glb')

// ---- parameters -----------------------------------------------------------
export const RADIUS = 62 // inner radius (m); centred on the 192 m plot, the star ring reaches 92 m
const SHELL_GAP = 0.08 // outer shell = RADIUS + SHELL_GAP
export const WALL_HEIGHT = 20 // vertical wall before the hemispherical cap (apex at 82 m, cap is 120 m for 64 parcels)
const SEGMENTS = 128 // around (must be even: two video wraps)
const WALL_RINGS = 10 // 2 m each
const CAP_RINGS = 24
const CLOSED = true // no door: once you are in, you are in
const DOOR_AZIMUTH_DEG = 180 // south, toward the spawn
const DOOR_QUADS = CLOSED ? 0 : 4
const DOOR_RINGS = 4 // 4 m tall (wall rings are 1 m)
const FLOOR_Y = 0.03

const TAU = Math.PI * 2
const HALF = SEGMENTS / 2
const CAP_ARC = (Math.PI / 2) * RADIUS
const TOTAL_ARC = WALL_HEIGHT + CAP_ARC
const RING_COUNT = WALL_RINGS + CAP_RINGS // number of quad rows

// Door quads: columns [doorStart, doorStart + DOOR_QUADS)
const doorCenterCol = Math.round((DOOR_AZIMUTH_DEG / 360) * SEGMENTS)
const doorStart = doorCenterCol - DOOR_QUADS / 2
const doorEnd = doorStart + DOOR_QUADS // exclusive
const isDoorQuad = (col, ring) => ring < DOOR_RINGS && col >= doorStart && col < doorEnd

/** Profile point for ring index k (0 = floor, RING_COUNT = apex) at a given radius. */
function profile(k, radius) {
  if (k <= WALL_RINGS) {
    const y = (k / WALL_RINGS) * WALL_HEIGHT
    return { r: radius, y, v: y / TOTAL_ARC }
  }
  const t = (k - WALL_RINGS) / CAP_RINGS // 0..1 over the cap
  const a = t * (Math.PI / 2)
  return {
    r: radius * Math.cos(a),
    y: WALL_HEIGHT + radius * Math.sin(a),
    v: (WALL_HEIGHT + a * radius) / TOTAL_ARC
  }
}

/**
 * Build a shell. inward=true flips normals and winding so the surface renders
 * from inside the dome.
 */
function buildShell(name, radius, inward, opts = {}) {
  const { kStart = 0, kEnd = RING_COUNT, uv = null, material = 0, skip = isDoorQuad } = opts
  const m = new MeshBuf(name, material)
  // Two halves, each with HALF+1 columns so the UV seam vertices are duplicated.
  const grid = [] // grid[half][col][ring] => vertex index
  for (let h = 0; h < 2; h++) {
    grid.push([])
    for (let j = 0; j <= HALF; j++) {
      const col = h * HALF + j
      const theta = (col / SEGMENTS) * TAU
      const sx = Math.sin(theta)
      const cz = Math.cos(theta)
      // Second half is mirrored (u runs 1..0) so both seams join identical picture edges.
      const u = h === 0 ? j / HALF : 1 - j / HALF
      const colVerts = []
      for (let k = 0; k < kStart; k++) colVerts.push(-1)
      for (let k = kStart; k <= kEnd; k++) {
        const { r, y, v } = profile(k, radius)
        const p = [r * sx, y, r * cz]
        let n
        if (k <= WALL_RINGS) n = [sx, 0, cz]
        else {
          const t = (k - WALL_RINGS) / CAP_RINGS
          const a = t * (Math.PI / 2)
          n = [Math.cos(a) * sx, Math.sin(a), Math.cos(a) * cz]
        }
        if (inward) n = n.map((c) => -c)
        colVerts.push(m.vertex(p, n, uv ? uv({ col, k, u, v, y, theta }) : [u, 1 - v]))
      }
      grid[h].push(colVerts)
    }
  }
  for (let h = 0; h < 2; h++) {
    for (let j = 0; j < HALF; j++) {
      const col = h * HALF + j
      for (let k = kStart; k < kEnd; k++) {
        if (skip(col, k)) continue
        const a = grid[h][j][k]
        const b = grid[h][j + 1][k]
        const c = grid[h][j + 1][k + 1]
        const d = grid[h][j][k + 1]
        const last = k === RING_COUNT - 1 // top ring collapses to the apex
        if (inward) {
          m.tri(a, c, b)
          if (!last) m.tri(a, d, c)
        } else {
          m.tri(a, b, c)
          if (!last) m.tri(a, c, d)
        }
      }
    }
  }
  return m
}

function buildDoorFrame() {
  const m = new MeshBuf('DoorFrame', 1)
  const rIn = RADIUS
  const rOut = RADIUS + SHELL_GAP
  const yTop = (DOOR_RINGS / WALL_RINGS) * WALL_HEIGHT
  const thetaL = (doorStart / SEGMENTS) * TAU
  const thetaR = (doorEnd / SEGMENTS) * TAU
  const at = (theta, r, y) => [r * Math.sin(theta), y, r * Math.cos(theta)]
  // jambs
  m.quad(at(thetaL, rIn, 0), at(thetaL, rOut, 0), at(thetaL, rOut, yTop), at(thetaL, rIn, yTop), [Math.cos(thetaL), 0, -Math.sin(thetaL)], true)
  m.quad(at(thetaR, rIn, 0), at(thetaR, rOut, 0), at(thetaR, rOut, yTop), at(thetaR, rIn, yTop), [-Math.cos(thetaR), 0, Math.sin(thetaR)], true)
  // lintel, one quad per door column so it follows the curve
  for (let c = doorStart; c < doorEnd; c++) {
    const t0 = (c / SEGMENTS) * TAU
    const t1 = ((c + 1) / SEGMENTS) * TAU
    m.quad(at(t0, rIn, yTop), at(t1, rIn, yTop), at(t1, rOut, yTop), at(t0, rOut, yTop), [0, -1, 0], true)
  }
  return m
}

// Floor disc with planar UVs (one texture tile per FLOOR_TILE metres) so the scene can
// drop a tiling ground texture onto the 'Floor' node with GltfNodeModifiers.
const FLOOR_TILE = 6
function buildFloor() {
  const m = new MeshBuf('Floor', 1)
  const TAU = Math.PI * 2
  const uvAt = (x, z) => [x / FLOOR_TILE, z / FLOOR_TILE]
  // 4 concentric rings so the long slivers of a single fan do not stretch the texture filtering.
  const RINGS = 4
  const ring = []
  for (let r = 0; r <= RINGS; r++) {
    const rad = (r / RINGS) * RADIUS
    const row = []
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i / SEGMENTS) * TAU
      const x = rad * Math.sin(t)
      const z = rad * Math.cos(t)
      row.push(m.vertex([x, FLOOR_Y, z], [0, 1, 0], uvAt(x, z)))
    }
    ring.push(row)
  }
  for (let r = 0; r < RINGS; r++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = ring[r][i], b = ring[r + 1][i], c = ring[r + 1][i + 1], d = ring[r][i + 1]
      m.tri(a, b, c)
      if (r > 0) m.tri(a, c, d)
    }
  }
  return m
}

// ---- main -----------------------------------------------------------------
const materials = [
  {
    name: 'DomeScreen', // replaced at runtime with the video texture
    pbrMetallicRoughness: { baseColorFactor: [0.02, 0.02, 0.03, 1], metallicFactor: 0, roughnessFactor: 1 },
    emissiveFactor: [0.02, 0.02, 0.03]
  },
  {
    name: 'DomeDark',
    pbrMetallicRoughness: { baseColorFactor: [0.03, 0.03, 0.04, 1], metallicFactor: 0.2, roughnessFactor: 0.9 }
  },
  {
    name: 'Grass',
    pbrMetallicRoughness: { baseColorFactor: [0.05, 0.095, 0.05, 1], metallicFactor: 0, roughnessFactor: 1 }
  },
  {
    name: 'ShipMachines', // replaced at runtime with the machinery texture
    pbrMetallicRoughness: { baseColorFactor: [0.04, 0.04, 0.05, 1], metallicFactor: 0.3, roughnessFactor: 0.8 }
  },
  {
    name: 'SpaceBack', // replaced at runtime with a space picture per pod
    pbrMetallicRoughness: { baseColorFactor: [0.01, 0.01, 0.02, 1], metallicFactor: 0, roughnessFactor: 1 }
  },
  {
    name: 'SpaceStars', // replaced at runtime with the tileable starfield
    pbrMetallicRoughness: { baseColorFactor: [0.01, 0.01, 0.02, 1], metallicFactor: 0, roughnessFactor: 1 }
  },
  {
    name: 'Glass',
    pbrMetallicRoughness: { baseColorFactor: [0.55, 0.8, 1, 0.1], metallicFactor: 0.9, roughnessFactor: 0.15 },
    alphaMode: 'BLEND',
    doubleSided: true
  },
  {
    name: 'Frame',
    pbrMetallicRoughness: { baseColorFactor: [0.1, 0.11, 0.12, 1], metallicFactor: 0.85, roughnessFactor: 0.45 }
  }
]

// Inside: the vertical wall is an observation deck. Engine-room texture (MACHINE_REPEATS
// copies around, mirrored wrap) on the strips below and above, continuous glass between,
// and a 30 m deep star ring outside so the whole wall looks out into open space.
// src/client/space.ts drifts rocks and UFOs through the ring.
const MACHINE_REPEATS = 14
const { isHole, buildWall, buildWindows, buildPods } = makeWindowBuilders(
  { RADIUS, SHELL_GAP, WALL_HEIGHT, WALL_RINGS, SEGMENTS, TAU },
  { machine: 3, back: 4, stars: 5, hull: 1, glass: 6, frame: 7 }
)
// The Explorer leaves the bottom ~14% of the video texture black (frame padding), so the
// cap samples v 0..VIDEO_V_MAX and the picture's real bottom edge sits on the wall top.
const VIDEO_V_MAX = 0.86
const capUv = ({ u, y }) => [u, VIDEO_V_MAX * (1 - (y - WALL_HEIGHT) / RADIUS)]
const inner = buildShell('DomeInner', RADIUS, true, { kStart: WALL_RINGS, uv: ({ u, k }) => capUv({ u, y: profile(k, RADIUS).y }) })
const wall = buildWall(MACHINE_REPEATS)
const [glass, frame] = buildWindows()
const pods = buildPods()
const outer = buildShell('DomeOuter', RADIUS + SHELL_GAP, false, { skip: (c, k) => isDoorQuad(c, k) || isHole(c, k) })
const floor = buildFloor()
floor.material = 2
const parts = [inner, wall, glass, frame, ...pods, outer, ...(CLOSED ? [] : [buildDoorFrame()]), floor]

const glb = buildGlb(parts, materials, 'Dome', 'abducted-dome build-dome.mjs')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, glb)

const total = parts.reduce((n, p) => n + p.triCount, 0)
console.log(`wrote ${OUT} (${(glb.length / 1024).toFixed(1)} KB)`)
console.log(`tris: ${parts.map((p) => `${p.name} ${p.triCount}`).join(', ')} => ${total}`)
if (!CLOSED) console.log(`door: cols ${doorStart}..${doorEnd - 1}, ${(DOOR_RINGS / WALL_RINGS) * WALL_HEIGHT} m tall`)
console.log(`apex y=${(WALL_HEIGHT + RADIUS).toFixed(2)}`)
