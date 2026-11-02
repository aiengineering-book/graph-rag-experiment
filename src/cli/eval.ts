import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { config } from '../config.js'
import { openPostgres } from '../db.js'
import { ollamaEmbedder } from '../embed.js'
import { evaluate, type Question } from '../evaluate.js'
import { createLlm } from '../llm.js'
import { closedBook } from '../systems/closed-book.js'
import { hybrid } from '../systems/hybrid.js'
import type { RagSystem } from '../systems/types.js'

// Usage: npm run eval -- --system closed-book|hybrid [--limit 10]
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const which = arg('system') ?? 'hybrid'
const limit = Number(arg('limit') ?? Infinity)
const questions = (JSON.parse(readFileSync('data/questions.json', 'utf8')) as Question[]).slice(0, limit)

const llm = createLlm()
const db = which === 'closed-book' ? undefined : openPostgres(config.databaseUrl)
const systems: Record<string, () => RagSystem> = {
  'closed-book': () => closedBook(llm),
  hybrid: () => hybrid(db!, ollamaEmbedder(), llm),
}
if (!systems[which]) throw new Error(`unknown system "${which}"; use ${Object.keys(systems).join(' or ')}`)

const report = await evaluate(systems[which]!(), llm, questions, (row, done, total) => {
  console.log(`${done}/${total} ${row.em ? 'EM ' : '   '} ${row.question.slice(0, 60)} -> ${row.predicted.slice(0, 40)}`)
})

mkdirSync('results', { recursive: true })
const file = `results/${which}-${questions.length}.json`
writeFileSync(file, JSON.stringify(report, null, 1))
const { rows: _rows, ...summary } = report
console.log('\n' + JSON.stringify(summary, null, 1))
console.log(`per-question results: ${file}`)
await db?.close()
