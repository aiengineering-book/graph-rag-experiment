import type { Passage } from '../answer.js'
import type { Llm } from '../llm.js'

export type Relation = { source: string; relation: string; target: string }
export type Extraction = { entities: string[]; relations: Relation[]; parsed: boolean }

export const EXTRACT_SYSTEM =
  'You extract a knowledge graph from a passage. Reply with JSON only, in this shape: ' +
  '{"entities": ["name", ...], "relations": [{"source": "name", "relation": "short verb phrase", "target": "name"}]}. ' +
  'Entities are named things (people, places, works, organizations, dates, events). ' +
  'Use the full name as written in the passage. Relations must use names from the entity list. ' +
  'Include the passage title as an entity when the passage is about it.'

// Models sometimes wrap JSON in a code fence or add text around it.
export function parseExtraction(text: string): Extraction {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as { entities?: unknown; relations?: unknown }
    const entities = (Array.isArray(raw.entities) ? raw.entities : [])
      .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
      .map(e => e.trim())
    const relations = (Array.isArray(raw.relations) ? raw.relations : [])
      .filter(
        (r): r is Relation =>
          !!r && typeof r.source === 'string' && typeof r.relation === 'string' && typeof r.target === 'string',
      )
      .map(r => ({ source: r.source.trim(), relation: r.relation.trim(), target: r.target.trim() }))
    return { entities, relations, parsed: true }
  } catch {
    return { entities: [], relations: [], parsed: false }
  }
}

export async function extractPassage(llm: Llm, p: Passage): Promise<Extraction> {
  const text = await llm.chat(
    [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: `Title: ${p.title}\n\n${p.body}` },
    ],
    { maxTokens: 700, json: true },
  )
  return parseExtraction(text)
}
