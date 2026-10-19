import { engine, Entity, InputModifier, LightSource, Material, MaterialTransparencyMode, MeshRenderer, Transform } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { CENTER, DOME_CAP, DOME_WALL, SPAWN } from '../layout'
import { burstImpact, puffTrail } from './fx'
import { attachLoop, playAt, SFX } from './sfx'
import { zoomUi } from './ui'

/**
 * You were just beamed up. The mothership parked under the apex drops its tractor beam onto the
 * arrival pad in the middle of the room the moment the scene has you: the beam column snaps
 * down from the hull, a flash and a swirl of sparks at your feet, you are held for a moment
 * while you "materialise", then the beam retracts and the pad settles to a slow idle glow.
 *
 * Replaces the old emote-props diorama in the centre.
 */

const BEAM = Color3.create(0.45, 1, 0.75)
const PAD_R = 3.2
const HULL_Y = DOME_WALL + DOME_CAP - 7 - 0.4 // bottom of the apex saucer (dome.ts createApexUfo)
const FLOOR_Y = 0.08

const SNAP_T = 0.35 // beam reaches the floor
const HOLD_T = 2.4 // you stand in it
const RETRACT_T = 0.9
const TOTAL_T = SNAP_T + HOLD_T + RETRACT_T

let beam: Entity
let padRing: Entity
let padLight: Entity
let setHum: (v: number) => void = () => {}
let seq: { t: number; locked: boolean } | null = null
let idleClock = 0

function beamMaterial(alpha: number, glow: number) {
  Material.setPbrMaterial(beam, {
    albedoColor: Color4.create(BEAM.r, BEAM.g, BEAM.b, alpha),
    emissiveColor: BEAM,
    emissiveIntensity: glow,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
    roughness: 1,
    metallic: 0
  })
}

/** Beam column from the hull down to `bottom` (world y). */
function setBeam(bottom: number, radius: number) {
  const h = Math.max(0.01, HULL_Y - bottom)
  const t = Transform.getMutable(beam)
  t.position = Vector3.create(CENTER.x, bottom + h / 2, CENTER.z)
  t.scale = Vector3.create(radius * 2, h, radius * 2)
}

export function createArrivalBeam() {
  // the pad: a glowing ring on the floor where you land
  padRing = engine.addEntity()
  Transform.create(padRing, { position: Vector3.create(CENTER.x, 0.05, CENTER.z), scale: Vector3.create(PAD_R * 2, 0.04, PAD_R * 2) })
  MeshRenderer.setCylinder(padRing)
  Material.setPbrMaterial(padRing, { albedoColor: Color4.create(0.02, 0.06, 0.05, 1), emissiveColor: BEAM, emissiveIntensity: 0.6, roughness: 0.6 })

  padLight = engine.addEntity()
  Transform.create(padLight, { position: Vector3.create(CENTER.x, 4, CENTER.z) })
  LightSource.create(padLight, { active: true, color: BEAM, intensity: 300, range: 14, shadow: false, type: LightSource.Type.Point({}) })

  beam = engine.addEntity()
  Transform.create(beam, { position: Vector3.create(CENTER.x, HULL_Y, CENTER.z), scale: Vector3.create(0.01, 0.01, 0.01) })
  MeshRenderer.setCylinder(beam, 1, 0.8)
  beamMaterial(0, 0)
  setHum = attachLoop(beam, SFX.beamHum, 0)

  engine.addSystem(system)
}

/** Fires a beat after the engine knows where the player is (so the world has drawn in first). */
let started = false
let armIn = 1.2

function startArrival() {
  started = true
  seq = { t: 0, locked: true }
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  playAt(SFX.lift, Vector3.create(SPAWN.x, 2, SPAWN.z), 1)
  setHum(0.7)
  zoomUi.white = 0.7
}

const easeOut = (x: number) => 1 - (1 - x) * (1 - x)

function system(dt: number) {
  if (!started) {
    if (!Transform.getOrNull(engine.PlayerEntity)) return
    armIn -= dt
    if (armIn <= 0) startArrival()
    return
  }
  idleClock += dt

  if (!seq) {
    // idle: the pad breathes and a faint shimmer hangs in the beam's path
    const g = 0.5 + 0.5 * Math.sin(idleClock * 1.4)
    Material.setPbrMaterial(padRing, { albedoColor: Color4.create(0.02, 0.06, 0.05, 1), emissiveColor: BEAM, emissiveIntensity: 0.4 + 0.5 * g, roughness: 0.6 })
    LightSource.getMutable(padLight).intensity = 200 + 200 * g
    return
  }

  seq.t += dt
  const t = seq.t
  // the UI flash fades fast whatever the phase
  zoomUi.white = Math.max(0, zoomUi.white - dt * 1.6)

  if (t < SNAP_T) {
    const u = easeOut(t / SNAP_T)
    setBeam(HULL_Y - (HULL_Y - FLOOR_Y) * u, PAD_R * 0.9)
    beamMaterial(0.35, 3)
    return
  }
  if (t < SNAP_T + HOLD_T) {
    const u = (t - SNAP_T) / HOLD_T
    if (seq.t - dt < SNAP_T) burstImpact(Vector3.create(CENTER.x, 0.4, CENTER.z), BEAM, 2.5) // the moment it lands
    setBeam(FLOOR_Y, PAD_R * (0.9 + 0.06 * Math.sin(idleClock * 9)))
    beamMaterial(0.3 - 0.1 * u, 2.6 + Math.sin(idleClock * 7) * 0.5)
    LightSource.getMutable(padLight).intensity = 1600
    // sparks spiralling up around you
    if (Math.random() < 0.6) {
      const a = idleClock * 5 + Math.random() * 0.8
      const r = 1.2 + Math.random() * 1.2
      puffTrail(Vector3.create(CENTER.x + Math.sin(a) * r, 0.3 + u * 3.5 + Math.random(), CENTER.z + Math.cos(a) * r), BEAM, 0.5)
    }
    // let go a little before the beam lifts, so the release feels like the beam setting you down
    if (u > 0.8 && seq.locked) {
      seq.locked = false
      if (InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
    }
    return
  }
  if (t < TOTAL_T) {
    const u = (t - SNAP_T - HOLD_T) / RETRACT_T
    setBeam(FLOOR_Y + (HULL_Y - FLOOR_Y) * easeOut(u), PAD_R * 0.9 * (1 - u * 0.5))
    beamMaterial(0.25 * (1 - u), 2.5 * (1 - u))
    setHum(0.7 * (1 - u))
    LightSource.getMutable(padLight).intensity = 1600 - 1300 * u
    return
  }
  // done
  if (seq.locked && InputModifier.has(engine.PlayerEntity)) InputModifier.deleteFrom(engine.PlayerEntity)
  Transform.getMutable(beam).scale = Vector3.create(0.01, 0.01, 0.01)
  beamMaterial(0, 0)
  setHum(0)
  seq = null
}
