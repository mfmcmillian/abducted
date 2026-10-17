import { isServer as isServerApi } from '~system/EngineApi'
import './shared/messages'
import { initRingServer } from './server/ringServer'
import { createAliens } from './client/aliens'
import { createHerd } from './client/cows'
import { createDiorama, createDome, createHeroCow, createInterior, createVideoPlayer } from './client/dome'
import { initMusic } from './client/music'
import { createDecor, createGround, createKiosk, createNightSky, createPortals, createRimPylons } from './client/plaza'
import { createRingAltar } from './client/ring'
import { initUi } from './client/ui'

/**
 * Abducted! - They appear to be enjoying it. A 4x4 World.
 *
 * The same bundle runs on the authoritative server (ring claims only) and on every
 * client (everything you can see). Ask the runtime which one we are.
 */
export async function main() {
  const server = (await isServerApi({})).isServer
  console.log(`[Abducted] ${server ? 'server' : 'client'}`)
  if (server) {
    initRingServer()
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
  createInterior()
  createHeroCow()
  createAliens()

  createRimPylons()
  createHerd()
  createPortals()
  createKiosk()
  createRingAltar()
  createDecor()
}
