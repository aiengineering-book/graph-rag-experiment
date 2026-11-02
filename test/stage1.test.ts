import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openPglite, toVector } from '../src/db.js'
import { initSchema } from '../src/schema.js'
import { mockEmbedder } from '../src/embed.js'
import { ingest } from '../src/ingest.js'
import { BudgetExceeded, mockLlm } from '../src/llm.js'

const passages = [
  { title: 'Marie Curie', text: 'Marie Curie won the Nobel Prize in Physics in 1903 for research on radioactivity.' },
  { title: 'Warsaw', text: 'Warsaw is the capital of Poland and was the birthplace of Marie Curie.' },
  { title: 'Paris', text: 'Paris is the capital of France and sits on the river Seine.' },
]

test('ingest, vector search and keyword search work on Postgres', async () => {
  const db = await openPglite()
  const embedder = mockEmbedder(64)
  await initSchema(db, 64)
  let last = 0
  await ingest(db, embedder, passages, done => (last = done), 2)
  assert.equal(last, 3)

  const [q] = await embedder.embed(['Seine river France'])
  const byVector = await db.query<{ title: string }>(
    'SELECT title FROM chunks ORDER BY embedding <=> $1::vector LIMIT 1',
    [toVector(q!)],
  )
  assert.equal(byVector[0]!.title, 'Paris')

  const byKeyword = await db.query<{ title: string }>(
    "SELECT title FROM chunks WHERE tsv @@ plainto_tsquery('english', $1) ORDER BY ts_rank(tsv, plainto_tsquery('english', $1)) DESC",
    ['radioactivity Nobel'],
  )
  assert.equal(byKeyword[0]!.title, 'Marie Curie')
  await db.close()
})

test('the token budget stops the client', async () => {
  const llm = mockLlm(() => 'x'.repeat(400), 150)
  await llm.chat([{ role: 'user', content: 'y'.repeat(400) }]) // ~200 tokens, over budget
  await assert.rejects(() => llm.chat([{ role: 'user', content: 'hi' }]), BudgetExceeded)
  assert.equal(llm.usage().calls, 1)
})
