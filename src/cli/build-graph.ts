import { config } from '../config.js'
import { openPostgres } from '../db.js'
import { ollamaEmbedder } from '../embed.js'
import { buildGraph, initGraphSchema } from '../graph/store.js'
import { createLlm } from '../llm.js'

// Usage: npm run build-graph -- [--limit 20] [--concurrency 4] [--reset]
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const db = openPostgres(config.databaseUrl)
const embedder = ollamaEmbedder()
const dim = (await embedder.embed(['dimension probe']))[0]!.length
await initGraphSchema(db, dim, process.argv.includes('--reset'))

const llm = createLlm()
const started = Date.now()
try {
  const stats = await buildGraph(db, llm, embedder, {
    limit: arg('limit') ? Number(arg('limit')) : undefined,
    concurrency: Number(arg('concurrency') ?? 4),
    onProgress: (done, total) => {
      if (done % 20 === 0 || done === total) console.log(`  extracted ${done}/${total}`)
    },
  })
  const u = llm.usage()
  console.log(JSON.stringify({ ...stats, seconds: Math.round((Date.now() - started) / 1000), usage: u,
    promptTokensPerChunk: stats.chunks ? Math.round(u.promptTokens / stats.chunks) : 0,
    completionTokensPerChunk: stats.chunks ? Math.round(u.completionTokens / stats.chunks) : 0 }, null, 1))
} catch (err) {
  console.error(String(err), '\nusage so far:', llm.usage())
  process.exitCode = 1
}

const sample = await db.query<{ title: string; src: string; label: string; dst: string }>(
  `SELECT c.title, s.name AS src, r.label, d.name AS dst FROM relations r
   JOIN entities s ON s.id = r.src JOIN entities d ON d.id = r.dst JOIN chunks c ON c.id = r.chunk_id
   ORDER BY r.id LIMIT 12`,
)
console.log('\nsample relations:')
for (const r of sample) console.log(`  [${r.title}] ${r.src} --${r.label}--> ${r.dst}`)
await db.close()
