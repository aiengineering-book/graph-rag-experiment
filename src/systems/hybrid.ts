import { answerWith, type Passage } from '../answer.js'
import type { Db } from '../db.js'
import { toVector } from '../db.js'
import { Bm25Index } from '../bm25.js'
import type { Embedder } from '../embed.js'
import type { Llm } from '../llm.js'
import type { RagSystem } from './types.js'

type Row = Passage & { id: number }

// 'tsrank' is Postgres full-text ranking (the default); 'bm25' is the book's BM25.
export type Keyword = 'tsrank' | 'bm25'

const bm25Indexes = new WeakMap<Db, Promise<Bm25Index>>()
function bm25Index(db: Db): Promise<Bm25Index> {
  let idx = bm25Indexes.get(db)
  if (!idx) {
    idx = db.query<Row>('SELECT id, title, body FROM chunks ORDER BY id').then(rows => new Bm25Index(rows))
    bm25Indexes.set(db, idx)
  }
  return idx
}

// Vector search and keyword search each return a ranked list; reciprocal rank
// fusion (RRF) merges them: score = sum of 1 / (60 + rank) over the lists.
export async function hybridSearch(
  db: Db,
  embedder: Embedder,
  query: string,
  k = 5,
  pool = 20,
  keyword: Keyword = 'tsrank',
): Promise<Row[]> {
  const [qv] = await embedder.embed([query])
  const byVector = await db.query<Row>(
    'SELECT id, title, body FROM chunks ORDER BY embedding <=> $1::vector LIMIT $2',
    [toVector(qv!), pool],
  )
  // A question is not a keyword query, so match any word (OR) instead of all.
  const words = [...new Set(query.match(/[A-Za-z0-9]+/g) ?? [])]
  const byKeyword: Row[] =
    keyword === 'bm25'
      ? (await bm25Index(db)).search(query, pool)
      : words.length
    ? await db.query<Row>(
        `SELECT id, title, body FROM chunks
         WHERE tsv @@ to_tsquery('english', $1)
         ORDER BY ts_rank(tsv, to_tsquery('english', $1)) DESC LIMIT $2`,
        [words.join(' | '), pool],
      )
    : []

  const score = new Map<number, { row: Row; s: number }>()
  for (const list of [byVector, byKeyword]) {
    list.forEach((row, rank) => {
      const entry = score.get(row.id) ?? { row, s: 0 }
      entry.s += 1 / (60 + rank + 1)
      score.set(row.id, entry)
    })
  }
  return [...score.values()].sort((a, b) => b.s - a.s).slice(0, k).map(e => e.row)
}

export function hybrid(db: Db, embedder: Embedder, llm: Llm, k = 5, keyword: Keyword = 'tsrank'): RagSystem {
  return {
    name: 'hybrid',
    retrieve: question => hybridSearch(db, embedder, question, k, 20, keyword),
    async answer(question) {
      const retrieved = await hybridSearch(db, embedder, question, k, 20, keyword)
      return { answer: await answerWith(llm, question, retrieved), retrieved }
    },
  }
}
