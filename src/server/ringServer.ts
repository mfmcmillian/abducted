import { engine, PlayerIdentityData } from '@dcl/sdk/ecs'
import { EnvVar, Storage } from '@dcl/sdk/server'
import { room } from '../shared/messages'

/**
 * Antrom Guildstone Ring claim, one per wallet.
 *
 * Runs only on the authoritative server. The Rewards dispenser key is the same one
 * the Dungeons of Antrom chest drop uses; it lives in this World's env store:
 *   npx sdk-commands storage env set REWARDS_KEY_GIFT --value <key>
 * Optional, only if the key is a campaign master key instead of a dispenser key:
 *   REWARDS_GIFT_TARGET (collection contract) and REWARDS_GIFT_VALUE (item id).
 */
const REWARDS_URL = 'https://rewards.decentraland.org/api/rewards'
const STORAGE_KEY = 'guildstoneRing'

const busy = new Set<string>()

async function env(name: string): Promise<string> {
  try {
    return ((await EnvVar.get(name)) || '').replace(/^['"]+|['"]+$/g, '')
  } catch {
    return ''
  }
}

function isGuest(address: string): boolean {
  for (const [, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (identity.address.toLowerCase() === address) return identity.isGuest
  }
  return true
}

async function hasClaimed(address: string): Promise<boolean> {
  try {
    const saved = await Storage.player.get<string>(address, STORAGE_KEY)
    return !!saved
  } catch (error) {
    console.log(`[Ring] storage read failed for ${address}: ${String(error)}`)
    return false
  }
}

function reply(address: string, claimed: boolean, ok: boolean, text: string) {
  room.send('ringStatus', { claimed, ok, text }, { to: [address] })
}

async function requestReward(address: string, key: string): Promise<{ ok: boolean; error?: string }> {
  const request: Record<string, string> = { campaign_key: key, beneficiary: address }
  const target = await env('REWARDS_GIFT_TARGET')
  if (target) {
    request.assign_target = target
    request.assign_value = (await env('REWARDS_GIFT_VALUE')) || '0'
  }
  try {
    const response = await fetch(REWARDS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    })
    let body: { ok?: boolean; error?: string } = {}
    try {
      body = (await response.json()) as { ok?: boolean; error?: string }
    } catch {
      body = {}
    }
    if (response.ok && body.ok !== false) return { ok: true }
    return { ok: false, error: String(body.error ?? response.status) }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

async function claim(address: string) {
  if (busy.has(address)) return
  busy.add(address)
  try {
    if (isGuest(address)) return reply(address, false, false, 'Sign in with a wallet to claim the Antrom Guildstone Ring.')
    if (await hasClaimed(address)) return reply(address, true, false, 'You already claimed your Antrom Guildstone Ring.')
    const key = await env('REWARDS_KEY_GIFT')
    if (!key) {
      console.log('[Ring] REWARDS_KEY_GIFT is unset')
      return reply(address, false, false, 'The ring vault is sealed right now. Try again later.')
    }
    const result = await requestReward(address, key)
    if (!result.ok) {
      console.log(`[Ring] refused for ${address}: ${result.error}`)
      return reply(address, false, false, 'The aliens could not hand over a ring right now. Try again later.')
    }
    try {
      await Storage.player.set(address, STORAGE_KEY, JSON.stringify({ at: Date.now() }))
    } catch (error) {
      console.log(`[Ring] storage write failed for ${address}: ${String(error)}`)
    }
    console.log(`[Ring] granted to ${address}`)
    reply(address, true, true, 'An Antrom Guildstone Ring is on its way to your wallet. They appear to be enjoying it.')
  } finally {
    busy.delete(address)
  }
}

export function initRingServer() {
  room.onMessage('ringHello', (_data, context) => {
    if (!context) return
    const address = context.from.toLowerCase()
    void hasClaimed(address).then((claimed) => {
      console.log(`[Ring] hello from ${address}, claimed=${claimed}`)
      reply(address, claimed, true, '')
    })
  })
  room.onMessage('ringClaim', (_data, context) => {
    if (!context) return
    void claim(context.from.toLowerCase())
  })
  void env('REWARDS_KEY_GIFT').then((key) => console.log(`[Ring] REWARDS_KEY_GIFT ${key ? 'set' : 'UNSET'}`))
}
