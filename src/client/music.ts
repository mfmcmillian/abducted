import { AudioAnalysis, engine, Entity } from '@dcl/sdk/ecs'

/**
 * Smoothed audio levels of the music video, read by every music-reactive system.
 * When the explorer does not fill AudioAnalysis (older clients, muted video) the
 * levels fall back to a slow synthetic pulse so the scene never goes dead.
 */
export const music = {
  /** 0..1 overall loudness */
  amplitude: 0,
  /** 0..1 per frequency band, low to high */
  bands: [0, 0, 0, 0, 0, 0, 0, 0],
  /** 0..1 low end, punchy */
  bass: 0,
  /** true on the frame a bass hit is detected */
  beat: false,
  /** true while real analysis data is arriving */
  live: false
}

let bassAverage = 0
let silentFor = 0
let clock = 0
let beatCooldown = 0

export function initMusic(videoEntity: Entity) {
  AudioAnalysis.createAudioAnalysis(videoEntity, undefined, 1.4, 1.6)

  engine.addSystem((dt) => {
    clock += dt
    beatCooldown = Math.max(0, beatCooldown - dt)
    const a = AudioAnalysis.getOrNull(videoEntity)
    const raw = a ? [a.band0, a.band1, a.band2, a.band3, a.band4, a.band5, a.band6, a.band7] : null
    const amplitude = a ? a.amplitude : 0
    const anySignal = raw !== null && (amplitude > 0.001 || raw.some((b) => b > 0.001))

    if (anySignal) {
      silentFor = 0
      music.live = true
    } else {
      silentFor += dt
      if (silentFor > 3) music.live = false
    }

    // Smooth: fast attack, slower release.
    const follow = (current: number, target: number) => {
      const k = target > current ? 1 - Math.exp(-dt * 18) : 1 - Math.exp(-dt * 6)
      return current + (target - current) * k
    }

    if (music.live && raw) {
      for (let i = 0; i < 8; i++) music.bands[i] = follow(music.bands[i], clamp01(raw[i]))
      music.amplitude = follow(music.amplitude, clamp01(amplitude))
    } else {
      // Synthetic groove at ~124 bpm.
      const beatPhase = (clock * 124) / 60
      const pulse = Math.pow(Math.max(0, Math.cos(beatPhase * Math.PI * 2)), 6)
      for (let i = 0; i < 8; i++) {
        const wave = 0.35 + 0.3 * Math.sin(clock * (0.9 + i * 0.37) + i)
        music.bands[i] = follow(music.bands[i], clamp01(wave + pulse * (i < 2 ? 0.5 : 0.15)))
      }
      music.amplitude = follow(music.amplitude, 0.45 + 0.4 * pulse)
    }

    const bass = clamp01(music.bands[0] * 0.65 + music.bands[1] * 0.35)
    music.bass = bass
    bassAverage += (bass - bassAverage) * (1 - Math.exp(-dt * 1.5))
    music.beat = false
    if (beatCooldown === 0 && bass > bassAverage * 1.25 + 0.08) {
      music.beat = true
      beatCooldown = 0.28
    }
  })
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
