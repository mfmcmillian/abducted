// Writes images/tv-static-{0..N-1}.png: 16:9 frames of analogue TV snow (grayscale PNG, scanlines
// baked in). The living-room TV cycles through them until the dome video takes over.
//   node tools/tv-static.mjs
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const FRAMES = 6
const W = 256, H = 144

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(gray) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  const raw = Buffer.alloc((W + 1) * H)
  for (let y = 0; y < H; y++) {
    raw[y * (W + 1)] = 0 // filter: none
    gray.copy(raw, y * (W + 1) + 1, y * W, (y + 1) * W)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// small deterministic PRNG so the frames are reproducible
let seed = 0x9e3779b9
const rand = () => {
  seed ^= seed << 13; seed >>>= 0
  seed ^= seed >>> 17
  seed ^= seed << 5; seed >>>= 0
  return seed / 0x100000000
}

for (let f = 0; f < FRAMES; f++) {
  const g = Buffer.alloc(W * H)
  // a slow rolling band of brightness, different per frame, over per-pixel snow
  const bandY = (f / FRAMES) * H
  for (let y = 0; y < H; y++) {
    const band = 0.85 + 0.15 * Math.cos(((y - bandY) / H) * Math.PI * 2)
    const scan = y % 2 ? 0.72 : 1
    for (let x = 0; x < W; x++) {
      // snow has horizontal streaks: blend with the previous pixel
      const n = rand()
      const prev = x ? g[y * W + x - 1] / 255 : n
      const v = (0.65 * n + 0.35 * prev) * band * scan
      g[y * W + x] = Math.max(0, Math.min(255, Math.round(20 + v * 235)))
    }
  }
  const out = resolve(__dirname, '..', 'images', `tv-static-${f}.png`)
  const buf = png(g)
  writeFileSync(out, buf)
  console.log(`wrote ${out} (${(buf.length / 1024).toFixed(1)} KB)`)
}
