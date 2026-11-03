import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { config } from '../config.js'
import { openPostgres } from '../db.js'
import { ollamaEmbedder } from '../embed.js'
import type { Question } from '../evaluate.js'
import { createLlm } from '../llm.js'
import { buildPromptRows } from '../prompts.js'
import { closedBook } from '../systems/closed-book.js'
import { graph, graphHybrid, questionEntities } from '../systems/graph.js'
import { hybrid } from '../systems/hybrid.js'
import type { RagSystem } from '../systems/types.js'

// Usage: npm run export-prompts -- [--system hybrid] [--limit 100] [--k 5] [--hops 2] [--max-degree 20] [--keyword bm25]
// Writes prompts/<system>.jsonl. Retrieval needs Postgres and Ollama; no answering model is called.
// The graph systems need the entities named in each question, which are cached in
// graph-dump/question-entities.json so that exporting needs no LLM once the cache exists.
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const num = (name: string) => (arg(name) === undefined ? undefined : Number(arg(name)))
const k = num('k') ?? 5
const keyword = arg('keyword') === 'bm25' ? 'bm25' : 'tsrank'
const search = { hops: num('hops'), maxDegree: num('max-degree') }
const tag = [num('hops') !== undefined && `hops${num('hops')}`, num('max-degree') !== undefined && `deg${num('max-degree')}`, k !== 5 && `k${k}`, keyword === 'bm25' && 'bm25']
  .filter(Boolean).join('-')
const questions = (JSON.parse(readFileSync('data/questions.json', 'utf8')) as Question[]).slice(0, num('limit') ?? Infinity)

const cachePath = 'graph-dump/question-entities.json'
const cache: Record<string, string[]> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}
const llm = createLlm()
const entitiesFor = async (q: string) => (cache[q] ??= await questionEntities(llm, q))

const db = openPostgres(config.databaseUrl)
const embedder = ollamaEmbedder()
const systems: Record<string, () => RagSystem> = {
  'closed-book': () => closedBook(llm),
  hybrid: () => hybrid(db, embedder, llm, k, keyword),
  graph: () => graph(db, embedder, llm, k, search, entitiesFor),
  'graph+hybrid': () => graphHybrid(db, embedder, llm, k, search, entitiesFor, keyword),
}
const which = arg('system') ? [arg('system')!] : Object.keys(systems)
mkdirSync('prompts', { recursive: true })
for (const name of which) {
  if (!systems[name]) throw new Error(`unknown system "${name}"; use ${Object.keys(systems).join(', ')}`)
  const rows = await buildPromptRows(systems[name]!(), questions)
  const file = `prompts/${name.replace('+', '-')}${tag && name !== 'closed-book' ? `-${tag}` : ''}.jsonl`
  writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(`${file}: ${rows.length} prompts`)
}
writeFileSync(cachePath, JSON.stringify(cache, null, 1))
console.log(`question entities cached in ${cachePath} (${Object.keys(cache).length} questions); LLM calls made: ${llm.usage().calls}`)
await db.close()
