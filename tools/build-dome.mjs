// Generates models/dome.glb: an inside-out video dome for the 4x4 World build.
//
// Geometry is centred on the local origin; the scene places it at (32, 0, 32).
// Nodes (all root level, so GltfNodeModifiers paths are just the names):
//   DomeInner  - shell facing inward, video plays on it
//   DomeOuter  - slightly larger shell facing outward, video plays on it too
//   DoorFrame  - dark jambs + lintel closing the gap between shells at the door
//   Floor      - dark disc
//
// UV layout on both shells: u runs 0..1 twice around the dome (one video copy per
// half, seam at north and south), v runs 0 at the floor to 1 at the apex along the
// arc length, so the picture climbs the wall and pinches at the top.
//
// Run: node tools/build-dome.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshBuf, buildGlb } from './glb.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'models', 'dome.glb')

// ---- parameters -----------------------------------------------------------
export const RADIUS = 22 // inner radius (m); dome spans 10..54 on the 64 m plot
const SHELL_GAP = 0.08 // outer shell = RADIUS + SHELL_GAP
export const WALL_HEIGHT = 6 // vertical wall before the hemispherical cap (apex at 28 m, cap is 81 m for 16 parcels)
const SEGMENTS = 96 // around (must be even: two video wraps)
const WALL_RINGS = 6 // 1 m each
const CAP_RINGS = 18
const DOOR_AZIMUTH_DEG = 180 // south, toward the spawn
const DOOR_QUADS = 4 // 4 x 3.75 deg => ~5.7 m wide chord
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
function buildShell(name, radius, inward) {
  const m = new MeshBuf(name, 0)
  // Two halves, each with HALF+1 columns so the UV seam vertices are duplicated.
  const grid = [] // grid[half][col][ring] => vertex index
  for (let h = 0; h < 2; h++) {
    grid.push([])
    for (let j = 0; j <= HALF; j++) {
      const col = h * HALF + j
      const theta = (col / SEGMENTS) * TAU
      const sx = Math.sin(theta)
      const cz = Math.cos(theta)
      const u = j / HALF
      const colVerts = []
      for (let k = 0; k <= RING_COUNT; k++) {
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
        colVerts.push(m.vertex(p, n, [u, 1 - v]))
      }
      grid[h].push(colVerts)
    }
  }
  for (let h = 0; h < 2; h++) {
    for (let j = 0; j < HALF; j++) {
      const col = h * HALF + j
      for (let k = 0; k < RING_COUNT; k++) {
        if (isDoorQuad(col, k)) continue
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

function buildFloor() {
  const m = new MeshBuf('Floor', 1)
  m.annulus(0, 0, 0, RADIUS, FLOOR_Y, SEGMENTS)
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
  }
]

const inner = buildShell('DomeInner', RADIUS, true)
const outer = buildShell('DomeOuter', RADIUS + SHELL_GAP, false)
const frame = buildDoorFrame()
const floor = buildFloor()

const glb = buildGlb([inner, outer, frame, floor], materials, 'Dome', 'abducted-dome build-dome.mjs')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, glb)

const total = inner.triCount + outer.triCount + frame.triCount + floor.triCount
console.log(`wrote ${OUT} (${(glb.length / 1024).toFixed(1)} KB)`)
console.log(`tris: inner ${inner.triCount}, outer ${outer.triCount}, frame ${frame.triCount}, floor ${floor.triCount} => ${total}`)
console.log(
  `door: cols ${doorStart}..${doorEnd - 1} (${((DOOR_QUADS / SEGMENTS) * 360).toFixed(1)} deg, ~${(2 * RADIUS * Math.sin((DOOR_QUADS / SEGMENTS) * Math.PI)).toFixed(2)} m wide, ${(DOOR_RINGS / WALL_RINGS) * WALL_HEIGHT} m tall), apex y=${(WALL_HEIGHT + RADIUS).toFixed(2)}`
)
