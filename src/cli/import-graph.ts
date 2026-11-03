import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { config } from '../config.js'
import { openPostgres } from '../db.js'
import { ollamaEmbedder } from '../embed.js'
import { importGraph, type Dump } from '../graph/dump.js'

// Usage: npm run import-graph   (replaces the database contents; recomputes embeddings with Ollama)
const dump = JSON.parse(gunzipSync(readFileSync('graph-dump/graph.json.gz')).toString('utf8')) as Dump
if (dump.embedModel !== config.embedModel) {
  console.warn(`note: the dump was built with ${dump.embedModel}, you are embedding with ${config.embedModel}`)
}
const db = openPostgres(config.databaseUrl)
const started = Date.now()
await importGraph(db, ollamaEmbedder(), dump, (stage, done, total) => {
  if (done === total || done % 640 === 0) console.log(`  ${stage} ${done}/${total}`)
})
mkdirSync('data', { recursive: true })
if (!existsSync('data/questions.json')) copyFileSync('graph-dump/questions.json', 'data/questions.json')
console.log(`imported in ${Math.round((Date.now() - started) / 1000)}s`)
await db.close()
