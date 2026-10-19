import { AudioSource, engine, Entity, InputAction, InputModifier, inputSystem, MainCamera, PointerEventType, Transform, VirtualCamera } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { CARGO_BAY, CENTER, FORMATION, LAUNCH_PAD, LAUNCHER, LEADERBOARD, SPAWN } from '../layout'
import { ROOT } from './root'
import { t } from './i18n'
import { earthPosition } from './space'
import { toast, zoomUi } from './ui'

/**
 * The ship's tour: click the greeter cow and the camera glides from station to station while the
 * ship explains why it is here (the black hole is hungry), what it came for (cows) and what went
 * wrong (the couple). Scripted camera on a VirtualCamera parented to ROOT, voice lines in
 * sounds/tour-*.mp3 (ElevenLabs, alien-processed), subtitles via toast. E skips the whole thing.
 */

type Stop = { cam: Vector3; look: Vector3; drift: Vector3; voice: string; text: string; seconds: number }

const TRANSITION = 2.4 // seconds gliding between stops
const PAUSE = 0.6 // breath after each line

/** Camera pulled back from a wall station toward the dome centre. */
function wall(station: Vector3, dist: number, height: number, lookY: number, side = 0): { cam: Vector3; look: Vector3 } {
  const dx = CENTER.x - station.x, dz = CENTER.z - station.z
  const len = Math.sqrt(dx * dx + dz * dz)
  const ux = dx / len, uz = dz / len
  // side: slide the camera along the wall (perpendicular to the inward direction)
  return {
    cam: Vector3.create(station.x + ux * dist - uz * side, height, station.z + uz * dist + ux * side),
    look: Vector3.create(station.x, lookY, station.z)
  }
}

function stop(pose: { cam: Vector3; look: Vector3 }, drift: Vector3, index: number, text: string, seconds: number): Stop {
  return { ...pose, drift, voice: `sounds/tour-${String(index).padStart(2, '0')}.mp3`, text, seconds }
}

const COW = Vector3.create(SPAWN.x + 5, 0, SPAWN.z + 3)

function buildStops(): Stop[] {
  const earth = earthPosition()
  return [
    stop({ cam: Vector3.create(COW.x - 4.5, 2.4, COW.z - 3.5), look: Vector3.create(COW.x, 1.5, COW.z) }, Vector3.create(1.2, 0.2, 0.6), 0,
      '"Moo. ...Apologies, wrong channel. This is the ship. You clicked the cow. Everyone clicks the cow. Very well: the tour."', 9.3),
    stop({ cam: Vector3.create(CENTER.x + 8, 9, CENTER.z + 10), look: Vector3.create(CENTER.x - 4, 2, CENTER.z - 14) }, Vector3.create(-6, 1, 0), 1,
      '"This ship runs on a black hole. It will eat anything, but it only purrs on organic matter: carbon, water, a little grass. Feed it rocks and it sulks, and the lights go out. Ours was starting to sulk."', 16.3),
    stop({ cam: Vector3.create(CENTER.x, 5, CENTER.z), look: Vector3.create(earth.x, earth.y, earth.z) }, Vector3.create(0, 1.5, 0), 2,
      '"So we went shopping. Third planet from that star, the blue one. Earth. Over a billion cows. Dense, docile, mostly water, and nobody counts them."', 10.6),
    stop(wall(LAUNCH_PAD, 15, 5, 4.5, 3), Vector3.create(-3, 1, 0), 3,
      '"The transfer pod. Step inside and we drop you in a saucer over the pastures. Beam up as many cows as you can before the farmers notice. Yes, the pod is large. We had a budget."', 10.9),
    stop(wall(CARGO_BAY, 11, 4, 1.2, 2), Vector3.create(-2.5, 0.3, 0), 4,
      '"Everything you beam up lands here, in the cargo bay. Pick one up — they do not mind — and carry it to the launcher."', 6.3),
    stop(wall(LAUNCHER, 12, 4.5, 3, -3), Vector3.create(2, 2, 0), 5,
      '"The launcher. It feeds the black hole out past the glass. Every cow you throw in earns kudos. Kudos is a currency. It buys nothing. We are very proud of it."', 10.3),
    stop(wall(LEADERBOARD, 12, 5, 5), Vector3.create(1.5, 0.5, 0), 6,
      '"Your catches go on the board. The finest abductors in the fleet. Most of them are you."', 4.7),
    stop(wall(FORMATION.NE, 15, 5, 4.5, -3), Vector3.create(3, 0.5, 0), 7,
      '"Now, the mistake. On the fourth pass the beam took a couple: two humans, from a pickup truck, mid-argument. Protocol says return them. Oddly enough... they did not want to go. They danced. We recorded it. You may own the dance."', 15.4),
    stop(wall(FORMATION.SE, 15, 5, 4.5, 3), Vector3.create(-3, 0.5, 0), 8,
      '"They also asked for suits like ours. We said no. They made their own. They are, honestly, better than ours."', 6.5),
    stop(wall(FORMATION.SW, 14, 5, 5, -3), Vector3.create(3, 0.5, 0), 9,
      '"A gift from friends in another world: the Guildstone ring. Free to claim. Take one. It is not organic. We checked."', 7.4),
    stop(wall(FORMATION.NW, 14, 5, 4.5, 3), Vector3.create(-3, 0.5, 0), 10,
      '"That portal leads to the dungeons. Different ship. Different problems."', 4.2),
    stop({ cam: Vector3.create(COW.x - 5, 2.6, COW.z - 2), look: Vector3.create(COW.x, 1.5, COW.z) }, Vector3.create(1.5, 0, 1), 11,
      '"That is the tour. The pod is waiting. Bring us cows. And if you meet the couple... they are the ones enjoying it."', 6.7)
  ]
}

