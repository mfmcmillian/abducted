import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_RADIUS } from '../layout'
import { CITY_POS, EMBED, FIT_DISTANCE, GROUND_Y, ROOM_POS, SET_SCALE, TOWN_EMBED_POS, TOWN_FULL_POS, TOWN_LOOK0, TOWN_Q0, TV_SCREEN, WINDOW_C } from './earthLayout'

/**
 * The Earth-zoom camera path, with no engine in it (tools/zoom-dump.mjs runs it offline).
 *
 * Everything is authored and interpolated in one space, town-local ("q"), so the x4 swap of the
 * street set is invisible to the spline: before the swap q maps to the world through the embedded
 * frame, after it through the full-size frame, and at the swap key both agree. Keys are placed
 * by hand but timed automatically: each leg costs what the eye sees, the change in log distance
 * to the leg's subject plus how far the subject swings across the frame, and legs get time in
 * proportion. That keeps the apparent zoom rate steady from the deck to the CRT.
 */

/** A uniform-scale frame: world = origin + scale * q. */
export interface Frame {
  origin: Vector3
  scale: number
}
export const toWorld = (f: Frame, q: Vector3) => Vector3.add(f.origin, Vector3.scale(q, f.scale))
export const toLocal = (f: Frame, w: Vector3) => Vector3.scale(Vector3.subtract(w, f.origin), 1 / f.scale)

/** The two town frames for an Earth at E. */
export function townFrames(E: Vector3): { embedded: Frame; full: Frame } {
  return {
    embedded: { origin: Vector3.add(E, Vector3.scale(TOWN_EMBED_POS, SET_SCALE)), scale: SET_SCALE * EMBED },
    full: { origin: Vector3.add(E, Vector3.scale(TOWN_FULL_POS, SET_SCALE)), scale: SET_SCALE }
  }
}

export interface KeyIn {
  name: string
  /** camera position, town-local */
  q: Vector3
  /** what the camera points at, town-local */
  look: Vector3
  /** what this leg is flying at (for timing); defaults to look */
  focus?: Vector3
  /** 0 = Catmull-Rom tangent, 1 = no tangent (flat); 1 at the ends gives ease-in / ease-out */
  tension?: number
  /** multiplies the time given to the leg that arrives at this key */
  weight?: number
  /** the leg arriving here takes at least this long (s); the other legs give up the difference */
  minDt?: number
}
export interface Key extends KeyIn {
  t: number
  /** perceived-motion cost of the leg arriving here */
  cost: number
  /** the look target pushed out along the view ray, so a wobble in q does not nod the camera */
  lookPt: Vector3
}

const LOOK_L = 40 // town metres
const MIN_D = 0.05

const angle = (a: Vector3, b: Vector3) => Math.acos(Math.max(-1, Math.min(1, Vector3.dot(a, b) / (Vector3.length(a) * Vector3.length(b)))))

/**
 * Time the keys so each leg gets time in proportion to how much the picture changes over it:
 * the change in log distance to the subject, the subject's swing across the frame and the pan.
 */
export function retime(keys: KeyIn[], total: number): Key[] {
  const costs = [0]
  for (let i = 1; i < keys.length; i++) {
    const p = keys[i - 1], k = keys[i]
    const f = k.focus ?? k.look
    const a = Vector3.subtract(p.q, f), b = Vector3.subtract(k.q, f)
    const d0 = Math.max(MIN_D, Vector3.length(a)), d1 = Math.max(MIN_D, Vector3.length(b))
    const zoomC = Math.abs(Math.log(d1 / d0))
    const swing = angle(a, b)
    const pan = angle(Vector3.subtract(p.look, p.q), Vector3.subtract(k.look, k.q))
    costs.push(Math.hypot(zoomC, swing, pan) * (k.weight ?? 1))
  }
  // proportional times, then honour the minimums: pinned legs take theirs, the rest share what is left
  const sum = costs.reduce((s, c) => s + c, 0)
  const dts = costs.map((c) => (total * c) / sum)
  let pinned = 0, free = 0
  keys.forEach((k, i) => {
    if (k.minDt && dts[i] < k.minDt) pinned += k.minDt
    else free += costs[i]
  })
  const scale = (total - pinned) / free
  keys.forEach((k, i) => {
    dts[i] = k.minDt && (total * costs[i]) / sum < k.minDt ? k.minDt : costs[i] * scale
  })
  let acc = 0
  return keys.map((k, i) => {
    acc += dts[i]
    const dir = Vector3.normalize(Vector3.subtract(k.look, k.q))
    return { ...k, t: acc, cost: costs[i], lookPt: Vector3.add(k.q, Vector3.scale(dir, LOOK_L)) }
  })
}

