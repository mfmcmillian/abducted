// Generates models/plaza.glb: the 64 x 64 m night field around the dome.
//
// Centred on the local origin; the scene places it at (32, 0, 32).
// Nodes:
//   Ground    - dark grass quad covering the whole plot
//   CropFlat  - flattened crop: four crop-circle formations (one per corner) + the path to the door
//   CropGlow  - thin emissive rings tracing the formations and the dome footprint
//
// Formation centres are exported so the scene can put the portals, altar and kiosk on them.
//
// Run: node tools/build-plaza.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshBuf, buildGlb, emissiveMaterial } from './glb.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'models', 'plaza.glb')

const HALF = 32
const DOME_RADIUS = 22
const SEG = 64
const Y_FLAT = 0.015
const Y_GLOW = 0.025

// Local (dome-centred) formation centres. Keep in sync with src/layout.ts.
const FORMATIONS = [
  { name: 'NW', x: -23, z: 23, a0: 135 },
  { name: 'NE', x: 23, z: 23, a0: 45 },
  { name: 'SW', x: -23, z: -21, a0: 225 },
  { name: 'SE', x: 23, z: -21, a0: 315 }
]

const ground = new MeshBuf('Ground', 0)
ground.quad([-HALF, 0, -HALF], [-HALF, 0, HALF], [HALF, 0, HALF], [HALF, 0, -HALF], [0, 1, 0])

const flat = new MeshBuf('CropFlat', 1)
const glow = new MeshBuf('CropGlow', 2)

// Path from the south edge to the door.
flat.quad([-3, Y_FLAT, -HALF], [-3, Y_FLAT, -DOME_RADIUS - 0.2], [3, Y_FLAT, -DOME_RADIUS - 0.2], [3, Y_FLAT, -HALF], [0, 1, 0])
glow.quad([-3.2, Y_GLOW, -HALF], [-3.2, Y_GLOW, -DOME_RADIUS - 0.2], [-3, Y_GLOW, -DOME_RADIUS - 0.2], [-3, Y_GLOW, -HALF], [0, 1, 0])
glow.quad([3, Y_GLOW, -HALF], [3, Y_GLOW, -DOME_RADIUS - 0.2], [3.2, Y_GLOW, -DOME_RADIUS - 0.2], [3.2, Y_GLOW, -HALF], [0, 1, 0])

// Dome footprint ring.
glow.annulus(0, 0, DOME_RADIUS + 0.3, DOME_RADIUS + 0.8, Y_GLOW, 128)

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
    // connector line from the big ring to the satellite
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
  emissiveMaterial('CropGlow', [0.3, 1.0, 0.6], 2)
]

const glb = buildGlb([ground, flat, glow], materials, 'Plaza', 'abducted-dome build-plaza.mjs')
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, glb)
console.log(`wrote ${OUT} (${(glb.length / 1024).toFixed(1)} KB) tris: ground ${ground.triCount}, flat ${flat.triCount}, glow ${glow.triCount}`)
