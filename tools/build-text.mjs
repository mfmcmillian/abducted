// Generates extruded 3D lettering GLBs (models/text-*.glb, see the buildText calls at the end)
// for the sign above the ring altar. Glyph outlines come from the OFL-licensed Bangers font
// (tools/fonts), are triangulated with earcut and extruded along Z.
//
// Output is in metres at em = 1 (scale in the scene), centred on X, baseline of the lower
// line at y = 0. The readable side faces -Z, like TextShape, so a Y billboard reads correctly.
// Nodes: Face (front + back caps, bright emissive) and Side (extrusion walls, darker green).
//
// Run: node tools/build-text.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import earcut from 'earcut'
import { MeshBuf, buildGlb } from './glb.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FONT = resolve(__dirname, 'fonts', 'Bangers-Regular.ttf')

const LINES = ['FREE TO CLAIM', 'CLICK ME!']
const LINE_GAP = 1.15 // em, baseline to baseline
const DEPTH = 0.28 // em
const CURVE_STEPS = 6

const fontBuf = readFileSync(FONT)
const font = opentype.parse(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength))

/** Flatten an opentype path (y-down) into closed contours of [x, y] in y-up em units. */
function contoursOf(path) {
  const contours = []
  let cur = null
  let last = null
  const push = (x, y) => cur.push([x, -y])
  for (const c of path.commands) {
    if (c.type === 'M') {
      cur = []
      contours.push(cur)
      push(c.x, c.y)
    } else if (c.type === 'L') push(c.x, c.y)
    else if (c.type === 'Q') {
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS
        const mt = 1 - t
        push(mt * mt * last.x + 2 * mt * t * c.x1 + t * t * c.x, mt * mt * last.y + 2 * mt * t * c.y1 + t * t * c.y)
      }
    } else if (c.type === 'C') {
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS
        const mt = 1 - t
        push(
          mt ** 3 * last.x + 3 * mt * mt * t * c.x1 + 3 * mt * t * t * c.x2 + t ** 3 * c.x,
          mt ** 3 * last.y + 3 * mt * mt * t * c.y1 + 3 * mt * t * t * c.y2 + t ** 3 * c.y
        )
      }
    }
    if (c.type !== 'Z') last = c
  }
  // Drop duplicate closing points and degenerate contours.
  return contours
    .map((pts) => {
      const out = []
      for (const p of pts) {
        const q = out[out.length - 1]
        if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) out.push(p)
      }
      const a = out[0]
      const b = out[out.length - 1]
      if (out.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4) out.pop()
      return out
    })
    .filter((c) => c.length >= 3)
}

const signedArea = (pts) => {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % pts.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

const pointInPoly = ([px, py], pts) => {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Group contours into { outer, holes[] } shapes using containment parity. */
function shapesOf(contours) {
  const depth = contours.map((c, i) => contours.filter((o, j) => j !== i && pointInPoly(c[0], o)).length)
  const shapes = []
  contours.forEach((c, i) => {
    if (depth[i] % 2 === 0) shapes.push({ outer: signedArea(c) > 0 ? c : [...c].reverse(), holes: [], idx: i })
  })
  contours.forEach((c, i) => {
    if (depth[i] % 2 !== 1) return
    // Attach to the smallest even-depth contour that contains it.
    let best = null
    for (const s of shapes) {
      if (!pointInPoly(c[0], s.outer)) continue
      if (!best || Math.abs(signedArea(s.outer)) < Math.abs(signedArea(best.outer))) best = s
    }
    if (best) best.holes.push(signedArea(c) < 0 ? c : [...c].reverse())
  })
  return shapes
}

let face
let side
const hz = DEPTH / 2

function extrudeShape({ outer, holes }, ox, oy) {
  const rings = [outer, ...holes]
  const flat = []
  const holeIdx = []
  for (const r of rings) {
    if (r !== outer) holeIdx.push(flat.length / 2)
    for (const [x, y] of r) flat.push(x + ox, y + oy)
  }
  const tris = earcut(flat, holeIdx.length ? holeIdx : undefined)
  const pt = (i) => [flat[i * 2], flat[i * 2 + 1]]

  // Caps. Front (readable) side faces -Z, so winding is flipped there.
  const frontV = []
  const backV = []
  for (let i = 0; i < flat.length / 2; i++) {
    const [x, y] = pt(i)
    frontV.push(face.vertex([x, y, -hz], [0, 0, -1], [x, y]))
    backV.push(face.vertex([x, y, hz], [0, 0, 1], [x, y]))
  }
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]]
    // earcut gives CCW (seen from +Z) for y-up input; that faces +Z.
    const ccw = signedArea([pt(a), pt(b), pt(c)]) > 0
    const [p, q, r] = ccw ? [a, b, c] : [a, c, b]
    face.tri(backV[p], backV[q], backV[r])
    face.tri(frontV[p], frontV[r], frontV[q])
  }

  // Walls: outer rings are CCW, holes CW, so (dy, -dx) always points out of the solid.
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const [ax, ay] = r[i]
      const [bx, by] = r[(i + 1) % r.length]
      const dx = bx - ax
      const dy = by - ay
      const len = Math.hypot(dx, dy) || 1
      const n = [dy / len, -dx / len, 0]
      const A = [ax + ox, ay + oy]
      const B = [bx + ox, by + oy]
      side.quad([A[0], A[1], -hz], [B[0], B[1], -hz], [B[0], B[1], hz], [A[0], A[1], hz], n)
    }
  }
}

