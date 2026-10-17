import { isServer as isServerApi } from '~system/EngineApi'
import './shared/messages'
import { initLeaderboardServer } from './server/leaderboardServer'
import { initRingServer } from './server/ringServer'
import { createAliens } from './client/aliens'
import { createHerd } from './client/cows'
import { createApexUfo, createDiorama, createDome, createHeroCow, createInterior, createVideoPlayer } from './client/dome'
import { createCowGame } from './client/game'
import { initMusic } from './client/music'
import { createDecor, createGround, createKiosk, createNightSky, createPortals, createRimPylons } from './client/plaza'
import { createRingAltar } from './client/ring'
import { initUi } from './client/ui'

/**
 * Abducted! - They appear to be enjoying it. An 8x8 World: a closed video dome with the
 * cow game pasture floating above it.
 *
 * The same bundle runs on the authoritative server (ring claims, leaderboard) and on every
 * client (everything you can see). Ask the runtime which one we are.
 */
export async function main() {
  const server = (await isServerApi({})).isServer
  console.log(`[Abducted] ${server ? 'server' : 'client'}`)
  if (server) {
    initRingServer()
    initLeaderboardServer()
    return
  }
  initClient()
}

function initClient() {
  initUi()
  createNightSky()
  createGround()

  const video = createVideoPlayer()
  initMusic(video)
  createDome(video)
  createDiorama()
  createApexUfo()
  createInterior()
  createHeroCow()
  createAliens()

  createRimPylons()
  createHerd()
  createPortals()
  createKiosk()
  createRingAltar(video)
  createDecor()
  createCowGame()
}
