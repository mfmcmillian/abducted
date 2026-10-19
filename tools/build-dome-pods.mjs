// The observation deck: a continuous ring of windows around the dome wall, with a star
// "pod" ring outside it (used by build-dome.mjs; see the header there for the node list).
//
// The wall keeps a machinery strip below the sill and above the head; between them the wall
// is open, with tinted glass panes and a mullion every MULLION_EVERY columns. Outside, a
// ring POD_DEPTH deep and POD_TOP tall carries the universe: the curved back wall is split
// into BACK_SECTORS equal arcs (45 deg => ~2.25:1, close to a cropped 16:9 picture) and the
// sectors cycle through BACK_PICTURES pictures so each picture sits opposite its twin.
// Top and bottom of the ring get a tileable starfield. src/client/space.ts drifts rocks and
// saucers through the ring for parallax.

import { MeshBuf } from './glb.mjs'

export const POD_DEPTH = 39 // back wall at RADIUS + 39 = 73 m = layout SPACE_RADIUS + 30, where space.ts puts the planets
export const POD_TOP = 40
export const WINDOW_RING_LO = 2 // sill at y = 4 (2 m rings)
export const WINDOW_RING_HI = 9 // head at y = 18
export const BACK_SECTORS = 8
export const BACK_PICTURES = 4 // nodes SpaceBack0..3
const MULLION_EVERY = 4 // columns (4 => 32 panes of ~12 m)
const POD_BOTTOM = 0.05
const STAR_TILE = 36 // metres per starfield tile on the ring top/bottom
const BACK_V0 = 0.105 // crop the 16:9 picture to the ~2.25:1 sector instead of stretching it
const BACK_V1 = 0.895

const DEFAULT_UV = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1]
]

/** Quad with the given normal; the winding is fixed up so the face points along n. */
export function face(m, p0, p1, p2, p3, n, uv = DEFAULT_UV) {
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
  const cx = e1[1] * e2[2] - e1[2] * e2[1]
  const cy = e1[2] * e2[0] - e1[0] * e2[2]
  const cz = e1[0] * e2[1] - e1[1] * e2[0]
  const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0
  const a = m.vertex(p0, n, uv[0])
  const b = m.vertex(p1, n, uv[1])
  const c = m.vertex(p2, n, uv[2])
  const d = m.vertex(p3, n, uv[3])
  if (flip) {
    m.tri(a, c, b)
    m.tri(a, d, c)
  } else {
    m.tri(a, b, c)
    m.tri(a, c, d)
  }
}

/**
 * @param geo  { RADIUS, SHELL_GAP, WALL_HEIGHT, WALL_RINGS, SEGMENTS, TAU }
 * @param mats { machine, back, stars, hull, glass, frame } material indices
 */
