import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'
import { KUDOS } from '../shared/gameConfig'
import { room } from '../shared/messages'

/**
 * The kudos loop, server side.
 *
 *   pasture round (validated by the leaderboard server) -> cows land in the wallet's CARGO
 *   cowLaunch                                           -> one cargo cow becomes a FLOATING cow in the star ring
 *   black hole every holePeriodSeconds                   -> every floating cow is swallowed, owner gets perCow KUDOS
 *
 * Per-wallet numbers live in player storage, the floating list in scene storage, so both
 * survive a server restart. Kudos can only be minted by the black hole, cows can only enter
 * the cargo bay from a plausible round, and a launch is refused when the cargo bay is empty.
 */
const PLAYER_KEY = 'kudos'
const FLOATING_KEY = 'floatingCows'
const TAU = Math.PI * 2
const RING_INNER = 43 // layout.ts SPACE_RADIUS; keep in sync
const LAUNCHER_AZ = Math.atan2(14, -22) // layout.ts LAUNCHER relative to CENTER; cows fly roughly that way

interface Wallet {
  kudos: number
  cargo: number
  launched: number
  lifetime: number
  /** when the free cows were last beamed in (ms epoch) */
  freeAt?: number
}

interface Floating {
  id: number
  owner: string
  rho: number
  phi: number
  y: number
}

const wallets = new Map<string, Wallet>()
let floating: Floating[] = []
let nextId = 1
let holeIn = KUDOS.holePeriodSeconds
let loaded = false

async function loadFloating() {
  try {
    const saved = await Storage.get<string>(FLOATING_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as { floating: Floating[]; nextId: number }
      floating = parsed.floating ?? []
      nextId = parsed.nextId ?? floating.length + 1
    }
  } catch (error) {
    console.log(`[Kudos] floating load failed: ${String(error)}`)
  }
  loaded = true
  console.log(`[Kudos] loaded, ${floating.length} cows floating`)
}

async function saveFloating() {
  try {
    await Storage.set(FLOATING_KEY, JSON.stringify({ floating, nextId }))
  } catch (error) {
    console.log(`[Kudos] floating save failed: ${String(error)}`)
  }
}

async function wallet(address: string): Promise<Wallet> {
  const cached = wallets.get(address)
  if (cached) return cached
  let w: Wallet = { kudos: 0, cargo: 0, launched: 0, lifetime: 0 }
  try {
    const saved = await Storage.player.get<string>(address, PLAYER_KEY)
    if (saved) w = { ...w, ...(JSON.parse(saved) as Partial<Wallet>) }
  } catch (error) {
    console.log(`[Kudos] wallet load failed for ${address}: ${String(error)}`)
  }
  wallets.set(address, w)
  return w
}

async function saveWallet(address: string, w: Wallet) {
  try {
    await Storage.player.set(address, PLAYER_KEY, JSON.stringify(w))
  } catch (error) {
    console.log(`[Kudos] wallet save failed for ${address}: ${String(error)}`)
  }
}

/**
 * A newcomer, or anyone who has run dry, finds a couple of free cows waiting in the pen so the
 * launcher can be tried right away. Rate-limited per player so it is not a kudos faucet.
 */
async function topUpFreeCows(address: string, w: Wallet): Promise<boolean> {
  if (w.cargo > 0) return false
  const now = Date.now()
  if (w.freeAt && now - w.freeAt < KUDOS.freeCowsEverySeconds * 1000) return false
  w.cargo += KUDOS.freeCows
  w.freeAt = now
  await saveWallet(address, w)
  return true
}

function sendState(address: string, w: Wallet, text = '') {
  room.send('cargoState', { cargo: w.cargo, kudos: w.kudos, launched: w.launched, nextHoleIn: Math.ceil(holeIn), text }, { to: [address] })
}

/** Called by the leaderboard server for every plausible round. */
export async function addCargo(address: string, cows: number) {
  if (cows <= 0) return
  const w = await wallet(address)
  w.cargo += cows
  w.lifetime += cows
  await saveWallet(address, w)
  sendState(address, w, `${cows} cow${cows === 1 ? '' : 's'} beamed into the cargo bay. Carry them to the launcher.`)
}

