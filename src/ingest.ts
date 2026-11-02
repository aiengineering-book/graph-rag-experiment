import type { Db } from './db.js'
import { toVector } from './db.js'
import type { Embedder } from './embed.js'

export type Passage = { title: string; text: string }

// MuSiQue passages are already short, so each passage becomes one chunk.
// Embeds in batches and inserts; the caller decides whether to reset first.
export async function ingest(
  db: Db,
  embedder: Embedder,
  passages: Passage[],
  onProgress: (done: number, total: number) => void = () => {},
  batchSize = 32,
) {
  for (let i = 0; i < passages.length; i += batchSize) {
    const batch = passages.slice(i, i + batchSize)
    const vectors = await embedder.embed(batch.map(p => `${p.title}\n${p.text}`))
    for (let j = 0; j < batch.length; j++) {
      await db.query('INSERT INTO chunks (title, body, embedding) VALUES ($1, $2, $3::vector)', [
        batch[j]!.title,
        batch[j]!.text,
        toVector(vectors[j]!),
      ])
    }
    onProgress(Math.min(i + batchSize, passages.length), passages.length)
  }
}
