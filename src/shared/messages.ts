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
  scoreSubmit: Schemas.Map({ score: Schemas.Int, name: Schemas.String }),
  /** client -> server: send me the board */
  leaderboardGet: Schemas.Map({ v: Schemas.Int }),
  /** server -> clients: top scores, best first */
  leaderboard: Schemas.Map({
    entries: Schemas.Array(Schemas.Map({ name: Schemas.String, score: Schemas.Int }))
  })
}

export const room = registerMessages(Messages)
