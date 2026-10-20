import {
  AudioSource,
  Billboard,
  BillboardMode,
  ColliderLayer,
  engine,
  Entity,
  Font,
  GltfContainer,
  InputAction,
  LightSource,
  Material,
  MeshCollider,
  MeshRenderer,
  pointerEventsSystem,
  TextAlignMode,
  TextShape,
  Transform,
  VideoPlayer
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, SPAWN } from '../layout'
import { COSMOS_TIERS } from '../shared/cosmos'
import { cosmosTier, onCosmosTier } from './cosmos'
import { onLanguage, t } from './i18n'
import { RADIO_EPISODES, RadioEpisode } from './radioScript'
import { ROOT } from './root'
import { playAt, SFX } from './sfx'
import { toast } from './ui'

/**
 * Dale and Tammy's radio show: the couple the beam took by mistake, broadcasting from somewhere
 * aboard. Episodes unlock as the whole World feeds the black hole (cosmos tiers), so the lore
 * arrives as the community plays. Click the set to hear the next unlocked episode; subtitles
 * run as toasts. Audio is local to whoever clicks.
 */
const SPOT = Vector3.create(SPAWN.x - 6, 0, SPAWN.z + 4)
const TABLE_H = 0.9
const RADIO_SCALE = 1.2
const RADIO_H = 1.161 * RADIO_SCALE
const AMBER = Color3.create(1, 0.7, 0.25)
const NAME: Record<'dale' | 'tammy', string> = { dale: 'Dale', tammy: 'Tammy' }
const MUSIC_VOLUME = 0.8 // what dome.ts starts the music video at
const DUCKED_VOLUME = 0.08 // the room's music while an episode plays

let radio: Entity
let speaker: Entity // dedicated emitter: the episode plays from here, spatial, at the set
let domeVideo: Entity
let label: Entity
let light: Entity
// t runs from -LEAD_IN: the 'volume up' card shows first, the audio starts when t crosses 0
let playing: { ep: RadioEpisode; t: number; next: number; started: boolean } | null = null
const LEAD_IN = 2.6
let lastPlayed = -1 // index into RADIO_EPISODES
let clock = 0

const unlocked = () => RADIO_EPISODES.filter((e) => e.tier <= cosmosTier())

function refreshLabel() {
  if (!label) return
  const have = unlocked().length
  const next = RADIO_EPISODES.find((e) => e.tier > cosmosTier())
  const lines = [t('DALE & TAMMY  ·  LIVE FROM THE COW SHIP')]
  if (playing) lines.push(t('ON AIR  ·  Episode {0}: {1}', RADIO_EPISODES.indexOf(playing.ep) + 1, t(playing.ep.title)))
  else lines.push(have > 0 ? t('{0} episodes on the dial  ·  click to listen', have) : t('click to listen'))
  if (next) lines.push(t('next episode when the hole has eaten {0} cows', COSMOS_TIERS[next.tier]))
  TextShape.getMutable(label).text = lines.join('\n')
}

function stop() {
  if (!playing) return
  playing = null
  if (AudioSource.has(speaker)) AudioSource.getMutable(speaker).playing = false
  VideoPlayer.getMutable(domeVideo).volume = MUSIC_VOLUME
  refreshLabel()
}

function play(index: number) {
  const ep = RADIO_EPISODES[index]
  lastPlayed = index
  playing = { ep, t: -LEAD_IN, next: 0, started: false }
  VideoPlayer.getMutable(domeVideo).volume = DUCKED_VOLUME
  refreshLabel()
  toast(t('VOLUME UP  ·  Episode {0}: {1}', index + 1, t(ep.title)), LEAD_IN + 0.4)
}

function onClick() {
  playAt(SFX.radioTune, Vector3.create(SPOT.x, TABLE_H + 0.6, SPOT.z), 0.8)
  if (playing) return stop()
  const list = unlocked()
  if (!list.length) return
  // first click plays the newest episode; after that, cycle from the start
  const newest = RADIO_EPISODES.indexOf(list[list.length - 1])
  const index = lastPlayed < 0 ? newest : (lastPlayed + 1) % list.length
  play(index)
}

