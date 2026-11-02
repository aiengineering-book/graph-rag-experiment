import { answerWith, type Passage } from '../answer.js'
import type { Db } from '../db.js'
import { toVector } from '../db.js'
import type { Embedder } from '../embed.js'
import type { Llm } from '../llm.js'
import type { RagSystem } from './types.js'

type Row = Passage & { id: number }

// Vector search and keyword search each return a ranked list; reciprocal rank
// fusion (RRF) merges them: score = sum of 1 / (60 + rank) over the lists.
export async function hybridSearch(
  db: Db,
  embedder: Embedder,
  query: string,
  k = 5,
  pool = 20,
): Promise<Row[]> {
  const [qv] = await embedder.embed([query])
  const byVector = await db.query<Row>(
    'SELECT id, title, body FROM chunks ORDER BY embedding <=> $1::vector LIMIT $2',
    [toVector(qv!), pool],
  )
  // A question is not a keyword query, so match any word (OR) instead of all.
  const words = [...new Set(query.match(/[A-Za-z0-9]+/g) ?? [])]
  const byKeyword = words.length
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

export function hybrid(db: Db, embedder: Embedder, llm: Llm, k = 5): RagSystem {
  return {
    name: 'hybrid',
    async answer(question) {
      const retrieved = await hybridSearch(db, embedder, question, k)
      return { answer: await answerWith(llm, question, retrieved), retrieved }
    },
  }
}
