import { copyFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { config } from '../config.js'
import { openPostgres } from '../db.js'
import { exportGraph } from '../graph/dump.js'

// Usage: npm run export-graph   (writes graph-dump/graph.json.gz and graph-dump/questions.json)
const db = openPostgres(config.databaseUrl)
const dump = await exportGraph(db, config.embedModel)
mkdirSync('graph-dump', { recursive: true })
writeFileSync('graph-dump/graph.json.gz', gzipSync(JSON.stringify(dump), { level: 9 }))
copyFileSync('data/questions.json', 'graph-dump/questions.json')
console.log(
  `exported ${dump.chunks.length} chunks, ${dump.entities.length} entities, ${dump.mentions.length} mentions, ` +
    `${dump.relations.length} relations: graph.json.gz is ${(statSync('graph-dump/graph.json.gz').size / 1e6).toFixed(2)} MB`,
)
await db.close()
