import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openPglite } from '../src/db.js'
import { initSchema } from '../src/schema.js'
import { mockEmbedder } from '../src/embed.js'
import { ingest } from '../src/ingest.js'
import { mockLlm } from '../src/llm.js'
import { hybrid } from '../src/systems/hybrid.js'
import { closedBook } from '../src/systems/closed-book.js'
import { buildPromptRows, scoreAnswers } from '../src/prompts.js'
import type { Question } from '../src/evaluate.js'

const passages = [
  { title: 'Marie Curie', text: 'Marie Curie was born in Warsaw.' },
  { title: 'Warsaw', text: 'Warsaw sits on the Vistula river.' },
  { title: 'Paris', text: 'Paris sits on the Seine river.' },
]
const questions: Question[] = [
  { id: 'q1', question: 'On which river does the birthplace of Marie Curie sit?', answer: 'Vistula', answer_aliases: ['Vistula river'],
    supporting: [{ title: 'Marie Curie', text: passages[0]!.text }, { title: 'Warsaw', text: passages[1]!.text }] },
]

test('exported prompts carry the exact messages, and external answers are scored the same way', async () => {
  const db = await openPglite()
  const embedder = mockEmbedder(64)
  await initSchema(db, 64)
  await ingest(db, embedder, passages)
  const llm = mockLlm(() => 'unused')

  const rows = await buildPromptRows(hybrid(db, embedder, llm, 3), questions)
  assert.equal(llm.usage().calls, 0, 'exporting must not call the answering model')
  assert.equal(rows[0]!.messages[1]!.content.includes('Vistula river'), true)
  assert.equal(rows[0]!.retrieved.length, 3)

  const good = scoreAnswers(rows, [{ id: 'q1', answer: 'The Vistula river' }])
  assert.equal(good.em, 1)
  assert.equal(good.supportRecall, 1)
  assert.equal(scoreAnswers(rows, [{ id: 'q1', answer: 'Seine' }]).em, 0)
  assert.equal(scoreAnswers(rows, []).stoppedEarly, true)

  const control = await buildPromptRows(closedBook(llm), questions)
  assert.equal(control[0]!.messages[1]!.content.startsWith('Question:'), true)
  await db.close()
})
