// Generates models/dome.glb: an inside-out video dome for a 1x1 parcel.
//
// Geometry is centred on the local origin; the scene places it at (8, 0, 8).
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

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'models', 'dome.glb')

// ---- parameters -----------------------------------------------------------
const RADIUS = 7.7 // inner radius (m); dome spans 0.3..15.7 on a 16 m parcel
const SHELL_GAP = 0.06 // outer shell = RADIUS + SHELL_GAP
const WALL_HEIGHT = 5 // vertical wall before the hemispherical cap
const SEGMENTS = 64 // around (must be even: two video wraps)
const WALL_RINGS = 5 // 1 m each
const CAP_RINGS = 15
const DOOR_AZIMUTH_DEG = 180 // south, toward the road at 57,-112
const DOOR_QUADS = 4 // 4 x 5.625 deg => ~3.0 m wide chord
const DOOR_RINGS = 3 // 3 m tall (wall rings are 1 m)
const FLOOR_Y = 0.02

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

// ---- mesh builders --------------------------------------------------------
class MeshBuf {
  constructor(name) {
    this.name = name
    this.pos = []
    this.nrm = []
    this.uv = []
    this.idx = []
  }
  vertex(p, n, t) {
    this.pos.push(...p)
    this.nrm.push(...n)
    this.uv.push(...t)
    return this.pos.length / 3 - 1
  }
  tri(a, b, c) {
    this.idx.push(a, b, c)
  }
  get triCount() {
    return this.idx.length / 3
  }
}

/**
 * Build a shell. inward=true flips normals and winding so the surface renders
 * from inside the dome.
 */
function buildShell(name, radius, inward) {
  const m = new MeshBuf(name)
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
        // outward normal of the profile surface
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
        // Outward winding (CCW seen from outside): a, b, c / a, c, d
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
  const m = new MeshBuf('DoorFrame')
  const rIn = RADIUS
  const rOut = RADIUS + SHELL_GAP
  const yTop = (DOOR_RINGS / WALL_RINGS) * WALL_HEIGHT
  const thetaL = (doorStart / SEGMENTS) * TAU
  const thetaR = (doorEnd / SEGMENTS) * TAU
  const at = (theta, r, y) => [r * Math.sin(theta), y, r * Math.cos(theta)]
  const quad = (p0, p1, p2, p3, n) => {
    const a = m.vertex(p0, n, [0, 0])
    const b = m.vertex(p1, n, [1, 0])
    const c = m.vertex(p2, n, [1, 1])
    const d = m.vertex(p3, n, [0, 1])
    m.tri(a, b, c)
    m.tri(a, c, d)
    m.tri(a, c, b) // double-sided via two windings (cheap, 4 tris per face)
    m.tri(a, d, c)
  }
  // jambs
  quad(at(thetaL, rIn, 0), at(thetaL, rOut, 0), at(thetaL, rOut, yTop), at(thetaL, rIn, yTop), [Math.cos(thetaL), 0, -Math.sin(thetaL)])
  quad(at(thetaR, rIn, 0), at(thetaR, rOut, 0), at(thetaR, rOut, yTop), at(thetaR, rIn, yTop), [-Math.cos(thetaR), 0, Math.sin(thetaR)])
  // lintel, one quad per door column so it follows the curve
  for (let c = doorStart; c < doorEnd; c++) {
    const t0 = (c / SEGMENTS) * TAU
    const t1 = ((c + 1) / SEGMENTS) * TAU
    quad(at(t0, rIn, yTop), at(t1, rIn, yTop), at(t1, rOut, yTop), at(t0, rOut, yTop), [0, -1, 0])
  }
  return m
}

function buildFloor() {
  const m = new MeshBuf('Floor')
  const centre = m.vertex([0, FLOOR_Y, 0], [0, 1, 0], [0.5, 0.5])
  const ring = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const theta = (i / SEGMENTS) * TAU
    ring.push(m.vertex([RADIUS * Math.sin(theta), FLOOR_Y, RADIUS * Math.cos(theta)], [0, 1, 0], [0.5 + 0.5 * Math.sin(theta), 0.5 + 0.5 * Math.cos(theta)]))
  }
  for (let i = 0; i < SEGMENTS; i++) m.tri(centre, ring[i], ring[i + 1]) // normal +Y
  return m
}