let camera: Entity
type Tour = { stops: Stop[]; index: number; t: number; from: { cam: Vector3; look: Vector3 }; said: boolean }
let tour: Tour | null = null
let voice: Entity // dedicated speaker so a long line is never cut off by the SFX pool

function setPlayerLocked(locked: boolean) {
  if (locked) InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  else if (InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
}

export const tourRunning = () => tour !== null

export function initTour() {
  camera = engine.addEntity()
  Transform.create(camera, { parent: ROOT, position: Vector3.create(0, -100, 0) })
  VirtualCamera.create(camera, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.8) } })
  voice = engine.addEntity()
  Transform.create(voice, { parent: ROOT })
  engine.addSystem(tourSystem)
}

export function startTour() {
  if (tour) return
  const stops = buildStops()
  const cam = Transform.get(engine.CameraEntity)
  const start = { cam: Vector3.subtract(cam.position, Transform.get(ROOT).position), look: Vector3.add(Vector3.subtract(cam.position, Transform.get(ROOT).position), Vector3.rotate(Vector3.Forward(), cam.rotation)) }
  tour = { stops, index: 0, t: 0, from: start, said: false }
  const tr = Transform.getMutable(camera)
  tr.position = start.cam
  tr.rotation = Quaternion.fromLookAt(start.cam, start.look)
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: camera })
  setPlayerLocked(true)
  zoomUi.active = true
  zoomUi.white = 0
  zoomUi.hint = t('E to skip the tour')
}

function endTour() {
  if (!tour) return
  tour = null
  if (AudioSource.has(voice)) AudioSource.getMutable(voice).playing = false
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
  setPlayerLocked(false)
  zoomUi.active = false
  zoomUi.hint = ''
  toast(t('Click the cow any time for the tour again.'), 5)
}

const ease = (k: number) => k * k * (3 - 2 * k)

function tourSystem(dt: number) {
  const z = tour
  if (!z) return
  if (inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) return endTour()
  z.t += dt
  const s = z.stops[z.index]
  const hold = s.seconds + PAUSE
  let cam: Vector3, look: Vector3
  if (z.t < TRANSITION) {
    const k = ease(z.t / TRANSITION)
    cam = Vector3.lerp(z.from.cam, s.cam, k)
    look = Vector3.lerp(z.from.look, s.look, k)
  } else {
    const k = Math.min(1, (z.t - TRANSITION) / hold)
    cam = Vector3.add(s.cam, Vector3.scale(s.drift, k))
    look = s.look
    if (!z.said) {
      z.said = true
      AudioSource.createOrReplace(voice, { audioClipUrl: s.voice, playing: true, loop: false, volume: 1, global: true })
      toast(t(s.text), s.seconds + PAUSE + 0.5)
    }
    if (k >= 1) {
      z.from = { cam, look }
      z.index++
      z.t = 0
      z.said = false
      if (z.index >= z.stops.length) return endTour()
    }
  }
  const tr = Transform.getMutable(camera)
  tr.position = cam
  tr.rotation = Quaternion.fromLookAt(cam, look)
}
