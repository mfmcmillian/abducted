// Generates models/rock-0..2.glb: three lumpy asteroids (unit-ish radius, flat shaded) that
// drift past the observation windows. Run: node tools/build-rocks.mjs

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshBuf, buildGlb } from './glb.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function icosphere(subdivisions) {
  const t = (1 + Math.sqrt(5)) / 2
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
  ].map(normalize)
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ]
  for (let s = 0; s < subdivisions; s++) {
    const cache = new Map()
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      if (cache.has(key)) return cache.get(key)
      const p = normalize([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2])
      verts.push(p)
      cache.set(key, verts.length - 1)
      return verts.length - 1
    }
    const next = []
    for (const [a, b, c] of faces) {
      const ab = mid(a, b)
      const bc = mid(b, c)
      const ca = mid(c, a)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = next
  }
  return { verts, faces }
}

function normalize(p) {
  const l = Math.hypot(p[0], p[1], p[2])
  return [p[0] / l, p[1] / l, p[2] / l]
}

function buildRock(seed) {
  const rnd = mulberry32(seed)
  const { verts, faces } = icosphere(2)
  // Low-frequency lumps (a few sine waves in random directions) plus a little grit.
  const waves = []
  for (let i = 0; i < 5; i++) {
    const dir = normalize([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5])
    waves.push({ dir, freq: 1.5 + rnd() * 2.5, amp: 0.05 + rnd() * 0.1, phase: rnd() * Math.PI * 2 })
  }
  const stretch = [0.7 + rnd() * 0.6, 0.6 + rnd() * 0.5, 0.7 + rnd() * 0.6]
  const displaced = verts.map((p) => {
    let r = 1
    for (const w of waves) r += w.amp * Math.sin(w.freq * (p[0] * w.dir[0] + p[1] * w.dir[1] + p[2] * w.dir[2]) * 3 + w.phase)
    r += (rnd() - 0.5) * 0.14
    return [p[0] * r * stretch[0], p[1] * r * stretch[1], p[2] * r * stretch[2]]
  })
  const m = new MeshBuf('Rock', 0)
  for (const [a, b, c] of faces) {
    const p0 = displaced[a]
    const p1 = displaced[b]
    const p2 = displaced[c]
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
    const n = normalize([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]])
    const i0 = m.vertex(p0, n, [0, 0])
    const i1 = m.vertex(p1, n, [1, 0])
    const i2 = m.vertex(p2, n, [0, 1])
    m.tri(i0, i1, i2)
  }
  return m
}

const material = {
  name: 'Rock',
  pbrMetallicRoughness: { baseColorFactor: [0.3, 0.28, 0.26, 1], metallicFactor: 0.05, roughnessFactor: 0.95 },
  // A whisper of self-light so the dark sides still read as shapes against the stars.
  emissiveFactor: [0.035, 0.035, 0.04]
}

for (let i = 0; i < 3; i++) {
  const rock = buildRock(1000 + i * 7919)
  const glb = buildGlb([rock], [material], 'Rock', 'abducted-dome build-rocks.mjs')
  const out = resolve(__dirname, '..', 'models', `rock-${i}.glb`)
  writeFileSync(out, glb)
  console.log(`wrote ${out} (${(glb.length / 1024).toFixed(1)} KB, ${rock.triCount} tris)`)
}