// ---- glTF packing ---------------------------------------------------------
function pad4(n) {
  return (n + 3) & ~3
}

function buildGlb(meshes, materials) {
  const bufferViews = []
  const accessors = []
  const chunks = []
  let byteOffset = 0

  const pushView = (typedArray, target) => {
    const len = typedArray.byteLength
    const padded = pad4(len)
    const buf = Buffer.alloc(padded)
    Buffer.from(typedArray.buffer, typedArray.byteOffset, len).copy(buf)
    chunks.push(buf)
    bufferViews.push({ buffer: 0, byteOffset, byteLength: len, target })
    byteOffset += padded
    return bufferViews.length - 1
  }

  const minMax = (arr, comps) => {
    const min = new Array(comps).fill(Infinity)
    const max = new Array(comps).fill(-Infinity)
    for (let i = 0; i < arr.length; i += comps)
      for (let c = 0; c < comps; c++) {
        if (arr[i + c] < min[c]) min[c] = arr[i + c]
        if (arr[i + c] > max[c]) max[c] = arr[i + c]
      }
    return { min, max }
  }

  const gltfMeshes = []
  const nodes = []
  for (const m of meshes) {
    const pos = new Float32Array(m.pos)
    const nrm = new Float32Array(m.nrm)
    const uv = new Float32Array(m.uv)
    const idx = new Uint16Array(m.idx)
    if (pos.length / 3 > 65535) throw new Error(`${m.name}: too many vertices for uint16 indices`)

    const posView = pushView(pos, 34962)
    const { min, max } = minMax(m.pos, 3)
    accessors.push({ bufferView: posView, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max })
    const posAcc = accessors.length - 1

    const nrmView = pushView(nrm, 34962)
    accessors.push({ bufferView: nrmView, componentType: 5126, count: nrm.length / 3, type: 'VEC3' })
    const nrmAcc = accessors.length - 1

    const uvView = pushView(uv, 34962)
    accessors.push({ bufferView: uvView, componentType: 5126, count: uv.length / 2, type: 'VEC2' })
    const uvAcc = accessors.length - 1

    const idxView = pushView(idx, 34963)
    accessors.push({ bufferView: idxView, componentType: 5123, count: idx.length, type: 'SCALAR' })
    const idxAcc = accessors.length - 1

    gltfMeshes.push({
      name: m.name,
      primitives: [
        {
          attributes: { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc },
          indices: idxAcc,
          material: m.material,
          mode: 4
        }
      ]
    })
    nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 })
  }

  const json = {
    asset: { version: '2.0', generator: 'abducted-dome build-dome.mjs' },
    scene: 0,
    scenes: [{ name: 'Dome', nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }]
  }

  let jsonStr = JSON.stringify(json)
  while (jsonStr.length % 4 !== 0) jsonStr += ' '
  const jsonBuf = Buffer.from(jsonStr, 'utf8')
  const binBuf = Buffer.concat(chunks)

  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8)

  const jsonChunkHeader = Buffer.alloc(8)
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0)
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4) // JSON
  const binChunkHeader = Buffer.alloc(8)
  binChunkHeader.writeUInt32LE(binBuf.length, 0)
  binChunkHeader.writeUInt32LE(0x004e4942, 4) // BIN

  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuf])
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
inner.material = 0
outer.material = 0
frame.material = 1
floor.material = 1

const glb = buildGlb([inner, outer, frame, floor], materials)
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, glb)

const total = inner.triCount + outer.triCount + frame.triCount + floor.triCount
console.log(`wrote ${OUT} (${(glb.length / 1024).toFixed(1)} KB)`)
console.log(
  `tris: inner ${inner.triCount}, outer ${outer.triCount}, frame ${frame.triCount}, floor ${floor.triCount} => ${total}`
)
console.log(
  `door: cols ${doorStart}..${doorEnd - 1} (${((DOOR_QUADS / SEGMENTS) * 360).toFixed(1)} deg, ~${(2 * RADIUS * Math.sin((DOOR_QUADS / SEGMENTS) * Math.PI)).toFixed(2)} m wide, ${(DOOR_RINGS / WALL_RINGS) * WALL_HEIGHT} m tall), apex y=${(WALL_HEIGHT + RADIUS).toFixed(2)}`
)
