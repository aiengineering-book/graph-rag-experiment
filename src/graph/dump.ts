import type { Db } from '../db.js'
import type { Embedder } from '../embed.js'
import { initSchema } from '../schema.js'
import { embedEntityNames, initGraphSchema } from './store.js'

// A portable copy of the built graph. It carries text and structure but no
// embeddings (they are 98% of the size); the importer recomputes them locally.
export type Dump = {
  version: 1
  embedModel: string
  chunks: { id: number; title: string; body: string }[]
  entities: { id: number; name: string; key: string }[]
  mentions: { entity_id: number; chunk_id: number }[]
  relations: { id: number; src: number; dst: number; label: string; chunk_id: number }[]
  extracted: { chunk_id: number; parsed: boolean }[]
}

export async function exportGraph(db: Db, embedModel: string): Promise<Dump> {
  return {
    version: 1,
    embedModel,
    chunks: await db.query('SELECT id, title, body FROM chunks ORDER BY id'),
    entities: await db.query('SELECT id, name, key FROM entities ORDER BY id'),
    mentions: await db.query('SELECT entity_id, chunk_id FROM mentions ORDER BY entity_id, chunk_id'),
    relations: await db.query('SELECT id, src, dst, label, chunk_id FROM relations ORDER BY id'),
    extracted: await db.query('SELECT chunk_id, parsed FROM extracted ORDER BY chunk_id'),
  }
}

// Replaces whatever is in the database with the dump, then recomputes embeddings.
export async function importGraph(
  db: Db,
  embedder: Embedder,
  dump: Dump,
  onProgress: (stage: string, done: number, total: number) => void = () => {},
) {
  const dim = (await embedder.embed(['dimension probe']))[0]!.length
  await initSchema(db, dim, true)
  await initGraphSchema(db, dim, true)

  // Chunks need their embeddings for vector search, so embed while inserting.
  // Re-embedding gives vectors that are close to the original ones but not
  // identical, so a few near-tied rankings can differ from the published runs.
  const batch = 32
  for (let i = 0; i < dump.chunks.length; i += batch) {
    const part = dump.chunks.slice(i, i + batch)
    const vectors = await embedder.embed(part.map(c => `${c.title}\n${c.body}`))
    const rows = part.map((c, j) => ({ ...c, embedding: `[${vectors[j]!.join(',')}]` }))
    await db.query(
      `INSERT INTO chunks (id, title, body, embedding)
       SELECT id, title, body, embedding::vector FROM json_to_recordset($1::text::json)
       AS x(id int, title text, body text, embedding text)`,
      [JSON.stringify(rows)],
    )
    onProgress('chunks', Math.min(i + batch, dump.chunks.length), dump.chunks.length)
  }

  const insert = async (sql: string, rows: unknown[], chunk = 5000) => {
    for (let i = 0; i < rows.length; i += chunk) await db.query(sql, [JSON.stringify(rows.slice(i, i + chunk))])
  }
  await insert('INSERT INTO entities (id, name, key) SELECT id, name, key FROM json_to_recordset($1::text::json) AS x(id int, name text, key text)', dump.entities)
  await insert('INSERT INTO mentions (entity_id, chunk_id) SELECT entity_id, chunk_id FROM json_to_recordset($1::text::json) AS x(entity_id int, chunk_id int)', dump.mentions)
  await insert('INSERT INTO relations (id, src, dst, label, chunk_id) SELECT id, src, dst, label, chunk_id FROM json_to_recordset($1::text::json) AS x(id int, src int, dst int, label text, chunk_id int)', dump.relations)
  await insert('INSERT INTO extracted (chunk_id, parsed) SELECT chunk_id, parsed FROM json_to_recordset($1::text::json) AS x(chunk_id int, parsed boolean)', dump.extracted)
  for (const t of ['chunks', 'entities', 'relations']) {
    await db.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), (SELECT max(id) FROM ${t}))`)
  }
  onProgress('entities', 0, dump.entities.length)
  await embedEntityNames(db, embedder)
  onProgress('entities', dump.entities.length, dump.entities.length)
}
