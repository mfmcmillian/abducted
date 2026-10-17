import { Storage } from '@dcl/sdk/server'
import { room } from '../shared/messages'

/**
 * Cow game leaderboard: best round per wallet, top ten, kept in scene storage so it
 * survives server restarts. Rounds are 3 minutes with a 1 s beam cooldown, so anything
 * above MAX_SCORE cannot be a real round.
 */
const STORAGE_KEY = 'cowLeaderboard'
const KEEP = 10
const MAX_SCORE = 150

interface Entry {
  address: string
  name: string
  score: number
  at: number
}

let entries: Entry[] = []
let loaded = false

async function load() {
  try {
    const saved = await Storage.get<string>(STORAGE_KEY)
    if (saved) entries = JSON.parse(saved) as Entry[]
  } catch (error) {
    console.log(`[Cows] leaderboard load failed: ${String(error)}`)
  }
  loaded = true
  console.log(`[Cows] leaderboard loaded, ${entries.length} entries`)
}

async function save() {
  try {
    await Storage.set(STORAGE_KEY, JSON.stringify(entries))
  } catch (error) {
    console.log(`[Cows] leaderboard save failed: ${String(error)}`)
  }
}

function publicBoard() {
  return { entries: entries.slice(0, KEEP).map((e) => ({ name: e.name, score: e.score })) }
}

function cleanName(name: string) {
  const trimmed = name.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 20)
  return trimmed || 'Visitor'
}

export function initLeaderboardServer() {
  void load()

  room.onMessage('leaderboardGet', (_data, context) => {
    if (!context) return
    room.send('leaderboard', publicBoard(), { to: [context.from] })
  })

  room.onMessage('scoreSubmit', (data, context) => {
    if (!context || !loaded) return
    const address = context.from.toLowerCase()
    const score = Math.floor(Number(data.score))
    if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) {
      console.log(`[Cows] ignored score ${String(data.score)} from ${address}`)
      return
    }
    const name = cleanName(data.name)
    const existing = entries.find((e) => e.address === address)
    if (existing) {
      existing.name = name
      if (score <= existing.score) {
        room.send('leaderboard', publicBoard(), { to: [context.from] })
        return
      }
      existing.score = score
      existing.at = Date.now()
    } else {
      entries.push({ address, name, score, at: Date.now() })
    }
    entries.sort((a, b) => b.score - a.score || a.at - b.at)
    entries = entries.slice(0, 50)
    console.log(`[Cows] ${name} (${address}) caught ${score}`)
    void save()
    room.send('leaderboard', publicBoard())
  })
}
