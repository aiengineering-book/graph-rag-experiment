import type { Db } from './db.js'

// One row per source passage. `embedding` serves the vector baseline and
// `tsv` the keyword side of hybrid search. `dim` must match the embedding model.
export async function initSchema(db: Db, dim: number, reset = false) {
  await db.query('CREATE EXTENSION IF NOT EXISTS vector')
  if (reset) await db.query('DROP TABLE IF EXISTS chunks CASCADE')
  await db.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id serial PRIMARY KEY,
      title text NOT NULL,
      body text NOT NULL,
      embedding vector(${dim}),
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED
    )`)
  await db.query('CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv)')
}
