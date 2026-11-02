import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openPglite } from '../src/db.js'
import { initSchema } from '../src/schema.js'
import { mockEmbedder } from '../src/embed.js'
import { ingest } from '../src/ingest.js'
import { mockLlm, BudgetExceeded } from '../src/llm.js'
import { parseExtraction } from '../src/graph/extract.js'
import { buildGraph, initGraphSchema } from '../src/graph/store.js'
import { graph, graphSearch } from '../src/systems/graph.js'

const passages = [
  { title: 'Marie Curie', text: 'Marie Curie was born in Warsaw and won the Nobel Prize in Physics in 1903.' },
  { title: 'Warsaw', text: 'Warsaw is the capital of Poland and sits on the Vistula river.' },
  { title: 'Paris', text: 'Paris is the capital of France and sits on the Seine river.' },
  { title: 'Berlin', text: 'Berlin is the capital of Germany and sits on the Spree river.' },
]
const extractions: Record<string, unknown> = {
  'Marie Curie': { entities: ['Marie Curie', 'Warsaw'], relations: [{ source: 'Marie Curie', relation: 'born in', target: 'Warsaw' }] },
  Warsaw: { entities: ['Warsaw', 'Poland', 'Vistula'], relations: [{ source: 'Warsaw', relation: 'sits on', target: 'Vistula' }] },
  Paris: { entities: ['Paris', 'France', 'Seine'], relations: [{ source: 'Paris', relation: 'sits on', target: 'Seine' }] },
  Berlin: { entities: ['Berlin', 'Germany', 'Spree'], relations: [{ source: 'Berlin', relation: 'sits on', target: 'Spree' }] },
}

// One mock model for all three roles: extraction, question entities, answering.
const llm = (budget = Infinity) =>
  mockLlm(m => {
    const system = m[0]!.content
    if (system.includes('knowledge graph')) return JSON.stringify(extractions[/Title: (.*)/.exec(m[1]!.content)![1]!])
    if (system.includes('named entities')) return JSON.stringify({ entities: ['Marie Curie'] })
    return m[1]!.content.includes('Vistula river') ? 'Vistula river' : 'I do not know'
  }, budget)

test('parseExtraction tolerates fences and bad JSON', () => {
  const ok = parseExtraction('```json\n{"entities":["A"],"relations":[{"source":"A","relation":"r","target":"B"}]}\n```')
  assert.deepEqual(ok.entities, ['A'])
  assert.equal(ok.relations.length, 1)
  assert.equal(parseExtraction('sorry, no').parsed, false)
})

test('graph search follows two hops to the passage the question never names', async () => {
  const db = await openPglite()
  const embedder = mockEmbedder(64)
  await initSchema(db, 64)
  await initGraphSchema(db, 64)
  await ingest(db, embedder, passages)
  const stats = await buildGraph(db, llm(), embedder, { concurrency: 2 })
  assert.equal(stats.chunks, 4)
  assert.equal(stats.unparsed, 0)
  assert.ok(stats.entities >= 8)

  // Resumable: a second build finds nothing left to do.
  assert.equal((await buildGraph(db, llm(), embedder)).chunks, 0)

  const found = await graphSearch(db, embedder, llm(), 'On which river does the birthplace of Marie Curie sit?', { k: 2 })
  assert.equal(found.seeds, 1)
  assert.deepEqual(found.rows.map(r => r.title).sort(), ['Marie Curie', 'Warsaw'])

  const l = llm()
  const answer = await graph(db, embedder, l, 2).answer('On which river does the birthplace of Marie Curie sit?')
  assert.equal(answer.answer, 'Vistula river')
  await db.close()
})

test('a build that hits the token budget stops and can resume', async () => {
  const db = await openPglite()
  const embedder = mockEmbedder(64)
  await initSchema(db, 64)
  await initGraphSchema(db, 64)
  await ingest(db, embedder, passages)
  await assert.rejects(() => buildGraph(db, llm(60), embedder, { concurrency: 1 }), /build stopped/)
  const done = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM extracted'))[0]!.n)
  assert.ok(done >= 1 && done < 4)
  assert.equal((await buildGraph(db, llm(), embedder)).chunks, 4 - done)
  await db.close()
})