async function launch(address: string) {
  const w = await wallet(address)
  if (w.cargo <= 0) return sendState(address, w, 'The cargo bay is empty. Play the cow game to catch more cows.')
  w.cargo -= 1
  w.launched += 1
  const cow: Floating = {
    id: nextId++,
    owner: address,
    rho: RING_INNER + 6 + Math.random() * 10,
    phi: LAUNCHER_AZ + (Math.random() - 0.5) * 1.6,
    y: 4 + Math.random() * 11
  }
  floating.push(cow)
  // Too many out there: the oldest get swallowed by "a passing anomaly" right away.
  const overflow = floating.length - KUDOS.maxFloating
  if (overflow > 0) {
    const early = floating.splice(0, overflow)
    room.send('blackHole', { phi: early[0].phi, seconds: 8, ids: early.map((c) => c.id) })
    await credit(early, 'A passing anomaly took your oldest cows.')
  }
  await saveWallet(address, w)
  void saveFloating()
  room.send('cowLaunched', cow)
  const gifted = await topUpFreeCows(address, w)
  sendState(address, w, gifted ? `Last one! ${KUDOS.freeCows} more free cows beamed into the CARGO BAY.` : '')
}

async function credit(cows: Floating[], reason: string) {
  const perOwner = new Map<string, number>()
  for (const c of cows) perOwner.set(c.owner, (perOwner.get(c.owner) ?? 0) + 1)
  for (const [owner, count] of perOwner) {
    const w = await wallet(owner)
    const gained = count * KUDOS.perCow
    w.kudos += gained
    w.launched = Math.max(0, w.launched - count)
    await saveWallet(owner, w)
    console.log(`[Kudos] ${owner} +${gained} (${count} cows)`)
    sendState(owner, w, `${reason} ${count} cow${count === 1 ? '' : 's'} -> +${gained} KUDOS`)
  }
}

async function blackHole() {
  const swallowed = floating
  floating = []
  const phi = Math.random() * TAU
  room.send('blackHole', { phi, seconds: KUDOS.holePassSeconds, ids: swallowed.map((c) => c.id) })
  console.log(`[Kudos] black hole: ${swallowed.length} cows`)
  void saveFloating()
  if (swallowed.length) await credit(swallowed, 'The black hole swallowed')
}

/** A raider saucer picks off one floating cow. The owner is paid as if the hole had taken it. */
async function raid() {
  if (!floating.length) return
  const i = Math.floor(Math.random() * floating.length)
  const [cow] = floating.splice(i, 1)
  room.send('cowShot', { id: cow.id, owner: cow.owner })
  console.log(`[Kudos] raid: cow ${cow.id} of ${cow.owner}`)
  void saveFloating()
  await credit([cow], 'A raider saucer vaporised your cow. Hazard pay:')
}

let raidIn = KUDOS.raidPeriodSeconds

export function initKudosServer() {
  void loadFloating()

  room.onMessage('cargoGet', (_data, context) => {
    if (!context || !loaded) return
    const address = context.from.toLowerCase()
    room.send('cowsFloating', { cows: floating }, { to: [context.from] })
    void wallet(address).then(async (w) => {
      const gifted = await topUpFreeCows(address, w)
      sendState(address, w, gifted ? `${KUDOS.freeCows} free cows are waiting in the CARGO BAY. Carry one to the launcher.` : '')
    })
  })

  room.onMessage('cowLaunch', (_data, context) => {
    if (!context || !loaded) return
    void launch(context.from.toLowerCase())
  })

  engine.addSystem((dt) => {
    raidIn -= dt
    if (raidIn <= 0) {
      raidIn = KUDOS.raidPeriodSeconds * (0.7 + Math.random() * 0.6)
      // not in the last stretch before the hole: the client needs ~8 s to play the attack
      if (holeIn > 12) void raid()
    }
    holeIn -= dt
    if (holeIn > 0) return
    holeIn = KUDOS.holePeriodSeconds
    void blackHole()
  })
}
