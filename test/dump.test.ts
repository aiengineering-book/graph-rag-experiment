import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openPglite } from '../src/db.js'
import { initSchema } from '../src/schema.js'
import { mockEmbedder } from '../src/embed.js'
import { ingest } from '../src/ingest.js'
import { mockLlm } from '../src/llm.js'
import { buildGraph, initGraphSchema } from '../src/graph/store.js'
import { exportGraph, importGraph } from '../src/graph/dump.js'
import { graphSearch } from '../src/systems/graph.js'

const passages = [
  { title: 'Marie Curie', text: 'Marie Curie was born in Warsaw.' },
  { title: 'Warsaw', text: 'Warsaw sits on the Vistula river.' },
  { title: 'Paris', text: 'Paris sits on the Seine river.' },
]
const extractions: Record<string, unknown> = {
  'Marie Curie': { entities: ['Marie Curie', 'Warsaw'], relations: [{ source: 'Marie Curie', relation: 'born in', target: 'Warsaw' }] },
  Warsaw: { entities: ['Warsaw', 'Vistula'], relations: [{ source: 'Warsaw', relation: 'sits on', target: 'Vistula' }] },
  Paris: { entities: ['Paris', 'Seine'], relations: [{ source: 'Paris', relation: 'sits on', target: 'Seine' }] },
}
const llm = () =>
  mockLlm(m =>
    m[0]!.content.includes('knowledge graph')
      ? JSON.stringify(extractions[/Title: (.*)/.exec(m[1]!.content)![1]!])
      : JSON.stringify({ entities: ['Marie Curie'] }),
  )

test('a dumped graph imports into an empty database and answers the same queries', async () => {
  const embedder = mockEmbedder(64)
  const a = await openPglite()
  await initSchema(a, 64)
  await initGraphSchema(a, 64)
  await ingest(a, embedder, passages)
  await buildGraph(a, llm(), embedder)
  const question = 'On which river does the birthplace of Marie Curie sit?'
  const original = await graphSearch(a, embedder, llm(), question, { k: 2 })

  const dump = JSON.parse(JSON.stringify(await exportGraph(a, 'mock')))
  assert.equal(JSON.stringify(dump).includes('embedding'), false)

  const b = await openPglite()
  await importGraph(b, embedder, dump)
  const count = async (t: string) => Number((await b.query<{ n: string }>(`SELECT count(*) AS n FROM ${t}`))[0]!.n)
  assert.equal(await count('chunks'), 3)
  assert.equal(await count('entities'), dump.entities.length)
  assert.equal(await count('relations'), 2 + 1)
  assert.equal(Number((await b.query<{ n: string }>('SELECT count(*) AS n FROM entities WHERE embedding IS NULL'))[0]!.n), 0)

  const imported = await graphSearch(b, embedder, llm(), question, { k: 2 })
  assert.deepEqual(imported.rows.map(r => r.title), original.rows.map(r => r.title))

  // New rows after an import must not collide with the imported ids.
  await b.query("INSERT INTO chunks (title, body, embedding) VALUES ('Berlin', 'Berlin sits on the Spree.', $1::vector)", [`[${new Array(64).fill(0).join(',')}]`])
  assert.equal(await count('chunks'), 4)
  await a.close()
  await b.close()
})
