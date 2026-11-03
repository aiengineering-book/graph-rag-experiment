import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Bm25Index, tokenize } from '../src/bm25.js'

const docs = [
  { id: 1, title: 'Tucson, Arizona', body: 'Tucson is a city in Arizona that hosts the Tucson Raceway Park.' },
  { id: 2, title: 'Richmond, Virginia', body: 'Richmond hosts NASCAR races at Richmond International Raceway.' },
  { id: 3, title: 'Ulysses Kay', body: 'Ulysses Kay was an American composer born in Tucson.' },
  { id: 4, title: 'Paris', body: 'Paris is the capital of France and a city on the river Seine.' },
]

test('tokenizer lowercases and drops stopwords', () => {
  assert.deepEqual(tokenize('The Capital of France!'), ['capital', 'france'])
})

test('BM25 weights rare terms above common ones', () => {
  const idx = new Bm25Index(docs)
  // "city" appears in two documents, "composer" in one: the rarer term decides.
  assert.equal(idx.search('city composer', 3)[0]!.id, 3)
  assert.equal(idx.search('Seine river', 1)[0]!.id, 4)
  assert.deepEqual(idx.search('nothing matches xyzzy', 3), [])
})
