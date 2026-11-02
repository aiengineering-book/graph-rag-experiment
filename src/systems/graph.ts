import { answerWith, type Passage } from '../answer.js'
import type { Db } from '../db.js'
import { toVector } from '../db.js'
import type { Embedder } from '../embed.js'
import type { Llm } from '../llm.js'
import { hybridSearch } from './hybrid.js'
import type { RagSystem } from './types.js'

const QUESTION_ENTITIES_SYSTEM =
  'List the named entities (people, places, works, organizations, dates) mentioned in the question. ' +
  'Reply with JSON only: {"entities": ["name", ...]}.'

type Row = Passage & { id: number }

export async function questionEntities(llm: Llm, question: string): Promise<string[]> {
  const text = await llm.chat(
    [
      { role: 'system', content: QUESTION_ENTITIES_SYSTEM },
      { role: 'user', content: question },
    ],
    { maxTokens: 200, json: true },
  )
  try {
    const raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { entities?: unknown }
    return (Array.isArray(raw.entities) ? raw.entities : []).filter((e): e is string => typeof e === 'string')
  } catch {
    return []
  }
}

const ids = (xs: number[]) => `{${xs.join(',')}}`

export type SearchOpts = { hops?: number; k?: number; seedsPerName?: number; maxPerHop?: number; maxDegree?: number }

// Number of distinct neighbours per entity, used to spot hubs such as "Florida".
const degrees = new WeakMap<Db, Map<number, number>>()
async function degreeMap(db: Db): Promise<Map<number, number>> {
  let m = degrees.get(db)
  if (!m) {
    const rows = await db.query<{ x: number; deg: string }>(
      `SELECT x, count(DISTINCT y) AS deg FROM
         (SELECT src AS x, dst AS y FROM relations UNION ALL SELECT dst, src FROM relations) t GROUP BY x`,
    )
    m = new Map(rows.map(r => [r.x, Number(r.deg)]))
    degrees.set(db, m)
  }
  return m
}

// Local search: find the question's entities in the graph, walk `hops` steps along
// relations, and rank chunks by how close their entities are to the seeds
// (weight 1 / (1 + hops from a seed), summed over the chunk's entities).
export async function graphSearch(
  db: Db,
  embedder: Embedder,
  llm: Llm,
  question: string,
  opts: SearchOpts = {},
): Promise<{ rows: Row[]; seeds: number }> {
  const { hops = 2, k = 5, seedsPerName = 1, maxPerHop = 50, maxDegree } = opts
  const degree = maxDegree === undefined ? undefined : await degreeMap(db)
  const names = await questionEntities(llm, question)
  if (names.length === 0) return { rows: [], seeds: 0 }

  const distance = new Map<number, number>()
  const vectors = await embedder.embed(names)
  for (const v of vectors) {
    const found = await db.query<{ id: number }>(
      'SELECT id FROM entities WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $2',
      [toVector(v), seedsPerName],
    )
    for (const f of found) distance.set(f.id, 0)
  }
  const seeds = distance.size

  let frontier = [...distance.keys()]
  for (let h = 1; h <= hops && frontier.length > 0; h++) {
    // Hubs (more than maxDegree neighbours) still count through their own
    // mentions, but the walk does not continue through them.
    const walk = degree ? frontier.filter(n => (degree.get(n) ?? 0) <= maxDegree!) : frontier
    if (walk.length === 0) break
    const edges = await db.query<{ src: number; dst: number }>(
      'SELECT src, dst FROM relations WHERE src = ANY($1::int[]) OR dst = ANY($1::int[])',
      [ids(walk)],
    )
    const fresh = new Set<number>()
    for (const e of edges) for (const n of [e.src, e.dst]) if (!distance.has(n)) fresh.add(n)
    frontier = [...fresh].slice(0, maxPerHop)
    for (const n of frontier) distance.set(n, h)
  }

  const reached = [...distance.keys()]
  if (reached.length === 0) return { rows: [], seeds }
  const mentions = await db.query<{ entity_id: number; chunk_id: number }>(
    'SELECT entity_id, chunk_id FROM mentions WHERE entity_id = ANY($1::int[])',
    [ids(reached)],
  )
  const score = new Map<number, number>()
  for (const m of mentions) score.set(m.chunk_id, (score.get(m.chunk_id) ?? 0) + 1 / (1 + distance.get(m.entity_id)!))
  const top = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id)
  if (top.length === 0) return { rows: [], seeds }
  const rows = await db.query<Row>('SELECT id, title, body FROM chunks WHERE id = ANY($1::int[])', [ids(top)])
  rows.sort((a, b) => top.indexOf(a.id) - top.indexOf(b.id))
  return { rows, seeds }
}

export function graph(db: Db, embedder: Embedder, llm: Llm, k = 5, search: SearchOpts = {}): RagSystem {
  return {
    name: 'graph',
    async answer(question) {
      const { rows } = await graphSearch(db, embedder, llm, question, { ...search, k })
      return { answer: await answerWith(llm, question, rows), retrieved: rows }
    },
  }
}

// Graph passages and hybrid passages merged by reciprocal rank fusion.
export function graphHybrid(db: Db, embedder: Embedder, llm: Llm, k = 5, search: SearchOpts = {}): RagSystem {
  return {
    name: 'graph+hybrid',
    async answer(question) {
      const [g, h] = await Promise.all([
        graphSearch(db, embedder, llm, question, { ...search, k: 20 }),
        hybridSearch(db, embedder, question, 20),
      ])
      const score = new Map<number, { row: Row; s: number }>()
      for (const list of [g.rows, h]) {
        list.forEach((row, rank) => {
          const e = score.get(row.id) ?? { row, s: 0 }
          e.s += 1 / (60 + rank + 1)
          score.set(row.id, e)
        })
      }
      const rows = [...score.values()].sort((a, b) => b.s - a.s).slice(0, k).map(e => e.row)
      return { answer: await answerWith(llm, question, rows), retrieved: rows }
    },
  }
}
