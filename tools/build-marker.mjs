// Generates models/marker.glb: the cow game's beam target, a flat ring with a centre dot
// and four tick marks. Unit outer radius, so the scene scales it to the beam radius.
// Lies on y = 0 facing +Y.
// Nodes: Ring, Dot. Both use the same white emissive material; the scene recolours it
// per beam state with GltfNodeModifiers.
//
// Run: node tools/build-marker.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshBuf, buildGlb, emissiveMaterial } from './glb.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'models', 'marker.glb')

const SEG = 64
const ring = new MeshBuf('Ring', 0)
const dot = new MeshBuf('Dot', 0)

ring.annulus(0, 0, 0.86, 1.0, 0, SEG)
// ticks at the four compass points
for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
  const ax = sx !== 0
  const x0 = ax ? sx * 0.62 : -0.03, x1 = ax ? sx * 0.84 : 0.03
  const z0 = ax ? -0.03 : sz * 0.62, z1 = ax ? 0.03 : sz * 0.84
  const lx0 = Math.min(x0, x1), lx1 = Math.max(x0, x1), lz0 = Math.min(z0, z1), lz1 = Math.max(z0, z1)
  ring.quad([lx0, 0, lz0], [lx0, 0, lz1], [lx1, 0, lz1], [lx1, 0, lz0], [0, 1, 0], true)
}
dot.annulus(0, 0, 0, 0.09, 0.002, 24)

const materials = [emissiveMaterial('Marker', [1, 1, 1], 3, 0.85)]
const glb = buildGlb([ring, dot], materials, 'Marker', 'abducted-dome build-marker.mjs')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, glb)
console.log(`wrote ${OUT} (${(glb.length / 1024).toFixed(1)} KB) tris: ring ${ring.triCount}, dot ${dot.triCount}`)