// Mirror X so the text reads left-to-right from the -Z side.
function layoutLine(text, baselineY) {
  // Manual layout (font.getPath trips over this font's GSUB table): advance + kerning.
  const scale = 1 / font.unitsPerEm
  const glyphs = [...text].map((ch) => font.charToGlyph(ch))
  const placed = []
  let pen = 0
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i]
    if (i > 0) pen += font.getKerningValue(glyphs[i - 1], g) * scale
    placed.push({ g, x: pen })
    pen += g.advanceWidth * scale
  }
  const width = pen
  const shift = -width / 2
  for (const { g, x } of placed) {
    const path = g.getPath(x, 0, 1)
    for (const shape of shapesOf(contoursOf(path))) {
      const flip = (ring) => ring.map(([px, py]) => [-(px + shift), py]).reverse() // mirror keeps orientation after reverse
      extrudeShape({ outer: flip(shape.outer), holes: shape.holes.map(flip) }, 0, baselineY)
    }
  }
  return width
}

/** Face/side materials from one glow colour (0..1 rgb). */
function materialsFor([r, g, b]) {
  return [
    {
      name: 'Face',
      pbrMetallicRoughness: { baseColorFactor: [r * 0.45, g * 0.45, b * 0.45, 1], metallicFactor: 0, roughnessFactor: 0.7 },
      emissiveFactor: [r * 0.85, g * 0.85, b * 0.85],
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: 0.7 } }
    },
    {
      name: 'Side',
      pbrMetallicRoughness: { baseColorFactor: [r * 0.12, g * 0.12, b * 0.12, 1], metallicFactor: 0.2, roughnessFactor: 0.6 },
      emissiveFactor: [r * 0.2, g * 0.2, b * 0.2],
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: 0.4 } }
    }
  ]
}

function buildText(fileName, lines, color) {
  face = new MeshBuf('Face', 0)
  side = new MeshBuf('Side', 1)
  const widths = []
  for (let i = 0; i < lines.length; i++) widths.push(layoutLine(lines[i], (lines.length - 1 - i) * LINE_GAP))
  const out = resolve(__dirname, '..', 'models', fileName)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, buildGlb([face, side], materialsFor(color), 'Text'))
  console.log(
    `wrote ${out} (${(readFileSync(out).length / 1024).toFixed(1)} KB) tris: Face ${face.triCount}, Side ${side.triCount}; widths (em): ${widths.map((w) => w.toFixed(2)).join(', ')}`
  )
}

buildText('text-claim.glb', LINES, [0.3, 1, 0.25]) // neon green, above the ring altar
buildText('text-buy.glb', ['BUY HERE'], [0.3, 0.9, 1]) // cyan, above the emote Marketplace cow
