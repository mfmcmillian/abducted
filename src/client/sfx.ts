import { AudioSource, engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { ROOT } from './root'

/**
 * Sound effects. Clips live in sounds/ (generated with ElevenLabs sound generation, trimmed
 * and loudness-normalised with ffmpeg). One-shots are played from a small pool of emitter
 * entities so overlapping plays don't cut each other off; loops get their own entity.
 */
export const SFX = {
  moo: ['sounds/moo-1.mp3', 'sounds/moo-2.mp3', 'sounds/moo-3.mp3'],
  beamHum: 'sounds/beam-hum.mp3',
  beamCharge: 'sounds/beam-charge.mp3',
  catch: 'sounds/catch.mp3',
  miss: 'sounds/miss.mp3',
  lift: 'sounds/lift.mp3',
  ufoArrive: 'sounds/ufo-arrive.mp3',
  ringChime: 'sounds/ring-chime.mp3',
  uiClick: 'sounds/ui-click.mp3',
  roundStart: 'sounds/round-start.mp3',
  roundEnd: 'sounds/round-end.mp3',
  launch: 'sounds/launch.mp3',
  blackHole: 'sounds/black-hole.mp3',
  laser: 'sounds/laser.mp3',
  explosion: 'sounds/explosion.mp3',
  ufoPass: 'sounds/ufo-pass.mp3',
  zoom: 'sounds/zoom.mp3',
  // The abduction pod's voice (ElevenLabs TTS, tools/elevenlabs.mjs) and its seal effect.
  podWelcome: 'sounds/pod-welcome.mp3', // "Step into the pod. The pasture is waiting."  2.3 s
  podSecured: 'sounds/pod-secured.mp3', // "Specimen secured. Hold still."                1.7 s
  podCount: 'sounds/pod-count.mp3', // "Transfer in three... two... one."                2.0 s
  podLaunch: 'sounds/pod-launch.mp3', // "Enjoy the harvest."                            1.2 s
  podReturn: 'sounds/pod-return.mp3', // "Specimen returned. They appear to be enjoying it."
  podSeal: 'sounds/pod-seal.mp3' // hydraulic hiss + force field powering up             2.5 s
} as const

const POOL = 6
const pool: Entity[] = []
let next = 0

function emitter(): Entity {
  if (pool.length < POOL) {
    const e = engine.addEntity()
    Transform.create(e, { parent: ROOT, position: Vector3.Zero() })
    pool.push(e)
    return e
  }
  const e = pool[next]
  next = (next + 1) % POOL
  return e
}

/** Play a one-shot at a world position (spatial). */
export function playAt(src: string, position: Vector3, volume = 1, pitch = 1) {
  const e = emitter()
  Transform.getMutable(e).position = Vector3.clone(position)
  AudioSource.createOrReplace(e, { audioClipUrl: src, playing: true, loop: false, volume, pitch, global: false })
}

/** Play a one-shot that follows the player (non-spatial). */
export function playGlobal(src: string, volume = 1, pitch = 1) {
  const e = emitter()
  AudioSource.createOrReplace(e, { audioClipUrl: src, playing: true, loop: false, volume, pitch, global: true })
}

/** Random moo with a little pitch variety so a herd never sounds like one cow. */
export function moo(position: Vector3, volume = 1) {
  const clip = SFX.moo[Math.floor(Math.random() * SFX.moo.length)]
  playAt(clip, position, volume, 0.9 + Math.random() * 0.25)
}

/** Attach a looping sound to an entity; returns a setter for its volume (0 pauses it). */
export function attachLoop(parent: Entity, src: string, volume: number, global = false) {
  const e = engine.addEntity()
  Transform.create(e, { parent })
  AudioSource.create(e, { audioClipUrl: src, playing: volume > 0, loop: true, volume, global })
  let current = volume
  return (v: number) => {
    if (Math.abs(v - current) < 0.01) return
    current = v
    const a = AudioSource.getMutable(e)
    a.volume = v
    a.playing = v > 0
  }
}
