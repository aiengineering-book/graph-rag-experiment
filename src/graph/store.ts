import type { Db } from '../db.js'
import { toVector } from '../db.js'
import type { Embedder } from '../embed.js'
import type { Llm } from '../llm.js'
import { normalize } from '../score.js'
import { extractPassage, type Extraction } from './extract.js'

// The graph lives in three plain tables next to `chunks`:
//   entities  - one row per distinct name (merged by normalized name)
//   mentions  - which entity appears in which chunk
//   relations - source -> target edges, each remembering the chunk it came from
// `extracted` records which chunks were processed, so a stopped build resumes.
export async function initGraphSchema(db: Db, dim: number, reset = false) {
  if (reset) {
    for (const t of ['relations', 'mentions', 'extracted', 'entities']) await db.query(`DROP TABLE IF EXISTS ${t} CASCADE`)
  }
  await db.query(`CREATE TABLE IF NOT EXISTS entities (
    id serial PRIMARY KEY, name text NOT NULL, key text NOT NULL UNIQUE, embedding vector(${dim}))`)
  await db.query(`CREATE TABLE IF NOT EXISTS mentions (
    entity_id int NOT NULL REFERENCES entities(id), chunk_id int NOT NULL REFERENCES chunks(id),
    PRIMARY KEY (entity_id, chunk_id))`)
  await db.query(`CREATE TABLE IF NOT EXISTS relations (
    id serial PRIMARY KEY, src int NOT NULL REFERENCES entities(id), dst int NOT NULL REFERENCES entities(id),
    label text NOT NULL, chunk_id int NOT NULL REFERENCES chunks(id))`)
  await db.query(`CREATE TABLE IF NOT EXISTS extracted (
    chunk_id int PRIMARY KEY REFERENCES chunks(id), parsed boolean NOT NULL)`)
  await db.query('CREATE INDEX IF NOT EXISTS relations_src_idx ON relations (src)')
  await db.query('CREATE INDEX IF NOT EXISTS relations_dst_idx ON relations (dst)')
  await db.query('CREATE INDEX IF NOT EXISTS mentions_chunk_idx ON mentions (chunk_id)')
}

async function entityId(db: Db, name: string): Promise<number | undefined> {
  const key = normalize(name)
  if (!key) return undefined
  const rows = await db.query<{ id: number }>(
    'INSERT INTO entities (name, key) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key RETURNING id',
    [name, key],
  )
  return rows[0]?.id
}

export async function saveExtraction(db: Db, chunkId: number, ex: Extraction) {
  const names = new Set(ex.entities)
  for (const r of ex.relations) {
    names.add(r.source)
    names.add(r.target)
  }
  const ids = new Map<string, number>()
  for (const name of names) {
    const id = await entityId(db, name)
    if (id === undefined) continue
    ids.set(name, id)
    await db.query('INSERT INTO mentions (entity_id, chunk_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, chunkId])
  }
  for (const r of ex.relations) {
    const src = ids.get(r.source)
    const dst = ids.get(r.target)
    if (src === undefined || dst === undefined || src === dst) continue
    await db.query('INSERT INTO relations (src, dst, label, chunk_id) VALUES ($1, $2, $3, $4)', [src, dst, r.relation, chunkId])
  }
  await db.query('INSERT INTO extracted (chunk_id, parsed) VALUES ($1, $2) ON CONFLICT DO NOTHING', [chunkId, ex.parsed])
}

export type BuildStats = { chunks: number; skipped: number; unparsed: number; entities: number; relations: number }

// LLM extraction for every chunk not yet processed, then embeddings for entity names.
export async function buildGraph(
  db: Db,
  llm: Llm,
  embedder: Embedder,
  opts: { limit?: number; concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BuildStats> {
  const todo = await db.query<{ id: number; title: string; body: string }>(
    `SELECT id, title, body FROM chunks WHERE id NOT IN (SELECT chunk_id FROM extracted) ORDER BY id LIMIT $1`,
    [opts.limit ?? 1_000_000],
  )
  let next = 0
  let done = 0
  let unparsed = 0
  let stop: unknown
  const worker = async () => {
    while (next < todo.length && !stop) {
      const c = todo[next++]!
      try {
        const ex = await extractPassage(llm, { title: c.title, body: c.body })
        if (!ex.parsed) unparsed++
        await saveExtraction(db, c.id, ex)
        done++
        opts.onProgress?.(done, todo.length)
      } catch (err) {
        stop = err
      }
    }
  }
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker))
  await embedEntityNames(db, embedder)
  const count = async (t: string) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${t}`))[0]!.n)
  if (stop) throw Object.assign(new Error(`build stopped after ${done} chunks: ${String(stop)}`), { cause: stop })
  return { chunks: done, skipped: 0, unparsed, entities: await count('entities'), relations: await count('relations') }
}

export async function embedEntityNames(db: Db, embedder: Embedder, batch = 64) {
  const rows = await db.query<{ id: number; name: string }>('SELECT id, name FROM entities WHERE embedding IS NULL ORDER BY id')
  for (let i = 0; i < rows.length; i += batch) {
    const part = rows.slice(i, i + batch)
    const vectors = await embedder.embed(part.map(r => r.name))
    for (let j = 0; j < part.length; j++) {
      await db.query('UPDATE entities SET embedding = $1::vector WHERE id = $2', [toVector(vectors[j]!), part[j]!.id])
    }
  }
}