export function makeWindowBuilders(geo, mats) {
  const { RADIUS, SHELL_GAP, WALL_HEIGHT, WALL_RINGS, SEGMENTS, TAU } = geo
  const isHole = (_col, k) => k >= WINDOW_RING_LO && k < WINDOW_RING_HI

  const at = (theta, r, y) => [r * Math.sin(theta), y, r * Math.cos(theta)]
  const colTheta = (col) => (col / SEGMENTS) * TAU
  const ringY = (k) => (k / WALL_RINGS) * WALL_HEIGHT
  const inwardN = (theta) => [-Math.sin(theta), 0, -Math.cos(theta)]

  /** Machinery strips below the sill and above the head (MACHINE_REPEATS copies around). */
  function buildWall(MACHINE_REPEATS) {
    const m = new MeshBuf('WallMachine', mats.machine)
    for (let col = 0; col < SEGMENTS; col++) {
      const t0 = colTheta(col)
      const t1 = colTheta(col + 1)
      const u0 = (col / SEGMENTS) * MACHINE_REPEATS
      const u1 = ((col + 1) / SEGMENTS) * MACHINE_REPEATS
      const n0 = inwardN(t0)
      const n1 = inwardN(t1)
      for (let k = 0; k < WALL_RINGS; k++) {
        if (isHole(col, k)) continue
        const y0 = ringY(k)
        const y1 = ringY(k + 1)
        const v0 = 1 - y0 / WALL_HEIGHT
        const v1 = 1 - y1 / WALL_HEIGHT
        const a = m.vertex(at(t0, RADIUS, y0), n0, [u0, v0])
        const b = m.vertex(at(t1, RADIUS, y0), n1, [u1, v0])
        const c = m.vertex(at(t1, RADIUS, y1), n1, [u1, v1])
        const d = m.vertex(at(t0, RADIUS, y1), n0, [u0, v1])
        m.tri(a, c, b)
        m.tri(a, d, c)
      }
    }
    return m
  }

  /** Glass panes plus the metal frame (head/sill reveals, face bands, mullions). */
  function buildWindows() {
    const glass = new MeshBuf('WindowGlass', mats.glass)
    const frame = new MeshBuf('WindowFrame', mats.frame)
    const yLo = ringY(WINDOW_RING_LO)
    const yHi = ringY(WINDOW_RING_HI)
    const rIn = RADIUS - 0.06
    const rOut = RADIUS + 1.2
    const BAND = 0.7
    const bandQuad = (ta, tb, ya, yb, r = rIn) =>
      face(frame, at(ta, r, ya), at(tb, r, ya), at(tb, r, yb), at(ta, r, yb), inwardN((ta + tb) / 2))
    for (let col = 0; col < SEGMENTS; col++) {
      const t0 = colTheta(col)
      const t1 = colTheta(col + 1)
      const rG = RADIUS + 0.03
      face(glass, at(t0, rG, yLo), at(t1, rG, yLo), at(t1, rG, yHi), at(t0, rG, yHi), inwardN((t0 + t1) / 2))
      // head and sill reveals follow the curve and give the wall its thickness
      face(frame, at(t0, rIn, yHi), at(t1, rIn, yHi), at(t1, rOut, yHi), at(t0, rOut, yHi), [0, -1, 0])
      face(frame, at(t0, rIn, yLo), at(t1, rIn, yLo), at(t1, rOut, yLo), at(t0, rOut, yLo), [0, 1, 0])
      bandQuad(t0, t1, yHi, yHi + BAND)
      bandQuad(t0, t1, yLo - BAND, yLo)
      if (col % MULLION_EVERY === 0) {
        const half = 0.22 / RADIUS
        const ta = t0 - half
        const tb = t0 + half
        const r0 = RADIUS - 0.14
        const r1 = RADIUS + 0.7
        bandQuad(ta, tb, yLo, yHi, r0)
        face(frame, at(ta, r0, yLo), at(ta, r1, yLo), at(ta, r1, yHi), at(ta, r0, yHi), [-Math.cos(ta), 0, Math.sin(ta)])
        face(frame, at(tb, r0, yLo), at(tb, r1, yLo), at(tb, r1, yHi), at(tb, r0, yHi), [Math.cos(tb), 0, -Math.sin(tb)])
      }
    }
    return [glass, frame]
  }

  /** The star ring outside the windows: picture back walls, star top/bottom, outer hull. */
  function buildPods() {
    const backs = []
    for (let i = 0; i < BACK_PICTURES; i++) backs.push(new MeshBuf(`SpaceBack${i}`, mats.back))
    const stars = new MeshBuf('SpaceStars', mats.stars)
    const hull = new MeshBuf('PodHull', mats.hull)
    const r0 = RADIUS + SHELL_GAP + 0.02
    const r1 = RADIUS + POD_DEPTH
    const yB = POD_BOTTOM
    const yF = POD_BOTTOM - 10 // ROOT lifts the scene 10 m; keep the outer space floor at its original world height
    const yT = POD_TOP
    const suv = (p) => [p[0] / STAR_TILE, p[2] / STAR_TILE]
    const flip = (n) => n.map((c) => -c)
    const both = (P, n, uv) => {
      face(stars, P[0], P[1], P[2], P[3], n, uv)
      face(hull, P[0], P[1], P[2], P[3], flip(n))
    }
    const colsPerSector = SEGMENTS / BACK_SECTORS
    // Sector 0 is centred on north so the pictures sit on the cardinal/diagonal directions.
    const sectorStart = -colsPerSector / 2
    for (let s = 0; s < BACK_SECTORS; s++) {
      const back = backs[s % BACK_PICTURES]
      for (let j = 0; j < colsPerSector; j++) {
        const col = sectorStart + s * colsPerSector + j
        const t0 = colTheta(col)
        const t1 = colTheta(col + 1)
        // glTF is right-handed: facing outward, increasing theta is the viewer's LEFT, so u runs down.
        const u0 = 1 - j / colsPerSector
        const u1 = 1 - (j + 1) / colsPerSector
        const nm = inwardN((t0 + t1) / 2)
        const B = [at(t0, r1, yB), at(t1, r1, yB), at(t1, r1, yT), at(t0, r1, yT)]
        face(back, B[0], B[1], B[2], B[3], nm, [
          [u0, BACK_V1],
          [u1, BACK_V1],
          [u1, BACK_V0],
          [u0, BACK_V0]
        ])
        face(hull, B[0], B[1], B[2], B[3], flip(nm))
        const T = [at(t0, r0, yT), at(t1, r0, yT), at(t1, r1, yT), at(t0, r1, yT)]
        both(T, [0, -1, 0], T.map(suv))
        const F = [at(t0, r0, yF), at(t1, r0, yF), at(t1, r1, yF), at(t0, r1, yF)]
        both(F, [0, 1, 0], F.map(suv))
      }
    }
    return [...backs, stars, hull]
  }

  return { isHole, buildWall, buildWindows, buildPods }
}
