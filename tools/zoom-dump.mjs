// Offline check of the Earth-zoom camera path (src/client/zoomPath.ts): prints the timed keys and,
// per leg, the worst speed / acceleration / turn rate seen when sampling at 240 Hz. Kinks and
// overshoots show up here long before they are visible in the explorer.
//   node tools/zoom-dump.mjs [earthAngleDeg]
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'zoom-dump-'))
const out = join(dir, 'zoomPath.mjs')
await build({ entryPoints: [resolve(root, 'src/client/zoomPath.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const { authorPath, townFrames, toWorld } = await import(pathToFileURL(out).href)
const { Vector3 } = await import(pathToFileURL(join(root, 'node_modules/@dcl/sdk/math/index.js')).href).catch(() => ({ Vector3: null }))
rmSync(dir, { recursive: true, force: true })

const V = Vector3 ?? { create: (x, y, z) => ({ x, y, z }) }
// a plausible moment: Earth on its orbit (space.ts: BACK - EARTH_SCALE - 1.5, y 16) at the given
// angle, player on the deck 14 m in from the glass on the Earth's side, looking at it
const CENTER = { x: 96, y: 0, z: 96 }
const DOME_RADIUS = 34 // layout.ts (the glass)
const SPACE_RADIUS = 43 // layout.ts (the universe is measured from here)
const EARTH_RHO = SPACE_RADIUS + 30 - 14 - 1.5
const ang = ((Number(process.argv[2]) || 35) * Math.PI) / 180
const E = V.create(CENTER.x + Math.sin(ang) * EARTH_RHO, 15, CENTER.z + Math.cos(ang) * EARTH_RHO)
const start = V.create(CENTER.x + Math.sin(ang + 0.15) * (DOME_RADIUS - 14), 2.6, CENTER.z + Math.cos(ang + 0.15) * (DOME_RADIUS - 14))
const fwdRaw = { x: E.x - start.x, y: E.y - start.y, z: E.z - start.z }
const fl = Math.hypot(fwdRaw.x, fwdRaw.y, fwdRaw.z)
const forward = V.create(fwdRaw.x / fl, fwdRaw.y / fl, fwdRaw.z / fl)

const path = authorPath({ E, start, forward })
const keys = path.keys
const frames = townFrames(E)
const f3 = (n) => n.toFixed(2).padStart(7)

console.log('keys (town-local metres; D = distance to the leg\'s focus; t from leg cost):')
console.log('  name          t      dt    cost       D      world x       y       z')
for (let i = 0; i < keys.length; i++) {
  const k = keys[i]
  const f = k.focus ?? k.look
  const D = Math.hypot(k.q.x - f.x, k.q.y - f.y, k.q.z - f.z)
  const w = toWorld(k.t <= path.key('swap').t ? frames.embedded : frames.full, k.q)
  const dt = i ? k.t - keys[i - 1].t : 0
  console.log(`  ${k.name.padEnd(11)}${f3(k.t)} ${f3(dt)} ${f3(k.cost)} ${f3(D)}   ${f3(w.x)} ${f3(w.y)} ${f3(w.z)}`)
}

// 240 Hz sweep
const HZ = 240, dt = 1 / HZ
let prev = null, prevV = null
const legs = keys.slice(1).map((k, i) => ({ name: `${keys[i].name}>${k.name}`, t0: keys[i].t, t1: k.t, vMax: 0, aMax: 0, turnMax: 0, rollMax: 0, relMax: 0 }))
const deg = (r) => (r * 180) / Math.PI
for (let t = 0; t <= path.end + 1e-9; t += dt) {
  const p = path.pose(t, dt)
  const white = p.white
  const leg = legs.find((l) => t >= l.t0 && t <= l.t1) ?? legs[legs.length - 1]
  if (prev) {
    const v = { x: (p.q.x - prev.q.x) / dt, y: (p.q.y - prev.q.y) / dt, z: (p.q.z - prev.q.z) / dt }
    const speed = Math.hypot(v.x, v.y, v.z)
    leg.vMax = Math.max(leg.vMax, speed)
    if (prevV) leg.aMax = Math.max(leg.aMax, Math.hypot(v.x - prevV.x, v.y - prevV.y, v.z - prevV.z) / dt)
    const turn = deg(Math.acos(Math.max(-1, Math.min(1, p.dir.x * prev.dir.x + p.dir.y * prev.dir.y + p.dir.z * prev.dir.z)))) / dt
    leg.turnMax = Math.max(leg.turnMax, turn)
    // roll = bank of the camera's right vector; count it only while the picture is visible
    const bank = (o) => {
      const r = { x: o.up.y * o.dir.z - o.up.z * o.dir.y, y: o.up.z * o.dir.x - o.up.x * o.dir.z, z: o.up.x * o.dir.y - o.up.y * o.dir.x }
      return Math.asin(Math.max(-1, Math.min(1, r.y / Math.hypot(r.x, r.y, r.z))))
    }
    if (white < 0.95) leg.rollMax = Math.max(leg.rollMax, deg(Math.abs(bank(p) - bank(prev))) / dt)
    // speed relative to distance from the leg's subject: the perceived zoom rate (1/s)
    const k = keys.find((k) => k.t >= t) ?? keys[keys.length - 1]
    const f = k.focus ?? k.look
    const D = Math.max(0.05, Math.hypot(p.q.x - f.x, p.q.y - f.y, p.q.z - f.z))
    leg.relMax = Math.max(leg.relMax, speed / D)
    prevV = v
  }
  prev = p
}
// where the camera actually crosses the window plane, against the opening (0.96 x 1.06 m)
{
  const wi = path.key('window-in'), wo = path.key('window-out')
  const wz = wo.q.z + 2.2 // WINDOW_C.z
  let last = null
  for (let t = wo.t; t <= wi.t; t += 1 / 240) {
    const p = path.pose(t, 1 / 240)
    if (last && last.q.z < wz && p.q.z >= wz) {
      console.log(`\nwindow crossing at ${t.toFixed(2)} s: offset from the opening's centre x ${(p.q.x - wo.q.x).toFixed(3)} m, y ${(p.q.y - wo.q.y).toFixed(3)} m (clear if |x| < 0.40, |y| < 0.45)`)
      break
    }
    last = p
  }
}
let on = 0, off = 0
for (let t = 0; t < path.end; t += 0.01) {
  const w = path.pose(t, 0.01).white
  if (!on && w > 0) on = t
  if (on && !off && w === 0 && t > on + 0.5) off = t
}
console.log(`\nclouds: white from ${on.toFixed(2)} to ${off.toFixed(2)} s`)
{
  // residual bank when the picture comes back, and how it decays
  const bankOf = (o) => {
    const r = { x: o.up.y * o.dir.z - o.up.z * o.dir.y, y: o.up.z * o.dir.x - o.up.x * o.dir.z, z: o.up.x * o.dir.y - o.up.y * o.dir.x }
    return deg(Math.asin(Math.max(-1, Math.min(1, r.y / Math.hypot(r.x, r.y, r.z)))))
  }
  path.reset()
  const line = []
  for (let t = 0; t <= path.end; t += dt) {
    const p = path.pose(t, dt)
    for (const at of [off, off + 0.5, off + 1, off + 2]) if (Math.abs(t - at) < dt / 2) line.push(`${at.toFixed(2)}s ${bankOf(p).toFixed(1)}deg`)
  }
  console.log(`bank after the clouds: ${line.join(', ')}`)
}
console.log('\nper leg, worst case at 240 Hz (town metres; roll/s only while the picture is visible):')
console.log('  leg                      v max   a max  turn/s  roll/s   v/D')
for (const l of legs) console.log(`  ${l.name.padEnd(22)}${f3(l.vMax)} ${f3(l.aMax)} ${f3(l.turnMax)} ${f3(l.rollMax)} ${f3(l.relMax)}`)
