import { buildMessages, type Passage } from './answer.js'
import type { Message } from './llm.js'
import type { Question, Report, Row } from './evaluate.js'
import { exactMatch, supportRecall, tokenF1 } from './score.js'
import type { RagSystem } from './systems/types.js'

// One line of a prompts file: the exact messages a system would send to the
// model, so any provider (or a batch API) can answer them later.
export type PromptRow = {
  id: string
  system: string
  question: string
  gold: string
  aliases: string[]
  messages: Message[]
  retrieved: Passage[]
  supporting: Passage[]
}
export type ExternalAnswer = { id: string; answer: string }

export async function buildPromptRows(system: RagSystem, questions: Question[]): Promise<PromptRow[]> {
  const rows: PromptRow[] = []
  for (const q of questions) {
    const retrieved = await system.retrieve(q.question)
    rows.push({
      id: q.id,
      system: system.name,
      question: q.question,
      gold: q.answer,
      aliases: q.answer_aliases,
      messages: buildMessages(q.question, retrieved),
      retrieved,
      supporting: q.supporting.map(p => ({ title: p.title, body: p.text })),
    })
  }
  return rows
}

// Scores answers produced elsewhere with the same metrics as `evaluate`.
export function scoreAnswers(prompts: PromptRow[], answers: ExternalAnswer[]): Report {
  const byId = new Map(answers.map(a => [a.id, a.answer.trim()]))
  const rows: Row[] = []
  for (const p of prompts) {
    const predicted = byId.get(p.id)
    if (predicted === undefined) continue
    const golds = [p.gold, ...p.aliases]
    rows.push({
      id: p.id,
      question: p.question,
      gold: p.gold,
      predicted,
      em: exactMatch(predicted, golds),
      f1: tokenF1(predicted, golds),
      supportRecall: supportRecall(p.retrieved, p.supporting),
      retrieved: p.retrieved.map(r => r.title),
      ms: 0,
    })
  }
  const mean = (f: (r: Row) => number) => (rows.length ? rows.reduce((s, r) => s + f(r), 0) / rows.length : 0)
  return {
    system: prompts[0]?.system ?? 'unknown',
    questions: rows.length,
    em: mean(r => (r.em ? 1 : 0)),
    f1: mean(r => r.f1),
    supportRecall: mean(r => r.supportRecall),
    usage: { calls: 0, promptTokens: 0, completionTokens: 0 },
    stoppedEarly: rows.length < prompts.length,
    rows,
  }
}
