import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openPglite } from '../src/db.js'
import { initSchema } from '../src/schema.js'
import { mockEmbedder } from '../src/embed.js'
import { ingest } from '../src/ingest.js'
import { mockLlm } from '../src/llm.js'
import { evaluate, type Question } from '../src/evaluate.js'
import { exactMatch, normalize, tokenF1 } from '../src/score.js'
import { closedBook } from '../src/systems/closed-book.js'
import { hybrid } from '../src/systems/hybrid.js'

const passages = [
  { title: 'Marie Curie', text: 'Marie Curie was born in Warsaw and won the Nobel Prize in Physics in 1903.' },
  { title: 'Warsaw', text: 'Warsaw is the capital of Poland and sits on the Vistula river.' },
  { title: 'Paris', text: 'Paris is the capital of France and sits on the Seine river.' },
  { title: 'Berlin', text: 'Berlin is the capital of Germany and sits on the Spree river.' },
]
const questions: Question[] = [
  {
    id: 'q1',
    question: 'On which river does the birthplace of Marie Curie sit?',
    answer: 'Vistula',
    answer_aliases: ['Vistula river'],
    supporting: [passages[0]!, passages[1]!],
  },
]

// Answers correctly only if the Vistula passage is in the prompt.
const llm = () => mockLlm(m => (m[1]!.content.includes('Vistula river') ? 'The Vistula river' : 'I do not know'))

test('scoring normalizes articles and punctuation', () => {
  assert.equal(normalize('The  Vistula, river!'), 'vistula river')
  assert.ok(exactMatch('the Vistula river', ['Vistula river']))
  assert.ok(tokenF1('Vistula', ['Vistula river']) > 0.6)
  assert.equal(tokenF1('Seine', ['Vistula river']), 0)
})

test('hybrid search finds both hops; closed-book does not', async () => {
  const db = await openPglite()
  const embedder = mockEmbedder(64)
  await initSchema(db, 64)
  await ingest(db, embedder, passages)

  const withRetrieval = await evaluate(hybrid(db, embedder, llm(), 3), llm(), questions)
  assert.equal(withRetrieval.questions, 1)
  assert.equal(withRetrieval.supportRecall, 1)

  const l1 = llm()
  const rag = await evaluate(hybrid(db, embedder, l1, 3), l1, questions)
  assert.equal(rag.em, 1)
  assert.equal(rag.usage.calls, 1)

  const l2 = llm()
  const control = await evaluate(closedBook(l2), l2, questions)
  assert.equal(control.em, 0)
  assert.equal(control.supportRecall, 0)
  await db.close()
})
