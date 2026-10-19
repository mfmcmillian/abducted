// Generate voice lines (text-to-speech) and sound effects with ElevenLabs. The API key is
// read from koa-bots/bots/.env (ELEVENLABS_API_KEY), never from the repo, never printed.
//
//   node tools/elevenlabs.mjs --voices                 list the account's voices (id, name, labels)
//   node tools/elevenlabs.mjs lines.json out-dir       render every line in the file, skip ones already there
//
// lines.json: [{ "name": "pod-hello", "text": "...", "voice": "<voice id>", "stability": 0.4, "style": 0.3 },
//              { "name": "pod-seal", "sfx": "hydraulic hiss, energy field sealing", "seconds": 2.5 }]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const env = readFileSync('C:/Users/matth/GitHub/koa-bots/bots/.env', 'utf8')
const KEY = env.match(/^ELEVENLABS_API_KEY=(.*)$/m)?.[1]?.trim()
if (!KEY) throw new Error('ELEVENLABS_API_KEY missing from koa-bots/bots/.env')
const API = 'https://api.elevenlabs.io/v1'
const headers = { 'xi-api-key': KEY, 'Content-Type': 'application/json' }

async function call(path, body) {
  const res = await fetch(API + path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res
}

async function render(line, outDir) {
  const out = join(outDir, line.name + '.mp3')
  if (existsSync(out)) return console.log(line.name, 'already there')
  let res
  if (line.sfx) {
    res = await call('/sound-generation', { text: line.sfx, duration_seconds: line.seconds ?? 3, prompt_influence: 0.5 })
  } else {
    res = await call(`/text-to-speech/${line.voice}?output_format=mp3_44100_128`, {
      text: line.text,
      model_id: line.model ?? 'eleven_multilingual_v2',
      voice_settings: { stability: line.stability ?? 0.45, similarity_boost: 0.8, style: line.style ?? 0.3, use_speaker_boost: true }
    })
  }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(out, buf)
  console.log(`${line.name}: ${(buf.length / 1024).toFixed(0)} KB -> ${out}`)
}

const [a, b] = process.argv.slice(2)
if (a === '--voices') {
  const { voices } = await (await call('/voices')).json()
  for (const v of voices) console.log(v.voice_id, '|', v.name, '|', Object.values(v.labels ?? {}).join(', '))
} else {
  const lines = JSON.parse(readFileSync(a, 'utf8'))
  mkdirSync(b, { recursive: true })
  for (const line of lines) await render(line, b)
}