/**
 * The cloud white-out, 0..1: the only cut in the shot. It covers the crossing of the Earth's
 * shell (between the 'top' and 'sky' keys) and, inside it, the heading change at the top of
 * the dive, so it is keyed to those times rather than to seconds.
 */
export function cloudAlpha(path: Path, t: number): number {
  const top = path.key('top').t, sky = path.key('sky').t, dive = path.key('dive').t
  const on = top - 0.2, full = top + 0.4, hold = sky + 0.36 * (dive - sky), off = hold + 0.7
  if (t < on) return 0
  if (t < full) return (t - on) / (full - on)
  if (t < hold) return 1
  if (t < off) return 1 - (t - hold) / (off - hold)
  return 0
}

/** Cardinal spline through the keys: time-scaled tangents, per-key tension. */
export function sample(keys: Key[], t: number, pick: (k: Key) => Vector3): Vector3 {
  const n = keys.length
  if (t <= keys[0].t) return pick(keys[0])
  if (t >= keys[n - 1].t) return pick(keys[n - 1])
  let i = 0
  while (keys[i + 1].t <= t) i++
  const k1 = keys[i], k2 = keys[i + 1]
  const dt = k2.t - k1.t
  const u = (t - k1.t) / dt
  const tangent = (idx: number) => {
    const a = keys[Math.max(0, idx - 1)], b = keys[Math.min(n - 1, idx + 1)]
    const s = ((1 - (keys[idx].tension ?? 0)) * dt) / (b.t - a.t)
    return Vector3.scale(Vector3.subtract(pick(b), pick(a)), s)
  }
  const p1 = pick(k1), p2 = pick(k2), m1 = tangent(i), m2 = tangent(i + 1)
  const u2 = u * u, u3 = u2 * u
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2
  return Vector3.add(Vector3.add(Vector3.scale(p1, h00), Vector3.scale(m1, h10)), Vector3.add(Vector3.scale(p2, h01), Vector3.scale(m2, h11)))
}

export interface Pose {
  q: Vector3
  dir: Vector3
  up: Vector3
  rotation: Quaternion
}

/** Samples the path and carries the camera's up vector along it (parallel transport, easing back to level). */
export class Path {
  readonly end: number
  private up = Vector3.Up()
  constructor(readonly keys: Key[]) {
    this.end = keys[keys.length - 1].t
  }
  key(name: string): Key {
    const k = this.keys.find((k) => k.name === name)
    if (!k) throw new Error(`zoom path: no key ${name}`)
    return k
  }
  reset() {
    this.up = Vector3.Up()
  }
  /** levelRate: how fast (1/s) the up vector eases back to level; make it high while the clouds hide the picture. */
  pose(t: number, dt: number, levelRate = 1.5): Pose {
    const q = sample(this.keys, t, (k) => k.q)
    const l = sample(this.keys, t, (k) => k.lookPt)
    const dir = Vector3.normalize(Vector3.subtract(l, q))
    // keep roll continuous through the vertical: carry the last up across, projected off the new forward
    let up = Vector3.subtract(this.up, Vector3.scale(dir, Vector3.dot(this.up, dir)))
    if (Vector3.lengthSquared(up) < 1e-6) up = Vector3.create(0, 0, 1)
    up = Vector3.normalize(up)
    // ...and whenever the view is not steep, ease back to level so we arrive at the screen square
    if (Math.abs(dir.y) < 0.85) {
      let level = Vector3.subtract(Vector3.Up(), Vector3.scale(dir, dir.y))
      level = Vector3.normalize(level)
      up = Vector3.normalize(Vector3.lerp(up, level, Math.min(1, dt * levelRate)))
    }
    this.up = up
    return { q, dir, up, rotation: Quaternion.lookRotation(dir, up) }
  }
}

/** What the path needs to know about the moment the Earth was clicked. */
export interface Shot {
  /** Earth centre (world) */
  E: Vector3
  /** player camera position and forward (world) */
  start: Vector3
  forward: Vector3
}

/** Total flight time, deck to CRT (s). */
export const FLIGHT_T = 25.8

