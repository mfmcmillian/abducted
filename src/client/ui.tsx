import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Button, Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

/** One-line toast at the bottom centre of the screen. */
let toastText = ''
let toastUntil = 0
let now = 0

export function toast(text: string, seconds = 7) {
  toastText = text
  toastUntil = now + seconds
}

export type HudMode = 'hidden' | 'practice' | 'countdown' | 'playing' | 'finalizing' | 'results'
export type BeamState = 'ready' | 'charging' | 'active' | 'cooldown'

/** Cow game HUD state, written by client/game.ts. */
export const hud = {
  mode: 'hidden' as HudMode,
  score: 0,
  cows: 0,
  /** multiplier the next catch will get */
  combo: 1,
  secondsLeft: 0,
  beam: 'ready' as BeamState,
  /** near the fence */
  edge: false,
  /** practice: has the tutorial cow been caught */
  practiceDone: false,
  /** 3, 2, 1, GO */
  countdown: '',
  results: { score: 0, cows: 0, attempts: 0, successes: 0, best: 0, isBest: false, saved: '' },
  onSkip: () => {},
  onReplay: () => {},
  onExit: () => {},
  /** quit mid-round and go back down to the dome */
  onLeave: () => {}
}

/** Kudos loop readout (cargo bay / launcher / black hole), written by client/cargo.ts. */
export const kudosHud = { synced: false, kudos: 0, cargo: 0, launched: 0, nextHoleIn: 0, carrying: false }

const GREEN = Color4.create(0.6, 1, 0.75, 1)
const DIM = Color4.create(0.7, 0.8, 0.9, 0.9)
const PANEL = Color4.create(0.02, 0.04, 0.06, 0.82)

function Toast() {
  if (!toastText || now > toastUntil) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        justifyContent: 'center',
        alignItems: 'flex-end',
        flexDirection: 'row',
        padding: { bottom: 110 }
      }}
    >
      <UiEntity uiTransform={{ padding: { top: 10, bottom: 10, left: 22, right: 22 }, maxWidth: 720 }} uiBackground={{ color: Color4.create(0.02, 0.05, 0.03, 0.85) }}>
        <Label value={toastText} fontSize={18} color={GREEN} textAlign="middle-center" />
      </UiEntity>
    </UiEntity>
  )
}

