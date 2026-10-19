import { isServer as isServerApi } from '~system/EngineApi'
import './shared/messages'
import { initLeaderboardServer } from './server/leaderboardServer'
import { initRingServer } from './server/ringServer'
import { initKudosServer } from './server/kudosServer'
import { createAliens } from './client/aliens'
import { createApexUfo, createDome, createHeroCow, createInterior, createVideoPlayer } from './client/dome'
import { initTour } from './client/tour'
import { createArrivalBeam } from './client/arrival'
import { createSpaceWindows } from './client/space'
import { createCowGame } from './client/game'
import { createCargoLoop } from './client/cargo'
import { createSpaceBattles } from './client/battles'
import { createEarthZoom } from './client/earthZoom'
import { initMusic } from './client/music'
import { createBarrier, createGround, createKiosk, createNightSky, createPortals } from './client/plaza'
import { createRingAltar } from './client/ring'
import { initUi } from './client/ui'
import { initLanguage } from './client/i18n'
import { createCosmos } from './client/cosmos'
import { createRadio } from './client/radio'

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
    initKudosServer()
    return
  }
  initClient()
}

function initClient() {
  initLanguage()
  initUi()
  createNightSky()
  createGround()

  const video = createVideoPlayer()
  initMusic(video)
  createDome(video)
  createSpaceWindows()
  createArrivalBeam()
  createApexUfo()
  createInterior()
  createHeroCow()
  initTour()
  createAliens()

  createPortals()
  createKiosk()
  createRingAltar(video)
  createBarrier()
  createCowGame()
  createCargoLoop()
  createCosmos()
  createRadio()
  createSpaceBattles()
  createEarthZoom(video)
}
