import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

/**
 * Client <-> server messages. The server handles the Antrom Guildstone Ring claim
 * (so the Rewards key never leaves it) and keeps the cow game leaderboard.
 */
export const Messages = {
  /** client -> server: "tell me whether this wallet already claimed its ring" */
  ringHello: Schemas.Map({ v: Schemas.Int }),
  /** client -> server: claim the ring */
  ringClaim: Schemas.Map({ v: Schemas.Int }),
  /** server -> one client: current state and an optional line for the toast */
  ringStatus: Schemas.Map({
    claimed: Schemas.Boolean,
    ok: Schemas.Boolean,
    text: Schemas.String
  }),

  /** client -> server: a finished cow round */
  scoreSubmit: Schemas.Map({ score: Schemas.Int, cows: Schemas.Int, attempts: Schemas.Int, ruleset: Schemas.Int, name: Schemas.String }),
  /** client -> server: send me the board */
  leaderboardGet: Schemas.Map({ v: Schemas.Int }),
  /** server -> clients: top scores, best first */
  leaderboard: Schemas.Map({
    entries: Schemas.Array(Schemas.Map({ name: Schemas.String, score: Schemas.Int, cows: Schemas.Int }))
  }),

  // ---- kudos loop: cargo bay -> launcher -> black hole -> kudos ----
  /** client -> server: send me my cargo / kudos state (and the cows floating outside) */
  cargoGet: Schemas.Map({ v: Schemas.Int }),
  /** client -> server: I dropped a cow in the launcher */
  cowLaunch: Schemas.Map({ v: Schemas.Int }),
  /** server -> one client: wallet state; text is an optional toast line */
  cargoState: Schemas.Map({
    cargo: Schemas.Int,
    kudos: Schemas.Int,
    launched: Schemas.Int,
    nextHoleIn: Schemas.Int,
    text: Schemas.String
  }),
  /** server -> all clients: a cow left the launcher, fly it to (rho, phi, y) in the star ring */
  cowLaunched: Schemas.Map({ id: Schemas.Int, owner: Schemas.String, rho: Schemas.Float, phi: Schemas.Float, y: Schemas.Float }),
  /** server -> one client: everything currently floating (on join) */
  cowsFloating: Schemas.Map({
    cows: Schemas.Array(Schemas.Map({ id: Schemas.Int, owner: Schemas.String, rho: Schemas.Float, phi: Schemas.Float, y: Schemas.Float }))
  }),
  /** server -> all clients: the black hole is passing; it swallows these cows */
  blackHole: Schemas.Map({ phi: Schemas.Float, seconds: Schemas.Int, ids: Schemas.Array(Schemas.Int) })
}

export const room = registerMessages(Messages)
