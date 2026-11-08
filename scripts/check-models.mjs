import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve('public/models/uae'), visited = new Set(), files = new Set(), missing = []
function visit(file) {
  if (visited.has(file)) return
  visited.add(file)
  if (!fs.existsSync(file)) { missing.push(file); return }
  files.add(file)
  if (path.extname(file) !== '.json') return
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  function walk(tile) {
    for (const content of [tile.content, ...(tile.contents || [])].filter(Boolean)) {
      const uri = content.uri || content.url
      if (/^https?:|^\//.test(uri)) throw new Error(`Model must be self-contained: ${uri}`)
      visit(path.resolve(path.dirname(file), decodeURIComponent(uri)))
    }
    for (const child of tile.children || []) walk(child)
  }
  if (data.root) walk(data.root)
}
visit(path.join(root, 'tileset.json'))
for (const unit of ['213','27','37','38','39']) visit(path.join(root, 'units', unit, 'tileset-standard.json'))
visit(path.resolve('public/models/diesel-4d/tileset.json'))
if (missing.length) { console.error(missing); process.exitCode = 1 }
else console.log(`PASS: ${files.size} local model files reachable; all 5 UAE unit manifests and the diesel project complete; no external model references.`)
const workerPath = path.resolve('public/models/workers/worker.glb')
const worker = fs.readFileSync(workerPath)
if (worker.readUInt32LE(0) !== 0x46546c67 || worker.readUInt32LE(8) !== worker.length) throw new Error('Worker GLB incomplete')
const gltf = JSON.parse(worker.subarray(20, 20 + worker.readUInt32LE(12)).toString('utf8'))
for (const clip of ['Idle', 'Walk', 'Run', 'Run_Back', 'Run_Left', 'Run_Right']) if (!gltf.animations.some(animation => animation.name.split('|').at(-1) === clip)) throw new Error(`Worker missing ${clip} animation`)
if (!gltf.skins?.length || gltf.buffers.some(buffer => buffer.uri)) throw new Error('Worker must contain an embedded skinned model')
for (const file of ['worker.jpg', 'LICENSE-AND-ATTRIBUTION.txt']) if (!fs.existsSync(path.resolve('public/models/workers', file))) throw new Error(`Worker resource missing: ${file}`)
console.log(`PASS: local worker GLB (${worker.length} bytes), skeletons, idle/walk/run/directional animations, preview and source/license notice.`)
