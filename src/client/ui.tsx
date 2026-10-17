import { engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import ReactEcs, { Label, ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'

/** One-line toast at the bottom centre of the screen. */
let toastText = ''
let toastUntil = 0
let now = 0

export function toast(text: string, seconds = 7) {
  toastText = text
  toastUntil = now + seconds
}

/** Cow game HUD state, written by client/game.ts. */
export const hud = {
  visible: false,
  score: 0,
  secondsLeft: 0,
  /** big centre banner (round over), empty when hidden */
  banner: '',
  bannerSub: ''
}

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
      <UiEntity
        uiTransform={{
          padding: { top: 10, bottom: 10, left: 22, right: 22 },
          maxWidth: 720
        }}
        uiBackground={{ color: Color4.create(0.02, 0.05, 0.03, 0.85) }}
      >
        <Label value={toastText} fontSize={18} color={Color4.create(0.6, 1, 0.75, 1)} textAlign="middle-center" />
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

function Hud() {
  if (!hud.visible) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0 },
        justifyContent: 'flex-start',
        alignItems: 'center',
        flexDirection: 'column',
        padding: { top: 24 }
      }}
    >
      <UiEntity
        uiTransform={{ padding: { top: 8, bottom: 8, left: 26, right: 26 }, flexDirection: 'row', alignItems: 'center' }}
        uiBackground={{ color: Color4.create(0.02, 0.04, 0.06, 0.8) }}
      >
        <Label value={`COWS  ${hud.score}`} fontSize={26} color={Color4.create(0.6, 1, 0.75, 1)} />
        <UiEntity uiTransform={{ width: 36 }} />
        <Label value={formatTime(hud.secondsLeft)} fontSize={26} color={hud.secondsLeft < 15 ? Color4.create(1, 0.45, 0.4, 1) : Color4.White()} />
      </UiEntity>
      <UiEntity uiTransform={{ height: 6 }} />
      <Label value="click or E: drop the beam" fontSize={14} color={Color4.create(0.7, 0.8, 0.9, 0.9)} />
      {hud.banner ? (
        <UiEntity
          uiTransform={{
            positionType: 'absolute',
            position: { top: '38%' },
            padding: { top: 18, bottom: 18, left: 40, right: 40 },
            flexDirection: 'column',
            alignItems: 'center'
          }}
          uiBackground={{ color: Color4.create(0.02, 0.05, 0.03, 0.9) }}
        >
          <Label value={hud.banner} fontSize={34} color={Color4.create(0.6, 1, 0.75, 1)} textAlign="middle-center" />
          <UiEntity uiTransform={{ height: 8 }} />
          <Label value={hud.bannerSub} fontSize={18} color={Color4.White()} textAlign="middle-center" />
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

export function initUi() {
  engine.addSystem((dt) => {
    now += dt
  })
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
      <Hud />
      <Toast />
    </UiEntity>
  ))
}
