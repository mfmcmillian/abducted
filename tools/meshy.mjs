// Generate models with Meshy text-to-3D (preview -> refine with PBR textures) and download
// the GLBs. The API key is read from koa-bots/bots/.env (MESHY_API_KEY), never from the repo.
//
//   node tools/meshy.mjs jobs.json out-dir        run every job in the file (parallel), skip ones already downloaded
//   node tools/meshy.mjs --status                 list recent tasks
//
// jobs.json: [{ "name": "house", "prompt": "...", "polycount": 100000, "style": "sculpture" }, ...]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const env = readFileSync('C:/Users/matth/GitHub/koa-bots/bots/.env', 'utf8')
const KEY = env.match(/^MESHY_API_KEY=(.*)$/m)?.[1]?.trim()
if (!KEY) throw new Error('MESHY_API_KEY missing from koa-bots/bots/.env')
const API = 'https://api.meshy.ai/openapi/v2/text-to-3d'
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

async function waitFor(id, label) {
  for (;;) {
    const t = await api('GET', '/' + id)
    if (t.status === 'SUCCEEDED') return t
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${label}: ${t.status} ${t.task_error?.message ?? ''}`)
    process.stdout.write(`\r${label}: ${t.status} ${t.progress ?? 0}%   `)
    await sleep(8000)
  }
}

async function runJob(job, outDir) {
  const out = join(outDir, job.name + '.glb')
  if (existsSync(out)) return console.log(job.name, 'already there')
  const stateFile = join(outDir, job.name + '.task.json')
  let state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}

  if (!state.preview) {
    const r = await api('POST', '', {
      mode: 'preview',
      prompt: job.prompt,
      art_style: job.style ?? 'sculpture',
      ai_model: job.model ?? 'latest',
      topology: 'triangle',
      target_polycount: job.polycount ?? 60000,
      should_remesh: true,
      symmetry_mode: job.symmetry ?? 'auto'
    })
    state.preview = r.result
    writeFileSync(stateFile, JSON.stringify(state))
    console.log(job.name, 'preview task', state.preview)
  }
  await waitFor(state.preview, job.name + ' preview')

  if (!state.refine) {
    const r = await api('POST', '', { mode: 'refine', preview_task_id: state.preview, enable_pbr: true, texture_prompt: job.texture })
    state.refine = r.result
    writeFileSync(stateFile, JSON.stringify(state))
    console.log(`\n${job.name} refine task`, state.refine)
  }
  const done = await waitFor(state.refine, job.name + ' refine')
  const url = done.model_urls?.glb
  if (!url) throw new Error(job.name + ': no glb url')
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer())
  writeFileSync(out, buf)
  console.log(`\n${job.name}: ${(buf.length / 1e6).toFixed(1)} MB -> ${out}`)
}

const [a, b] = process.argv.slice(2)
if (a === '--status') {
  const list = await api('GET', '?page_size=30&sort_by=-created_at')
  for (const t of list) console.log(t.id, t.mode, t.status, t.progress, (t.prompt ?? '').slice(0, 60))
} else {
  const jobs = JSON.parse(readFileSync(a, 'utf8'))
  mkdirSync(b, { recursive: true })
  const results = await Promise.allSettled(jobs.map((j) => runJob(j, b)))
  results.forEach((r, i) => r.status === 'rejected' && console.log('\nFAILED', jobs[i].name, r.reason?.message))
}
