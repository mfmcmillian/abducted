// Generates models/plaza.glb: the 128 x 128 m night field and the crop-circle floor art
// inside the closed dome.
//
// Centred on the local origin; the scene places it at (64, 0, 64).
// Nodes:
//   Ground    - dark grass quad covering the whole plot (outside the dome, nobody goes there)
//   CropFlat  - flattened crop: formations under the portals / altar / kiosk, the launch pad,
//               the path from the spawn to the diorama
//   CropGlow  - thin emissive rings tracing the formations, the pad and the inner wall
//
// Formation centres are duplicated in src/layout.ts; keep them in sync.
//
// Run: node tools/build-plaza.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshBuf, buildGlb, emissiveMaterial } from './glb.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'models', 'plaza.glb')

const HALF = 64
const DOME_RADIUS = 46
const SEG = 64
const Y_FLAT = 0.045 // above the dome floor disc (0.03)
const Y_GLOW = 0.055

// Local (dome-centred) formation centres. Keep in sync with src/layout.ts.
const FORMATIONS = [
  { name: 'NW', x: -26, z: 24, a0: 135 },
  { name: 'NE', x: 26, z: 24, a0: 45 },
  { name: 'SW', x: -30, z: -14, a0: 225 },
  { name: 'SE', x: 30, z: -14, a0: 315 }
]
const PAD = { x: -12, z: -28 }
const SPAWN_Z = -38

const ground = new MeshBuf('Ground', 0)
ground.quad([-HALF, 0, -HALF], [-HALF, 0, HALF], [HALF, 0, HALF], [HALF, 0, -HALF], [0, 1, 0])

const flat = new MeshBuf('CropFlat', 1)
const glow = new MeshBuf('CropGlow', 2)

// Path from the spawn to the diorama ring.
flat.quad([-3, Y_FLAT, SPAWN_Z - 4], [-3, Y_FLAT, -16], [3, Y_FLAT, -16], [3, Y_FLAT, SPAWN_Z - 4], [0, 1, 0])
glow.quad([-3.2, Y_GLOW, SPAWN_Z - 4], [-3.2, Y_GLOW, -16], [-3, Y_GLOW, -16], [-3, Y_GLOW, SPAWN_Z - 4], [0, 1, 0])
glow.quad([3, Y_GLOW, SPAWN_Z - 4], [3, Y_GLOW, -16], [3.2, Y_GLOW, -16], [3.2, Y_GLOW, SPAWN_Z - 4], [0, 1, 0])

// Spawn circle and the ring around the diorama / dancers.
flat.annulus(0, SPAWN_Z, 0, 4, Y_FLAT, SEG)
glow.annulus(0, SPAWN_Z, 3.6, 4, Y_GLOW, SEG)
glow.annulus(0, 0, 15.8, 16.2, Y_GLOW, 128)

// Inner wall ring.
glow.annulus(0, 0, DOME_RADIUS - 1.2, DOME_RADIUS - 0.7, Y_GLOW, 192)

for (const f of FORMATIONS) {
  flat.annulus(f.x, f.z, 0, 6, Y_FLAT, SEG)
  glow.annulus(f.x, f.z, 5.6, 6, Y_GLOW, SEG)
  glow.annulus(f.x, f.z, 2.6, 2.9, Y_GLOW, SEG)
  for (let i = 0; i < 3; i++) {
    const a = ((f.a0 + i * 120) / 180) * Math.PI
    const sx = f.x + 7.5 * Math.sin(a)
    const sz = f.z + 7.5 * Math.cos(a)
    flat.annulus(sx, sz, 0, 1.2, Y_FLAT, 32)
    glow.annulus(sx, sz, 1.0, 1.2, Y_GLOW, 32)
    const inner = 6.1
    const outer = 7.5 - 1.3
    const px = Math.cos(a) * 0.15
    const pz = -Math.sin(a) * 0.15
    glow.quad(
      [f.x + inner * Math.sin(a) - px, Y_GLOW, f.z + inner * Math.cos(a) - pz],
      [f.x + outer * Math.sin(a) - px, Y_GLOW, f.z + outer * Math.cos(a) - pz],
      [f.x + outer * Math.sin(a) + px, Y_GLOW, f.z + outer * Math.cos(a) + pz],
      [f.x + inner * Math.sin(a) + px, Y_GLOW, f.z + inner * Math.cos(a) + pz],
      [0, 1, 0],
      true
    )
  }
}

// Launch pad: a target of three rings.
const pad = new MeshBuf('PadGlow', 3)
flat.annulus(PAD.x, PAD.z, 0, 3.2, Y_FLAT, SEG)
pad.annulus(PAD.x, PAD.z, 2.8, 3.2, Y_GLOW, SEG)
pad.annulus(PAD.x, PAD.z, 1.6, 1.9, Y_GLOW, SEG)
pad.annulus(PAD.x, PAD.z, 0, 0.6, Y_GLOW, 32)

const materials = [
  {
    name: 'GroundDark',
    pbrMetallicRoughness: { baseColorFactor: [0.045, 0.085, 0.045, 1], metallicFactor: 0, roughnessFactor: 1 }
  },
  {
    name: 'CropFlat',
    pbrMetallicRoughness: { baseColorFactor: [0.16, 0.2, 0.09, 1], metallicFactor: 0, roughnessFactor: 1 },
    emissiveFactor: [0.03, 0.04, 0.015]
  },
  emissiveMaterial('CropGlow', [0.3, 1.0, 0.6], 2),
  emissiveMaterial('PadGlow', [0.4, 0.9, 1.0], 3)
]

const glb = buildGlb([ground, flat, glow, pad], materials, 'Plaza', 'abducted-dome build-plaza.mjs')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, glb)
console.log(
  `wrote ${OUT} (${(glb.length / 1024).toFixed(1)} KB) tris: ground ${ground.triCount}, flat ${flat.triCount}, glow ${glow.triCount}, pad ${pad.triCount}`
)
