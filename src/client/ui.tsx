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

export function initUi() {
  engine.addSystem((dt) => {
    now += dt
  })
  ReactEcsRenderer.setUiRenderer(() => <Toast />)
}
