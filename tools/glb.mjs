// Tiny binary glTF writer shared by the model generators in this folder.

export class MeshBuf {
  constructor(name, material = 0) {
    this.name = name
    this.material = material
    this.pos = []
    this.nrm = []
    this.uv = []
    this.idx = []
  }
  vertex(p, n, t) {
    this.pos.push(...p)
    this.nrm.push(...n)
    this.uv.push(...t)
    return this.pos.length / 3 - 1
  }
  tri(a, b, c) {
    this.idx.push(a, b, c)
  }
  /** Quad from four corners (CCW seen from the side the normal points to). */
  quad(p0, p1, p2, p3, n, doubleSided = false) {
    const a = this.vertex(p0, n, [0, 0])
    const b = this.vertex(p1, n, [1, 0])
    const c = this.vertex(p2, n, [1, 1])
    const d = this.vertex(p3, n, [0, 1])
    this.tri(a, b, c)
    this.tri(a, c, d)
    if (doubleSided) {
      this.tri(a, c, b)
      this.tri(a, d, c)
    }
  }
  /** Flat horizontal annulus (or disc when rInner = 0) facing +Y at height y. */
  annulus(cx, cz, rInner, rOuter, y, segments) {
    const TAU = Math.PI * 2
    const inner = []
    const outer = []
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * TAU
      const sx = Math.sin(t)
      const cz2 = Math.cos(t)
      inner.push(this.vertex([cx + rInner * sx, y, cz + rInner * cz2], [0, 1, 0], [i / segments, 0]))
      outer.push(this.vertex([cx + rOuter * sx, y, cz + rOuter * cz2], [0, 1, 0], [i / segments, 1]))
    }
    for (let i = 0; i < segments; i++) {
      // (B-A)x(C-A) must point +Y; with x=sin, z=cos that is inner -> outer -> next outer.
      this.tri(inner[i], outer[i], outer[i + 1])
      if (rInner > 0) this.tri(inner[i], outer[i + 1], inner[i + 1])
    }
  }
  get triCount() {
    return this.idx.length / 3
  }
}

function pad4(n) {
  return (n + 3) & ~3
}

export function buildGlb(meshes, materials, sceneName = 'Scene', generator = 'abducted-dome tools') {
  const bufferViews = []
  const accessors = []
  const chunks = []
  let byteOffset = 0

  const pushView = (typedArray, target) => {
    const len = typedArray.byteLength
    const padded = pad4(len)
    const buf = Buffer.alloc(padded)
    Buffer.from(typedArray.buffer, typedArray.byteOffset, len).copy(buf)
    chunks.push(buf)
    bufferViews.push({ buffer: 0, byteOffset, byteLength: len, target })
    byteOffset += padded
    return bufferViews.length - 1
  }

  const minMax = (arr, comps) => {
    const min = new Array(comps).fill(Infinity)
    const max = new Array(comps).fill(-Infinity)
    for (let i = 0; i < arr.length; i += comps)
      for (let c = 0; c < comps; c++) {
        if (arr[i + c] < min[c]) min[c] = arr[i + c]
        if (arr[i + c] > max[c]) max[c] = arr[i + c]
      }
    return { min, max }
  }

  const gltfMeshes = []
  const nodes = []
  for (const m of meshes) {
    const pos = new Float32Array(m.pos)
    const nrm = new Float32Array(m.nrm)
    const uv = new Float32Array(m.uv)
    const idx = new Uint16Array(m.idx)
    if (pos.length / 3 > 65535) throw new Error(`${m.name}: too many vertices for uint16 indices`)

    const posView = pushView(pos, 34962)
    const { min, max } = minMax(m.pos, 3)
    accessors.push({ bufferView: posView, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max })
    const posAcc = accessors.length - 1

    const nrmView = pushView(nrm, 34962)
    accessors.push({ bufferView: nrmView, componentType: 5126, count: nrm.length / 3, type: 'VEC3' })
    const nrmAcc = accessors.length - 1

    const uvView = pushView(uv, 34962)
    accessors.push({ bufferView: uvView, componentType: 5126, count: uv.length / 2, type: 'VEC2' })
    const uvAcc = accessors.length - 1

    const idxView = pushView(idx, 34963)
    accessors.push({ bufferView: idxView, componentType: 5123, count: idx.length, type: 'SCALAR' })
    const idxAcc = accessors.length - 1

    gltfMeshes.push({
      name: m.name,
      primitives: [
        {
          attributes: { POSITION: posAcc, NORMAL: nrmAcc, TEXCOORD_0: uvAcc },
          indices: idxAcc,
          material: m.material,
          mode: 4
        }
      ]
    })
    nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 })
  }

  const json = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ name: sceneName, nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: byteOffset }]
  }

  let jsonStr = JSON.stringify(json)
  while (jsonStr.length % 4 !== 0) jsonStr += ' '
  const jsonBuf = Buffer.from(jsonStr, 'utf8')
  const binBuf = Buffer.concat(chunks)

  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8)

  const jsonChunkHeader = Buffer.alloc(8)
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0)
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4) // JSON
  const binChunkHeader = Buffer.alloc(8)
  binChunkHeader.writeUInt32LE(binBuf.length, 0)
  binChunkHeader.writeUInt32LE(0x004e4942, 4) // BIN

  return Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuf])
}

/** Unlit-ish emissive PBR material helper. */
export function emissiveMaterial(name, rgb, strength = 1, alpha = 1) {
  const mat = {
    name,
    pbrMetallicRoughness: { baseColorFactor: [rgb[0] * 0.2, rgb[1] * 0.2, rgb[2] * 0.2, alpha], metallicFactor: 0, roughnessFactor: 1 },
    emissiveFactor: rgb,
    doubleSided: true
  }
  if (strength !== 1) mat.extensions = { KHR_materials_emissive_strength: { emissiveStrength: strength } }
  if (alpha < 1) mat.alphaMode = 'BLEND'
  return mat
}
