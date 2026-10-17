import { Storage } from '@dcl/sdk/server'
import { GAME, MAX_ACTIVATIONS, MAX_SCORE, RULESET } from '../shared/gameConfig'
import { room } from '../shared/messages'

/**
 * Cow game leaderboard: best round per wallet for the current ruleset, top ten, kept in
 * scene storage so it survives server restarts. The round is simulated on the client, so
 * this is a community board, not verified competition: the server only rejects rounds that
 * are impossible under the ruleset (too many activations, points that do not match cows).
 */
const STORAGE_KEY = 'cowLeaderboard'
const KEEP = 10

interface Entry {
  address: string
  name: string
  score: number
  cows: number
  ruleset: number
  at: number
}

let entries: Entry[] = []
let loaded = false

async function load() {
  try {
    const saved = await Storage.get<string>(STORAGE_KEY)
    if (saved) entries = (JSON.parse(saved) as Partial<Entry>[]).map((e) => ({ cows: 0, ruleset: 0, ...e }) as Entry)
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

function sortEntries() {
  entries.sort((a, b) => b.score - a.score || b.cows - a.cows || a.at - b.at)
}

function publicBoard() {
  return {
    entries: entries
      .filter((e) => e.ruleset === RULESET)
      .slice(0, KEEP)
      .map((e) => ({ name: e.name, score: e.score, cows: e.cows }))
  }
}

function cleanName(name: string) {
  const trimmed = name.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 20)
  return trimmed || 'Visitor'
}

function plausible(score: number, cows: number, attempts: number) {
  if (![score, cows, attempts].every((n) => Number.isInteger(n) && n >= 0)) return false
  if (attempts > MAX_ACTIVATIONS || cows > attempts) return false
  if (score > MAX_SCORE) return false
  // every catch is worth between catchPoints and catchPoints * comboCap
  const min = cows * GAME.catchPoints
  const max = cows * Math.floor(GAME.catchPoints * GAME.comboCap)
  return score >= min && score <= max
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
    const cows = Math.floor(Number(data.cows))
    const attempts = Math.floor(Number(data.attempts))
    if (data.ruleset !== RULESET || !plausible(score, cows, attempts)) {
      console.log(`[Cows] ignored round from ${address}: score ${String(data.score)} cows ${String(data.cows)} attempts ${String(data.attempts)} ruleset ${String(data.ruleset)}`)
      return
    }
    const name = cleanName(data.name)
    const existing = entries.find((e) => e.address === address && e.ruleset === RULESET)
    if (existing) {
      existing.name = name
      if (score < existing.score || (score === existing.score && cows <= existing.cows)) {
        room.send('leaderboard', publicBoard(), { to: [context.from] })
        return
      }
      existing.score = score
      existing.cows = cows
      existing.at = Date.now()
    } else {
      entries.push({ address, name, score, cows, ruleset: RULESET, at: Date.now() })
    }
    sortEntries()
    entries = entries.slice(0, 100)
    console.log(`[Cows] ${name} (${address}) scored ${score} with ${cows} cows in ${attempts} drops`)
    void save()
    room.send('leaderboard', publicBoard())
  })
}
