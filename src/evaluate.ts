import type { Passage } from './answer.js'
import { BudgetExceeded, type Llm } from './llm.js'
import { exactMatch, supportRecall, tokenF1 } from './score.js'
import type { RagSystem } from './systems/types.js'

export type Question = {
  id: string
  question: string
  answer: string
  answer_aliases: string[]
  supporting: { title: string; text: string }[]
}

export type Row = {
  id: string
  question: string
  gold: string
  predicted: string
  em: boolean
  f1: number
  supportRecall: number
  retrieved: string[]
  ms: number
}

export type Report = {
  system: string
  questions: number
  em: number
  f1: number
  supportRecall: number
  usage: ReturnType<Llm['usage']>
  stoppedEarly: boolean
  rows: Row[]
}

export async function evaluate(
  system: RagSystem,
  llm: Llm,
  questions: Question[],
  onRow: (row: Row, done: number, total: number) => void = () => {},
): Promise<Report> {
  const rows: Row[] = []
  let stoppedEarly = false
  for (const q of questions) {
    const started = Date.now()
    try {
      const { answer, retrieved } = await system.answer(q.question)
      const golds = [q.answer, ...q.answer_aliases]
      const supporting: Passage[] = q.supporting.map(p => ({ title: p.title, body: p.text }))
      const row: Row = {
        id: q.id,
        question: q.question,
        gold: q.answer,
        predicted: answer,
        em: exactMatch(answer, golds),
        f1: tokenF1(answer, golds),
        supportRecall: supportRecall(retrieved, supporting),
        retrieved: retrieved.map(p => p.title),
        ms: Date.now() - started,
      }
      rows.push(row)
      onRow(row, rows.length, questions.length)
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        stoppedEarly = true
        break
      }
      throw err
    }
  }
  const mean = (f: (r: Row) => number) => (rows.length ? rows.reduce((s, r) => s + f(r), 0) / rows.length : 0)
  return {
    system: system.name,
    questions: rows.length,
    em: mean(r => (r.em ? 1 : 0)),
    f1: mean(r => r.f1),
    supportRecall: mean(r => r.supportRecall),
    usage: llm.usage(),
    stoppedEarly,
    rows,
  }
}
