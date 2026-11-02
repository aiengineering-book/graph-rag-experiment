import { readFileSync } from 'node:fs'
import { config } from '../config.js'
import { openPostgres } from '../db.js'
import { ollamaEmbedder } from '../embed.js'
import { ingest, type Passage } from '../ingest.js'
import { initSchema } from '../schema.js'

// Usage: npm run ingest   (drops and recreates the chunks table)
const passages = JSON.parse(readFileSync('data/paragraphs.json', 'utf8')) as Passage[]
const embedder = ollamaEmbedder()
const dim = (await embedder.embed(['dimension probe']))[0]!.length
console.log(`embedding model ${config.embedModel}: ${dim} dimensions`)

const db = openPostgres(config.databaseUrl)
await initSchema(db, dim, true)
const started = Date.now()
await ingest(db, embedder, passages, (done, total) => {
  if (done % 160 === 0 || done === total) console.log(`  ${done}/${total} passages`)
})
console.log(`ingested ${passages.length} passages in ${((Date.now() - started) / 1000).toFixed(0)}s`)
await db.close()