function radioSystem(dt: number) {
  clock += dt
  const glow = playing ? 0.75 + Math.sin(clock * 6) * 0.25 : 0.45 + Math.sin(clock * 1.4) * 0.15
  LightSource.getMutable(light).intensity = 60 + glow * 160
  if (!playing) return
  playing.t += dt
  const { ep } = playing
  if (!playing.started) {
    if (playing.t < 0) return
    playing.started = true
    // global: full volume for the listener wherever they stand; the episode is local to whoever clicked
    AudioSource.createOrReplace(speaker, { audioClipUrl: ep.src, playing: true, loop: false, volume: 1, global: true })
  }
  while (playing.next < ep.cues.length && ep.cues[playing.next].at <= playing.t) {
    const cue = ep.cues[playing.next++]
    toast(`${NAME[cue.who]}:  ${t(cue.text)}`, cue.seconds + 0.6)
  }
  if (playing.t >= ep.seconds + 0.5) stop()
}

export function createRadio(video: Entity) {
  domeVideo = video
  const yaw = (Math.atan2(CENTER.x - SPOT.x, CENTER.z - SPOT.z) * 180) / Math.PI // model front is +Z
  const table = engine.addEntity()
  Transform.create(table, { parent: ROOT, position: Vector3.create(SPOT.x, TABLE_H / 2, SPOT.z), rotation: Quaternion.fromEulerDegrees(0, yaw, 0), scale: Vector3.create(2.4, TABLE_H, 1.1) })
  MeshRenderer.setBox(table)
  MeshCollider.setBox(table, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  Material.setPbrMaterial(table, { albedoColor: Color4.create(0.05, 0.08, 0.09, 1), emissiveColor: Color3.create(0.1, 0.5, 0.45), emissiveIntensity: 0.6, metallic: 0.7, roughness: 0.3 })

  radio = engine.addEntity()
  Transform.create(radio, { parent: ROOT, position: Vector3.create(SPOT.x, TABLE_H + RADIO_H / 2, SPOT.z), rotation: Quaternion.fromEulerDegrees(0, yaw, 0), scale: Vector3.create(RADIO_SCALE, RADIO_SCALE, RADIO_SCALE) })
  GltfContainer.create(radio, { src: 'models/alien-radio.glb', visibleMeshesCollisionMask: ColliderLayer.CL_POINTER, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })

  speaker = engine.addEntity()
  Transform.create(speaker, { parent: ROOT, position: Vector3.create(SPOT.x, TABLE_H + RADIO_H / 2, SPOT.z) })

  light = engine.addEntity()
  Transform.create(light, { parent: ROOT, position: Vector3.create(SPOT.x, TABLE_H + RADIO_H + 0.6, SPOT.z) })
  LightSource.create(light, { active: true, color: AMBER, intensity: 120, range: 7, shadow: false, type: LightSource.Type.Point({}) })

  label = engine.addEntity()
  Transform.create(label, { parent: ROOT, position: Vector3.create(SPOT.x, TABLE_H + RADIO_H + 1.3, SPOT.z) })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(label, { text: '', fontSize: 1.6, font: Font.F_SANS_SERIF, textColor: Color4.create(1, 0.85, 0.5, 1), outlineColor: Color4.Black(), outlineWidth: 0.12, textAlign: TextAlignMode.TAM_MIDDLE_CENTER, lineSpacing: 8 })

  for (const e of [radio, table]) pointerEventsSystem.onPointerDown({ entity: e, opts: { button: InputAction.IA_POINTER, hoverText: t('Listen to the radio'), maxDistance: 10 } }, onClick)

  engine.addSystem(radioSystem)
  onLanguage(refreshLabel)
  onCosmosTier((_tier, first) => {
    refreshLabel()
    if (first) return
    const fresh = RADIO_EPISODES.filter((e) => e.tier === cosmosTier())
    if (fresh.length) {
      playAt(SFX.radioTune, Vector3.create(SPOT.x, TABLE_H + 0.6, SPOT.z), 0.8)
      toast(t('New episode on the radio by the door: "{0}"', t(fresh[0].title)), 8)
    }
  })
}
