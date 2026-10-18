// Cuts a rectangular hole through the front of a model: every triangle whose vertices are all in
// front of zMin and that overlaps the rectangle is clipped against it (Sutherland-Hodgman, four
// disjoint outside regions, all vertex attributes interpolated), so the edge is exact.
//   node tools/cut-hole.mjs <file.glb> <x0> <x1> <y0> <y1> <zMin>      (model coordinates)
// Used by cut-window.mjs (the house's picture window) and earth-models.mjs (the TV's glass).

import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const NPX = process.env.LOCALAPPDATA.split('\\').join('/') + '/npm-cache/_npx/'
const cacheDir = readdirSync(NPX).map((d) => NPX + d + '/node_modules/@gltf-transform/core').find((p) => existsSync(p))
if (!cacheDir) throw new Error('run npx @gltf-transform/cli once to populate the cache')
const require = createRequire(cacheDir + '/package.json')
const { NodeIO } = require(cacheDir)

const [file, ...nums] = process.argv.slice(2)
if (!file || nums.length !== 5 || nums.some((n) => Number.isNaN(Number(n)))) {
  console.error('usage: node tools/cut-hole.mjs <file.glb> <x0> <x1> <y0> <y1> <zMin>')
  process.exit(1)
}
const FILE = resolve(file)
const [x0, x1, y0, y1, zMin] = nums.map(Number)
const HOLE = { x0, x1, y0, y1, zMin }

const io = new NodeIO()
const doc = await io.read(FILE)
let removed = 0, added = 0

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const semantics = prim.listSemantics()
    const attrs = semantics.map((s) => prim.getAttribute(s))
    const sizes = attrs.map((a) => a.getElementSize())
    const arrays = attrs.map((a) => Array.from(a.getArray()))
    const pos = attrs[semantics.indexOf('POSITION')]
    const P = pos.getArray()
    const idx = Array.from(prim.getIndices().getArray())
    let vcount = pos.getCount()

    // a polygon vertex is { i } (existing) or { from, to, t } (new, on an edge)
    const vertex = (v) => {
      if (v.i !== undefined) return v.i
      arrays.forEach((arr, k) => {
        const n = sizes[k]
        for (let c = 0; c < n; c++) arr.push(arr[v.from * n + c] * (1 - v.t) + arr[v.to * n + c] * v.t)
      })
      added++
      v.i = vcount++ // realised once; later uses of the same record reuse it
      return v.i
    }
    const xy = (v) => {
      if (v.i !== undefined) return [P[v.i * 3], P[v.i * 3 + 1]]
      const a = v.from * 3, b = v.to * 3
      return [P[a] * (1 - v.t) + P[b] * v.t, P[a + 1] * (1 - v.t) + P[b + 1] * v.t]
    }
    // split an edge where f crosses zero (f linear in x,y); returns a new vertex record
    const split = (va, vb, fa, fb) => {
      const t = fa / (fa - fb)
      // both ends may be derived vertices: realise them first so the new one interpolates real indices
      const ia = vertex(va), ib = vertex(vb)
      return { from: ia, to: ib, t }
    }
    // Sutherland-Hodgman against f(x,y) >= 0
    const clip = (poly, f) => {
      const out = []
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length]
        const fa = f(...xy(a)), fb = f(...xy(b))
        if (fa >= 0) out.push(a)
        if ((fa >= 0) !== (fb >= 0)) out.push(split(a, b, fa, fb))
      }
      return out
    }
    // the plane outside the rectangle, as four disjoint convex regions
    const regions = [
      [(x) => x0 - x], // left
      [(x) => x - x1], // right
      [(x) => x - x0, (x) => x1 - x, (_x, y) => y0 - y], // below
      [(x) => x - x0, (x) => x1 - x, (_x, y) => y - y1] // above
    ]

    const out = []
    for (let i = 0; i < idx.length; i += 3) {
      const tri = [idx[i], idx[i + 1], idx[i + 2]]
      const front = tri.every((v) => P[v * 3 + 2] > HOLE.zMin)
      const xs = tri.map((v) => P[v * 3]), ys = tri.map((v) => P[v * 3 + 1])
      const overlaps = Math.max(...xs) > x0 && Math.min(...xs) < x1 && Math.max(...ys) > y0 && Math.min(...ys) < y1
      if (!front || !overlaps) {
        out.push(...tri)
        continue
      }
      removed++
      for (const region of regions) {
        let poly = tri.map((v) => ({ i: v }))
        for (const f of region) {
          poly = clip(poly, f)
          if (poly.length < 3) break
        }
        if (poly.length < 3) continue
        const ids = poly.map(vertex)
        for (let k = 1; k + 1 < ids.length; k++) out.push(ids[0], ids[k], ids[k + 1])
      }
    }

    attrs.forEach((a, k) => {
      const Ctor = a.getArray().constructor
      a.setArray(new Ctor(arrays[k]))
    })
    prim.getIndices().setArray(vcount > 65535 ? new Uint32Array(out) : new Uint16Array(out))
  }
}

await io.write(FILE, doc)
console.log(`cut hole: ${removed} triangles clipped, ${added} vertices added -> ${FILE}`)
