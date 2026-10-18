// Cuts the picture-window opening out of the house model so the Earth zoom can fly through
// an open window into the living room (models/earth-room.glb supplies the reveal and the
// open sashes behind it). The opening (model coords, before the scene's 180 degree yaw) was
// measured from an orthographic render: glass x -0.57..-0.36, y -0.31..-0.08, front wall at z ~ 0.23.
// Run after tools/earth-models.mjs: node tools/cut-window.mjs
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
execFileSync('node', [join(ROOT, 'tools', 'cut-hole.mjs'), join(ROOT, 'models', 'earth', 'house.glb'), '-0.57', '-0.36', '-0.31', '-0.08', '0.15'], { stdio: 'inherit' })
