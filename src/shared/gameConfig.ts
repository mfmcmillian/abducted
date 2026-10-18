/**
 * Cow game tuning, per TheCowCatchingGame PRD v1.0 (initial tuning configuration).
 * Any meaningful change to movement, duration, scoring or cow behaviour is a new
 * RULESET: bump it so old leaderboard rounds are not compared with new ones.
 */
export const RULESET = 1

export const GAME = {
  roundSeconds: 180,
  countdownSeconds: 3,
  /** playable field, world units, centred on the pasture */
  fieldSize: 44,
  cowCount: 12,

  // tractor beam: Ready -> Charging -> Active -> Cooldown -> Ready
  beamRadius: 2.0,
  chargeSeconds: 0.35,
  activeSeconds: 0.85,
  cooldownSeconds: 1.0,
  /** continuous exposure inside the footprint needed to lock a cow */
  exposureSeconds: 0.65,
  /** how far from the saucer the beam can be dropped */
  maxRange: 26,

  // scoring
  catchPoints: 100,
  comboStep: 0.25,
  comboCap: 2.0,

  // cows
  grazeMin: 1.5,
  grazeMax: 4,
  wanderSpeedMin: 1.2,
  wanderSpeedMax: 2.0,
  wanderReach: 7,
  startleRadius: 3,
  startleDelay: 0.6,
  fleeSpeed: 2.8,
  fleeSeconds: 1.0,
  liftSeconds: 0.6,
  respawnSeconds: 2,
  respawnMinFromUfo: 4,
  stuckSeconds: 5
}

/** Ceiling the server accepts: one activation every 2.2 s, every one a max-combo catch. */
export const MAX_ACTIVATIONS = Math.floor(GAME.roundSeconds / (GAME.chargeSeconds + GAME.activeSeconds + GAME.cooldownSeconds))
export const MAX_SCORE = MAX_ACTIVATIONS * Math.floor(GAME.catchPoints * GAME.comboCap)

/** The kudos loop: cows caught in the pasture wait in the cargo bay, get launched into the star
 * ring and are swallowed by the black hole that passes every holePeriodSeconds. */
export const KUDOS = {
  perCow: 10,
  holePeriodSeconds: 120,
  holePassSeconds: 26,
  /** floating cows the ring will hold; beyond this the oldest are swallowed early */
  maxFloating: 60,
  /** cows shown in the cargo bay pen at once (the rest are 'more in the hold') */
  penCapacity: 20
}
