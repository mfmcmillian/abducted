/**
 * The shared cosmos: one number for the whole World, the cows everyone has ever fed to the
 * black hole (`mass`). It only goes up, it survives restarts (scene storage), and it changes the
 * place for everybody: the hole grows, the light outside shifts, debris gathers, company arrives,
 * and Dale and Tammy's radio show gets new episodes.
 */
export const COSMOS_TIERS = [0, 10, 30, 75, 150, 300, 600, 1200, 2500, 5000, 10000]

export function tierFor(mass: number) {
  let tier = 0
  for (let i = 0; i < COSMOS_TIERS.length; i++) if (mass >= COSMOS_TIERS[i]) tier = i
  return tier
}

/** Cows still to feed before the next tier, or 0 at the top. */
export function toNextTier(mass: number) {
  const tier = tierFor(mass)
  return tier + 1 < COSMOS_TIERS.length ? COSMOS_TIERS[tier + 1] - mass : 0
}

/** The black hole's size multiplier: +16 % per tier, so tier 5 is about twice the hole. */
export const holeScale = (mass: number) => 1 + tierFor(mass) * 0.16

/** Debris rings around the ship: one more every other tier, up to three. */
export const debrisRings = (mass: number) => Math.min(3, Math.floor(tierFor(mass) / 2))

/** A second ship keeps station outside once the hole is big enough to draw a crowd. */
export const COMPANY_TIER = 4

/**
 * Light outside, cool blue at first and sliding toward violet, then magenta, then ember as the
 * hole feeds. Returns r, g, b in 0..1.
 */
export function skyTint(mass: number): [number, number, number] {
  const k = Math.min(1, tierFor(mass) / 8)
  const stops: [number, number, number][] = [
    [0.6, 0.8, 1], // blue
    [0.7, 0.55, 1], // violet
    [1, 0.45, 0.85], // magenta
    [1, 0.5, 0.35] // ember
  ]
  const f = k * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(f))
  const u = f - i
  const a = stops[i]
  const b = stops[i + 1]
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
}
