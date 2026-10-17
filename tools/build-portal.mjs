// Generates models/portal.glb: a standing ring gate with a glowing disc.
//
// Centred on the local origin, base on y = 0, the disc faces +Z / -Z (double sided).
// Nodes: Base (dark plinth), Ring (emissive frame), Disc (translucent swirl surface).
//
// Run: node tools/build-portal.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshBuf, buildGlb, emissiveMaterial } from './glb.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'models', 'portal.glb')

const R_IN = 2.3
const R_OUT = 2.9
const DEPTH = 0.35
const CY = 3.1 // ring centre height (bottom of the ring sits 0.2 above the plinth)
const SEG = 48
const TAU = Math.PI * 2

const base = new MeshBuf('Base', 0)
const ring = new MeshBuf('Ring', 1)
const disc = new MeshBuf('Disc', 2)

// Plinth box 6 x 0.3 x 1.6
function box(m, cx, cy, cz, sx, sy, sz) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2
  const y0 = cy - sy / 2, y1 = cy + sy / 2
  const z0 = cz - sz / 2, z1 = cz + sz / 2
  m.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]) // top
  m.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]) // -x
  m.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]) // +x
  m.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]) // -z
  m.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1]) // +z
}
box(base, 0, 0.15, 0, 6.4, 0.3, 1.6)
box(base, -3.0, 0.9, 0, 0.5, 1.2, 0.9)
box(base, 3.0, 0.9, 0, 0.5, 1.2, 0.9)

// Ring: a flat band in the XY plane extruded along Z (front face, back face, inner/outer walls).
const front = [], back = [], frontIn = [], backIn = []
for (let i = 0; i <= SEG; i++) {
  const t = (i / SEG) * TAU
  const cx = Math.cos(t), sy = Math.sin(t)
  const u = i / SEG
  front.push([ring.vertex([R_IN * cx, CY + R_IN * sy, DEPTH / 2], [0, 0, 1], [u, 0]), ring.vertex([R_OUT * cx, CY + R_OUT * sy, DEPTH / 2], [0, 0, 1], [u, 1])])
  back.push([ring.vertex([R_IN * cx, CY + R_IN * sy, -DEPTH / 2], [0, 0, -1], [u, 0]), ring.vertex([R_OUT * cx, CY + R_OUT * sy, -DEPTH / 2], [0, 0, -1], [u, 1])])
  frontIn.push(ring.vertex([R_OUT * cx, CY + R_OUT * sy, DEPTH / 2], [cx, sy, 0], [u, 0]))
  backIn.push(ring.vertex([R_OUT * cx, CY + R_OUT * sy, -DEPTH / 2], [cx, sy, 0], [u, 1]))
}
for (let i = 0; i < SEG; i++) {
  // front face (+Z): CCW seen from +Z
  ring.tri(front[i][0], front[i + 1][1], front[i + 1][0])
  ring.tri(front[i][0], front[i][1], front[i + 1][1])
  // back face (-Z)
  ring.tri(back[i][0], back[i + 1][0], back[i + 1][1])
  ring.tri(back[i][0], back[i + 1][1], back[i][1])
  // outer wall
  ring.tri(frontIn[i], backIn[i], backIn[i + 1])
  ring.tri(frontIn[i], backIn[i + 1], frontIn[i + 1])
}

// Disc: double-sided fan in the XY plane
const c0 = disc.vertex([0, CY, 0], [0, 0, 1], [0.5, 0.5])
const rim = []
for (let i = 0; i <= SEG; i++) {
  const t = (i / SEG) * TAU
  rim.push(disc.vertex([R_IN * Math.cos(t), CY + R_IN * Math.sin(t), 0], [0, 0, 1], [0.5 + 0.5 * Math.cos(t), 0.5 + 0.5 * Math.sin(t)]))
}
for (let i = 0; i < SEG; i++) {
  disc.tri(c0, rim[i], rim[i + 1])
  disc.tri(c0, rim[i + 1], rim[i])
}

const materials = [
  { name: 'Stone', pbrMetallicRoughness: { baseColorFactor: [0.12, 0.11, 0.14, 1], metallicFactor: 0.1, roughnessFactor: 0.9 } },
  emissiveMaterial('PortalRing', [0.55, 0.25, 1.0], 3),
  emissiveMaterial('PortalDisc', [0.35, 0.1, 0.9], 1.5, 0.6)
]

const glb = buildGlb([base, ring, disc], materials, 'Portal', 'abducted-dome build-portal.mjs')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, glb)
console.log(`wrote ${OUT} (${(glb.length / 1024).toFixed(1)} KB) tris: base ${base.triCount}, ring ${ring.triCount}, disc ${disc.triCount}`)