function formatTime(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r < 10 ? '0' : ''}${r}`
}

const BEAM_LABEL: Record<BeamState, [string, Color4]> = {
  ready: ['BEAM READY', GREEN],
  charging: ['CHARGING...', Color4.create(1, 0.9, 0.4, 1)],
  active: ['BEAM ACTIVE', Color4.create(0.5, 0.95, 1, 1)],
  cooldown: ['COOLDOWN', Color4.create(0.6, 0.6, 0.65, 1)]
}

/** Timer, score, cows and combo across the top; readiness and edge warning lower centre. */
function PlayingHud() {
  const inRound = hud.mode === 'playing' || hud.mode === 'finalizing'
  const lastTen = inRound && hud.secondsLeft <= 10
  const [beamText, beamColor] = BEAM_LABEL[hud.beam]
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, justifyContent: 'flex-start', alignItems: 'center', flexDirection: 'column', padding: { top: 24 } }}
    >
      <UiEntity uiTransform={{ padding: { top: 8, bottom: 8, left: 26, right: 26 }, flexDirection: 'row', alignItems: 'center' }} uiBackground={{ color: PANEL }}>
        <Label value={inRound ? formatTime(hud.secondsLeft) : 'PRACTICE'} fontSize={lastTen ? 34 : 26} color={lastTen ? Color4.create(1, 0.45, 0.4, 1) : Color4.White()} />
        <UiEntity uiTransform={{ width: 36 }} />
        <Label value={`SCORE  ${hud.score}`} fontSize={26} color={GREEN} />
        <UiEntity uiTransform={{ width: 36 }} />
        <Label value={`COWS  ${hud.cows}`} fontSize={26} color={Color4.White()} />
        <UiEntity uiTransform={{ width: 36 }} />
        <Label value={`x${hud.combo.toFixed(2)}`} fontSize={22} color={hud.combo > 1 ? Color4.create(1, 0.85, 0.4, 1) : DIM} />
      </UiEntity>
      <UiEntity uiTransform={{ height: 6 }} />
      <Label value="WASD to fly  ·  look at a cow, click or E to drop the beam" fontSize={14} color={DIM} />

      <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 24, right: 24 } }}>
        <Button value="LEAVE GAME" variant="secondary" fontSize={15} uiTransform={{ width: 150, height: 36 }} onMouseDown={() => hud.onLeave()} />
      </UiEntity>

      <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: 150 }, flexDirection: 'column', alignItems: 'center' }}>
        {hud.edge ? <Label value="EDGE OF THE PASTURE" fontSize={16} color={Color4.create(1, 0.5, 0.4, 1)} /> : null}
        <UiEntity uiTransform={{ padding: { top: 6, bottom: 6, left: 18, right: 18 } }} uiBackground={{ color: PANEL }}>
          <Label value={beamText} fontSize={18} color={beamColor} />
        </UiEntity>
      </UiEntity>

      {hud.mode === 'practice' ? (
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: '20%' }, padding: { top: 14, bottom: 14, left: 30, right: 30 }, flexDirection: 'column', alignItems: 'center' }} uiBackground={{ color: PANEL }}>
          <Label value={hud.practiceDone ? 'GOT ONE!' : 'PRACTICE'} fontSize={28} color={GREEN} textAlign="middle-center" />
          <UiEntity uiTransform={{ height: 6 }} />
          <Label
            value={hud.practiceDone ? 'the real round starts in a moment' : 'no clock yet: fly over to the cow, look at it, click or E to drop the beam\nthe beam needs a moment to grab, so lead the cow a little'}
            fontSize={16}
            color={Color4.White()}
            textAlign="middle-center"
          />
          {!hud.practiceDone ? (
            <UiEntity uiTransform={{ margin: { top: 12 } }}>
              <Button value="SKIP PRACTICE  (F)" variant="secondary" fontSize={16} uiTransform={{ width: 200, height: 36 }} onMouseDown={() => hud.onSkip()} />
            </UiEntity>
          ) : null}
        </UiEntity>
      ) : null}

      {hud.countdown ? (
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: '34%' }, padding: { top: 18, bottom: 18, left: 60, right: 60 }, flexDirection: 'column', alignItems: 'center' }} uiBackground={{ color: PANEL }}>
          <Label value={hud.countdown} fontSize={72} color={GREEN} textAlign="middle-center" />
          <Label value="3 minutes · catch as many cows as you can" fontSize={16} color={Color4.White()} textAlign="middle-center" />
        </UiEntity>
      ) : null}

      {hud.mode === 'finalizing' ? (
        <UiEntity uiTransform={{ positionType: 'absolute', position: { top: '38%' }, padding: { top: 18, bottom: 18, left: 40, right: 40 } }} uiBackground={{ color: PANEL }}>
          <Label value="TIME!" fontSize={48} color={GREEN} textAlign="middle-center" />
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

function Results() {
  const r = hud.results
  const accuracy = r.attempts > 0 ? Math.round((r.successes / r.attempts) * 100) : 0
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
      <UiEntity uiTransform={{ padding: { top: 22, bottom: 22, left: 48, right: 48 }, flexDirection: 'column', alignItems: 'center', minWidth: 420 }} uiBackground={{ color: Color4.create(0.02, 0.04, 0.06, 0.92) }}>
        <Label value="ROUND OVER" fontSize={22} color={DIM} textAlign="middle-center" />
        <Label value={`${r.score}`} fontSize={64} color={GREEN} textAlign="middle-center" />
        <Label value={r.isBest ? 'NEW BEST THIS SESSION' : `best this session  ${r.best}`} fontSize={16} color={r.isBest ? Color4.create(1, 0.85, 0.4, 1) : DIM} textAlign="middle-center" />
        <UiEntity uiTransform={{ height: 14 }} />
        <UiEntity uiTransform={{ flexDirection: 'row' }}>
          <Stat label="COWS" value={`${r.cows}`} />
          <Stat label="DROPS" value={`${r.attempts}`} />
          <Stat label="CATCHES" value={`${r.successes}`} />
          <Stat label="ACCURACY" value={`${accuracy}%`} />
        </UiEntity>
        <UiEntity uiTransform={{ height: 10 }} />
        <Label value={r.saved} fontSize={13} color={DIM} textAlign="middle-center" />
        <UiEntity uiTransform={{ height: 14 }} />
        <UiEntity uiTransform={{ flexDirection: 'row' }}>
          <Button value="PLAY AGAIN  (E)" variant="primary" fontSize={18} uiTransform={{ width: 200, height: 44, margin: { right: 12 } }} onMouseDown={() => hud.onReplay()} />
          <Button value="BACK TO THE DOME  (F)" variant="secondary" fontSize={18} uiTransform={{ width: 250, height: 44 }} onMouseDown={() => hud.onExit()} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

function Stat(props: { label: string; value: string }) {
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', alignItems: 'center', margin: { left: 14, right: 14 } }}>
      <Label value={props.value} fontSize={26} color={Color4.White()} textAlign="middle-center" />
      <Label value={props.label} fontSize={12} color={DIM} textAlign="middle-center" />
    </UiEntity>
  )
}

const PINK = Color4.create(1, 0.55, 0.85, 1)
const PURPLE_UI = Color4.create(0.8, 0.6, 1, 1)
// the Antrom AFK dock's look: same panel texture (images/ui-panel.png), slices, colour and sizes
const NAVY_SOFT = Color4.fromHexString('#2a3550f2')
const PANEL_TEX = { textureMode: 'nine-slices' as const, texture: { src: 'images/ui-panel.png' }, textureSlices: { top: 36 / 128, bottom: 36 / 128, left: 36 / 128, right: 36 / 128 }, color: NAVY_SOFT }
const icon = (src: string) => ({ textureMode: 'stretch' as const, texture: { src } })

/**
 * Design-pixel scale, as the Antrom wearable does it: the HUD keeps a constant fraction of the
 * usable screen height (designed at 1080), clamped so it never gets silly on odd canvases.
 */
function hudLayout() {
  const info = UiCanvasInformation.getOrNull(engine.RootEntity)
  const area = info?.interactableArea
  const canvas = { w: info?.width || 1920, h: info?.height || 1080, left: area?.left ?? 0, top: area?.top ?? 0, bottom: area?.bottom ?? 0 }
  const scale = info?.width ? Math.max(0.55, Math.min(1.3, (canvas.h - canvas.top - canvas.bottom) / 1080)) : 1
  return { canvas, S: (n: number) => Math.round(n * scale * 100) / 100 }
}

/** One line of the panel: icon tile, a bold value, a small caption. Every text has a height so the rows stack. */
function PanelRow(props: { icon: string; value: string; caption: string; S: (n: number) => number; color?: Color4 }) {
  const { S } = props
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', width: '100%', height: S(74), margin: { top: S(10) } }}>
      <UiEntity uiTransform={{ width: S(64), height: S(64), flexShrink: 0 }} uiBackground={icon(props.icon)} />
      <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1, flexShrink: 1, minWidth: 0, margin: { left: S(14) }, justifyContent: 'center' }}>
        <Label value={props.value} fontSize={S(26)} color={props.color ?? Color4.White()} textAlign="middle-left" uiTransform={{ width: '100%', height: S(34) }} />
        <Label value={props.caption} fontSize={S(18)} color={DIM} textAlign="middle-left" uiTransform={{ width: '100%', height: S(26) }} />
      </UiEntity>
    </UiEntity>
  )
}

/**
 * The kudos board: a fixed panel on the left, in the band under the explorer's top-left HUD,
 * laid out like the Antrom AFK dock (same panel texture, 420 design px wide, 18 px padding).
 */
function KudosPanel() {
  if (!kudosHud.synced || hud.mode !== 'hidden' || zoomUi.active) return null
  const k = kudosHud
  const { canvas, S } = hudLayout()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: canvas.top + S(190), left: canvas.left + S(18) }, flexDirection: 'column' }}>
      <UiEntity uiTransform={{ width: S(420), padding: S(18), flexDirection: 'column' }} uiBackground={PANEL_TEX}>
        {/* header: icon, title, the number */}
        <UiEntity uiTransform={{ width: '100%', height: S(64), flexDirection: 'row', alignItems: 'center', margin: { bottom: S(6) } }}>
          <UiEntity uiTransform={{ width: S(60), height: S(60), flexShrink: 0 }} uiBackground={icon('images/ui-icon-kudos.png')} />
          <Label value="KUDOS" fontSize={S(26)} color={GREEN} textAlign="middle-left" uiTransform={{ flexGrow: 1, flexShrink: 1, minWidth: 0, height: S(40), margin: { left: S(14) } }} />
          <Label value={`${k.kudos}`} fontSize={S(40)} color={Color4.White()} textAlign="middle-right" uiTransform={{ width: S(140), height: S(50) }} />
        </UiEntity>
        <PanelRow icon="images/ui-icon-cow.png" value={`${k.cargo} in the cargo bay`} caption={`${k.launched} of yours floating outside`} S={S} />
        <PanelRow icon="images/ui-icon-hole.png" value={`black hole in ${formatTime(k.nextHoleIn)}`} caption="swallows every floating cow, 10 kudos each" S={S} color={PURPLE_UI} />
        {k.carrying ? (
          <UiEntity uiTransform={{ width: '100%', height: S(44), margin: { top: S(12) }, justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: Color4.create(0.35, 0.05, 0.25, 0.9) }}>
            <Label value="Carrying a cow: click the COW LAUNCHER" fontSize={S(18)} color={PINK} textAlign="middle-center" uiTransform={{ width: '100%', height: S(30) }} />
          </UiEntity>
        ) : null}
        <Label value="KUDOS buy Alien Costumes from Nov 7" fontSize={S(18)} color={GREEN} textAlign="middle-left" uiTransform={{ width: '100%', height: S(28), margin: { top: S(12) } }} />
      </UiEntity>
    </UiEntity>
  )
}

/** Earth zoom overlay state, driven by earthZoom.ts: a white-out level and a hint line. */
export const zoomUi = { active: false, white: 0, hint: '' }

function ZoomOverlay() {
  if (!zoomUi.active && zoomUi.white <= 0) return null
  const { canvas } = hudLayout()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%' }}>
      {zoomUi.white > 0.002 ? <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: '100%', height: '100%' }} uiBackground={{ color: Color4.create(1, 1, 1, Math.min(1, zoomUi.white)) }} /> : null}
      {zoomUi.hint ? (
        <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: canvas.h - 70 }, width: canvas.w, justifyContent: 'center' }}>
          <Label value={zoomUi.hint} fontSize={16} color={Color4.create(1, 1, 1, 0.8)} textAlign="middle-center" />
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

function Hud() {
  if (hud.mode === 'hidden') return null
  if (hud.mode === 'results') return <Results />
  return <PlayingHud />
}

export function initUi() {
  engine.addSystem((dt) => {
    now += dt
  })
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
      <Hud />
      <KudosPanel />
      <Toast />
      <ZoomOverlay />
    </UiEntity>
  ))
}
