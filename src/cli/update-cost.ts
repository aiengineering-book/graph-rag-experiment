import postgres from 'postgres'
import { config } from '../config.js'
import type { Db } from '../db.js'
import { toVector } from '../db.js'
import { ollamaEmbedder } from '../embed.js'
import { extractPassage } from '../graph/extract.js'
import { embedEntityNames, saveExtraction } from '../graph/store.js'
import { createLlm } from '../llm.js'

// Usage: npm run update-cost -- [--n 5]
// Edits one passage at a time, brings the hybrid index and the graph up to date,
// and reports what each costs. Everything runs in a transaction that is rolled
// back, so the data the evaluations ran on is left as it was.
const n = Number(process.argv[process.argv.indexOf('--n') + 1] || 5)
class Rollback extends Error {}

const sql = postgres(config.databaseUrl, { onnotice: () => {} })
const embedder = ollamaEmbedder()
const llm = createLlm()
const out: Record<string, unknown>[] = []

try {
  await sql.begin(async tx => {
    const db: Db = { query: async <T>(t: string, p: unknown[] = []) => (await tx.unsafe(t, p as never[])) as unknown as T[], close: async () => {} }
    const total = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM chunks'))[0]!.n)
    const ids = Array.from({ length: n }, (_, i) => Math.floor(((i + 0.5) * total) / n) + 1)
    for (const id of ids) {
      const [c] = await db.query<{ title: string; body: string }>('SELECT title, body FROM chunks WHERE id = $1', [id])
      if (!c) continue
      const body = `${c.body} A later revision added one more sentence to this passage.`

      // Hybrid index: the text and its embedding change, no LLM call.
      let t = Date.now()
      const [vec] = await embedder.embed([`${c.title}\n${body}`])
      await db.query('UPDATE chunks SET body = $1, embedding = $2::vector WHERE id = $3', [body, toVector(vec!), id])
      const hybridMs = Date.now() - t

      // Graph: drop what this chunk contributed, extract again, write, embed new names.
      const before = llm.usage()
      t = Date.now()
      await db.query('DELETE FROM relations WHERE chunk_id = $1', [id])
      await db.query('DELETE FROM mentions WHERE chunk_id = $1', [id])
      await db.query('DELETE FROM extracted WHERE chunk_id = $1', [id])
      const ex = await extractPassage(llm, { title: c.title, body })
      await saveExtraction(db, id, ex)
      await embedEntityNames(db, embedder)
      const graphMs = Date.now() - t
      const after = llm.usage()
      const orphans = Number((await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM entities e WHERE NOT EXISTS (SELECT 1 FROM mentions m WHERE m.entity_id = e.id)'))[0]!.n)
      out.push({ chunk: id, hybridMs, graphMs, llmCalls: after.calls - before.calls,
        promptTokens: after.promptTokens - before.promptTokens, completionTokens: after.completionTokens - before.completionTokens,
        entitiesWithNoMention: orphans })
    }
    throw new Rollback()
  })
} catch (err) {
  if (!(err instanceof Rollback)) throw err
}
console.log(JSON.stringify(out, null, 1))
const avg = (k: string) => Math.round(out.reduce((s, r) => s + (r[k] as number), 0) / out.length)
console.log(`\nper edited passage, average of ${out.length}: hybrid ${avg('hybridMs')} ms, 0 LLM tokens; ` +
  `graph ${avg('graphMs')} ms, ${avg('promptTokens')} prompt + ${avg('completionTokens')} completion tokens`)
await sql.end()