/** The authored keys for a shot, in town-local space, timed. */
export function authorKeys(shot: Shot): Key[] {
  const { E, start, forward } = shot
  const { embedded } = townFrames(E)
  // world / set / town / room -> town-local (the embedded frame is the one in force at every key
  // before the swap; after it keys are authored in town-local directly)
  const W = (w: Vector3) => toLocal(embedded, w)
  const S = (x: number, y: number, z: number) => W(Vector3.add(E, Vector3.scale(Vector3.create(x, y, z), SET_SCALE)))
  const R = (x: number, y: number, z: number) => Vector3.add(ROOM_POS, Vector3.create(x, y, z))

  // horizontal direction from the Earth back to the player: we approach along it and go over the top
  const toPlayer = Vector3.normalize(Vector3.create(start.x - E.x, 0, start.z - E.z))
  // a point on the Earth-player line at horizontal distance d from the Earth, at absolute height y
  const onLine = (d: number, y: number) => Vector3.create(E.x + toPlayer.x * d, y, E.z + toPlayer.z * d)
  // the Earth's near side is only ~3 m outside the glass, so we slip past it sideways (towards the
  // street side of the set when there is a choice) and climb over the top
  const sideRaw = Vector3.create(toPlayer.z, 0, -toPlayer.x)
  const side = sideRaw.z <= 0 ? sideRaw : Vector3.scale(sideRaw, -1)
  const beside = (p: Vector3, m: number) => Vector3.add(p, Vector3.scale(side, m))
  const up = Vector3.Up()
  const far = Vector3.add(E, Vector3.scale(toPlayer, 30))
  // horizontal distance from the Earth to the dome glass along the approach line
  const glassD = Math.hypot(E.x - CENTER.x, E.z - CENTER.z) - DOME_RADIUS

  const earth = W(E)
  const city = S(CITY_POS.x, CITY_POS.y, CITY_POS.z)
  const screen = R(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.z)
  const window = Vector3.clone(WINDOW_C)

  const keys: KeyIn[] = [
    { name: 'start', q: W(start), look: W(Vector3.add(start, Vector3.scale(forward, 40))), focus: earth, tension: 1 },
    { name: 'approach', q: W(Vector3.add(start, Vector3.scale(Vector3.normalize(Vector3.subtract(far, start)), Vector3.distance(start, far) * 0.55))), look: earth, minDt: 3 },
    { name: 'inside', q: W(beside(onLine(glassD + 4, 11.5), 6)), look: earth, minDt: 1.8 }, // inside, at window height (the deck is close: not too quick)
    { name: 'glass', q: W(beside(onLine(glassD - 3, 14), 13)), look: earth }, // through the glass (glint), beside the planet
    { name: 'top', q: W(beside(Vector3.add(Vector3.add(E, Vector3.scale(toPlayer, 3)), Vector3.scale(up, 15.5)), 5)), look: W(Vector3.add(E, Vector3.scale(up, 2))) },
    // from here on the heading stays +Z. Out of the clouds the downtown is in view ahead; the dive
    // steepens onto the patch (the street set at 1/4) until it fills the frame.
    { name: 'sky', q: S(0.3, 8.5, -7), look: city },
    { name: 'dive', q: S(0.3, 5.2, -7.8), look: Vector3.lerp(city, TOWN_LOOK0, 0.55), focus: TOWN_LOOK0 },
    { name: 'swap', q: Vector3.clone(TOWN_Q0), look: Vector3.clone(TOWN_LOOK0) }, // the street set grows x4 around the camera here
    // the street at full size
    { name: 'street', q: Vector3.create(-2.2, GROUND_Y + 3.4, -9.3), look: window },
    { name: 'window-out', q: Vector3.create(window.x, window.y, window.z - 2.2), look: window, tension: 0.5 },
    { name: 'window-in', q: Vector3.create(window.x, window.y, window.z + 0.6), look: screen, tension: 0.5 }, // in through the open window
    { name: 'room', q: R(1.2, 1.6, -0.6), look: screen },
    { name: 'tv', q: R(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.z - 1.3), look: screen, tension: 0.5 },
    { name: 'fit', q: R(TV_SCREEN.x, TV_SCREEN.y, TV_SCREEN.z - FIT_DISTANCE), look: screen, tension: 1, weight: 1.3 } // the picture fills the view
  ]
  return retime(keys, FLIGHT_T)
}
