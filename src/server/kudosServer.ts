import { engine } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'
import { KUDOS } from '../shared/gameConfig'
import { room } from '../shared/messages'

/**
 * The kudos loop, server side.
 *
 *   pasture round (validated by the leaderboard server) -> cows join the SHARED HERD in the cargo bay
 *   cowPickup                                           -> one herd cow is carried by that player (everyone sees it)
 *   cowLaunch                                           -> the carried cow becomes a FLOATING cow owned by the launcher
 *   black hole every holePeriodSeconds                   -> every floating cow is swallowed, owner gets perCow KUDOS
 *
 * Per-wallet numbers live in player storage, the herd and the floating list in scene storage,
 * so all survive a server restart. Kudos can only be minted by the black hole, cows can only
 * enter the herd from a plausible round, and a launch is refused unless you are carrying one.
 */
const PLAYER_KEY = 'kudos'
const FLOATING_KEY = 'floatingCows'
const COSMOS_KEY = 'cosmos'
const HERD_KEY = 'herd'
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

/** The shared herd: cows waiting in the cargo bay (pen + hold), and who is carrying one. */
let herd = 0
let herdFreeAt = 0
const carriers = new Map<string, number>() // address -> ms epoch when picked up

async function loadHerd() {
  try {
    const saved = await Storage.get<string>(HERD_KEY)
    if (saved) herd = (JSON.parse(saved) as { herd?: number }).herd ?? 0
  } catch (error) {
    console.log(`[Kudos] herd load failed: ${String(error)}`)
  }
  console.log(`[Kudos] herd ${herd}`)
}

async function saveHerd() {
  try {
    await Storage.set(HERD_KEY, JSON.stringify({ herd }))
  } catch (error) {
    console.log(`[Kudos] herd save failed: ${String(error)}`)
  }
}

function sendPen(to?: string) {
  const data = { cows: herd, carriers: [...carriers.keys()] }
  if (to) room.send('penState', data, { to: [to] })
  else room.send('penState', data)
}

/** An empty bay (nobody carrying either) gets a couple of free cows, at most once per freeCowsEverySeconds. */
async function topUpFreeCows(): Promise<boolean> {
  if (herd > 0 || carriers.size > 0) return false
  const now = Date.now()
  if (now - herdFreeAt < KUDOS.freeCowsEverySeconds * 1000) return false
  herd += KUDOS.freeCows
  herdFreeAt = now
  await saveHerd()
  sendPen()
  return true
}

async function pickUp(address: string) {
  const w = await wallet(address)
  if (carriers.has(address)) return sendPen(address)
  if (herd <= 0) return sendState(address, w, 'The cargo bay is empty. Play the cow game to catch more cows.')
  herd -= 1
  carriers.set(address, Date.now())
  void saveHerd()
  sendPen()
}

/** Carried too long: the cow wanders back to the pen. */
function expireCarriers() {
  const now = Date.now()
  let changed = false
  for (const [address, at] of carriers) {
    if (now - at < KUDOS.carrySeconds * 1000) continue
    carriers.delete(address)
    herd += 1
    changed = true
    void wallet(address).then((w) => sendState(address, w, 'Your cow wandered back to the pen.'))
  }
  if (changed) {
    void saveHerd()
    sendPen()
  }
}

/** The shared cosmos (src/shared/cosmos.ts): every cow anyone has ever fed to the hole. */
let mass = 0

async function loadCosmos() {
  try {
    const saved = await Storage.get<string>(COSMOS_KEY)
    if (saved) mass = (JSON.parse(saved) as { mass?: number }).mass ?? 0
  } catch (error) {
    console.log(`[Kudos] cosmos load failed: ${String(error)}`)
  }
  console.log(`[Kudos] cosmos mass ${mass}`)
}

async function feedCosmos(cows: number) {
  if (cows <= 0) return
  mass += cows
  room.send('cosmos', { mass })
  try {
    await Storage.set(COSMOS_KEY, JSON.stringify({ mass }))
  } catch (error) {
    console.log(`[Kudos] cosmos save failed: ${String(error)}`)
  }
}

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
  // cows saved under the old per-player cargo join the shared herd once
  if (w.cargo > 0) {
    herd += w.cargo
    w.cargo = 0
    await saveWallet(address, w)
    void saveHerd()
    sendPen()
  }
  return w
}

async function saveWallet(address: string, w: Wallet) {
  try {
    await Storage.player.set(address, PLAYER_KEY, JSON.stringify(w))
  } catch (error) {
    console.log(`[Kudos] wallet save failed for ${address}: ${String(error)}`)
  }
}

function sendState(address: string, w: Wallet, text = '') {
  room.send('cargoState', { cargo: herd, kudos: w.kudos, launched: w.launched, nextHoleIn: Math.ceil(holeIn), text }, { to: [address] })
}

/** Called by the leaderboard server for every plausible round. */
export async function addCargo(address: string, cows: number) {
  if (cows <= 0) return
  const w = await wallet(address)
  w.lifetime += cows
  herd += cows
  await saveWallet(address, w)
  void saveHerd()
  sendPen()
  sendState(address, w, `${cows} cow${cows === 1 ? '' : 's'} beamed into the cargo bay. Carry them to the launcher.`)
}

async function launch(address: string) {
  const w = await wallet(address)
  if (!carriers.has(address)) return sendState(address, w, 'You are not carrying a cow. Pick one up in the CARGO BAY first.')
  carriers.delete(address)
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
  sendPen()
  const gifted = await topUpFreeCows()
  sendState(address, w, gifted ? `Last one! ${KUDOS.freeCows} more free cows beamed into the CARGO BAY.` : '')
}

async function credit(cows: Floating[], reason: string) {
  void feedCosmos(cows.length)
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
  void loadCosmos()
  void loadHerd()

  room.onMessage('cargoGet', (_data, context) => {
    if (!context || !loaded) return
    const address = context.from.toLowerCase()
    room.send('cowsFloating', { cows: floating }, { to: [context.from] })
    room.send('cosmos', { mass }, { to: [context.from] })
    sendPen(context.from)
    void wallet(address).then(async (w) => {
      const gifted = await topUpFreeCows()
      sendState(address, w, gifted ? `${KUDOS.freeCows} free cows are waiting in the CARGO BAY. Carry one to the launcher.` : '')
    })
  })

  room.onMessage('cowPickup', (_data, context) => {
    if (!context || !loaded) return
    void pickUp(context.from.toLowerCase())
  })

  room.onMessage('cowLoading', (data, context) => {
    if (!context) return
    room.send('cowLoading', { from: context.from.toLowerCase(), x: data.x, y: data.y, z: data.z })
  })

  room.onMessage('cowLaunch', (_data, context) => {
    if (!context || !loaded) return
    void launch(context.from.toLowerCase())
  })

  engine.addSystem((dt) => {
    expireCarriers()
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
