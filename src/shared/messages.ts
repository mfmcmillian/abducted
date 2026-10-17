import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

/**
 * Client <-> server messages. The only server-side feature is the Antrom Guildstone
 * Ring claim, which must run on the authoritative server so the Rewards campaign
 * key never leaves it.
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
  })
}

export const room = registerMessages(Messages)
