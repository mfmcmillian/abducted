import { ColliderLayer, engine, Entity, GltfContainer, Transform } from '@dcl/sdk/ecs'
import { Color3, Quaternion, Vector3 } from '@dcl/sdk/math'
import { CENTER, SPACE_RADIUS } from '../layout'
import { COMPANY_TIER, COSMOS_TIERS, debrisRings, holeScale, skyTint, tierFor } from '../shared/cosmos'
import { room } from '../shared/messages'
import { setHoleSize } from './cargo'
import { puffTrail, warpIn } from './fx'
import { t } from './i18n'
import { ROOT } from './root'
import { playGlobal, SFX } from './sfx'
import { setSpaceTint } from './space'
import { kudosHud, toast } from './ui'

/**
 * The shared cosmos, client side. The server tells everyone how many cows the World has fed to
 * the hole (src/shared/cosmos.ts); this turns that one number into the things you can see:
 * a bigger hole, a different light outside, rings of debris, and at COMPANY_TIER a second ship
 * that warps in and keeps station. Tier changes while you are aboard come with a toast.
 */
const TAU = Math.PI * 2
const R = SPACE_RADIUS
const polar = (rho: number, phi: number, y: number) => Vector3.create(CENTER.x + rho * Math.sin(phi), y, CENTER.z + rho * Math.cos(phi))
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const NO_COLLIDE = { visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE }

let mass = -1 // unknown until the server says
let tier = 0
const listeners: ((tier: number, first: boolean) => void)[] = []

export const cosmosMass = () => Math.max(0, mass)
export const cosmosTier = () => tier

/** Called with the current tier right away once known, then on every change. */
export function onCosmosTier(f: (tier: number, first: boolean) => void) {
  listeners.push(f)
  if (mass >= 0) f(tier, true)
}

// ---- debris ----------------------------------------------------------------------------

interface Rock {
  entity: Entity
  rho: number
  phi: number
  y: number
  speed: number
  spin: Vector3
  size: number
  born: number
}
const rocks: Rock[] = []
let ringsBuilt = 0
const ROCKS_PER_RING = 16
const ROCK_MODELS = ['models/space/asteroid-potato.glb', 'models/space/asteroid-icy.glb']

function buildRing(index: number, announce: boolean) {
  const rho = R + 13 + index * 2.6
  const y = 5 + index * 2.2
  for (let i = 0; i < ROCKS_PER_RING; i++) {
    const entity = engine.addEntity()
    const size = rand(0.35, 0.8)
    const phi = (i / ROCKS_PER_RING) * TAU + rand(-0.12, 0.12)
    Transform.create(entity, { parent: ROOT, position: polar(rho, phi, y), scale: Vector3.Zero() })
    GltfContainer.create(entity, { src: ROCK_MODELS[(i + index) % ROCK_MODELS.length], ...NO_COLLIDE })
    rocks.push({ entity, rho: rho + rand(-0.8, 0.8), phi, y: y + rand(-0.6, 0.6), speed: rand(1.2, 1.8), spin: Vector3.create(rand(10, 40), rand(10, 40), rand(5, 20)), size, born: announce ? clock + i * 0.12 : clock - 10 })
  }
}

// ---- company -----------------------------------------------------------------------------

let company: Entity | null = null
let companyPhi = 0
const COMPANY_RHO = R + 17
const COMPANY_Y = 19
const COMPANY_SCALE = 5
const WARP = Color3.create(0.55, 1, 0.75)

function companyArrives(delay: number) {
  if (company) return
  company = engine.addEntity()
  Transform.create(company, { parent: ROOT, position: Vector3.create(CENTER.x, -40, CENTER.z), scale: Vector3.Zero() })
  GltfContainer.create(company, { src: 'models/ufo.glb', ...NO_COLLIDE })
  companyPhi = rand(0, TAU)
  const to = polar(COMPANY_RHO, companyPhi, COMPANY_Y)
  const heading = Vector3.create(Math.cos(companyPhi), 0, -Math.sin(companyPhi))
  warpIn(company, to, heading, Quaternion.Identity(), COMPANY_SCALE, WARP, delay)
}

// ---- apply ------------------------------------------------------------------------------

function apply(first: boolean) {
  setHoleSize(holeScale(mass))
  const [r, g, b] = skyTint(mass)
  setSpaceTint(Color3.create(r, g, b))
  const rings = debrisRings(mass)
  while (ringsBuilt < rings) buildRing(ringsBuilt++, !first)
  if (tier >= COMPANY_TIER) companyArrives(first ? 2.5 : 0.4)
}

let clock = 0

function cosmosSystem(dt: number) {
  clock += dt
  for (const rock of rocks) {
    rock.phi += (rock.speed * dt) / rock.rho
    const age = clock - rock.born
    if (age < 0) continue
    const k = Math.min(1, age / 0.6)
    if (age < dt + 0.001) puffTrail(polar(rock.rho, rock.phi, rock.y), Color3.create(0.8, 0.7, 1), 0.6)
    const tr = Transform.getMutable(rock.entity)
    tr.position = polar(rock.rho, rock.phi, rock.y + Math.sin(clock * 0.4 + rock.phi) * 0.3)
    tr.rotation = Quaternion.fromEulerDegrees(clock * rock.spin.x, clock * rock.spin.y, clock * rock.spin.z)
    tr.scale = Vector3.create(rock.size * k, rock.size * k, rock.size * k)
  }
  if (company) {
    const tr = Transform.getMutable(company)
    if (tr.scale.x > COMPANY_SCALE * 0.99) {
      // on station: a slow lap, a slow spin, a little bob
      companyPhi += (0.9 * dt) / COMPANY_RHO
      tr.position = polar(COMPANY_RHO, companyPhi, COMPANY_Y + Math.sin(clock * 0.6) * 0.5)
      tr.rotation = Quaternion.fromEulerDegrees(Math.sin(clock * 0.5) * 3, clock * 25, 0)
    }
  }
}

export function createCosmos() {
  engine.addSystem(cosmosSystem)
  room.onMessage('cosmos', (data) => {
    const first = mass < 0
    const before = tier
    mass = data.mass
    tier = tierFor(mass)
    kudosHud.mass = mass
    kudosHud.toNext = tier + 1 < COSMOS_TIERS.length ? COSMOS_TIERS[tier + 1] - mass : 0
    apply(first)
    if (!first && tier > before) {
      playGlobal(SFX.ringChime, 0.7)
      toast(tier === COMPANY_TIER ? t('A second ship has warped in alongside. Word is getting around.') : t('The black hole has fed on {0} cows. It is bigger now.', mass), 8)
    }
    for (const f of listeners) f(tier, first)
  })
}
