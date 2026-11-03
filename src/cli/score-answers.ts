import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { scoreAnswers, type ExternalAnswer, type PromptRow } from '../prompts.js'

// Usage: npm run score-answers -- prompts/hybrid.jsonl answers/hybrid.jsonl [--out results/mine-hybrid-100.json]
// Answers are JSON lines: {"id": "...", "answer": "..."}. The output works with `npm run report`.
const lines = (f: string) => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l))
const prompts = lines(process.argv[2]!) as PromptRow[]
const answers = lines(process.argv[3]!) as ExternalAnswer[]
const report = scoreAnswers(prompts, answers)
const { rows: _rows, ...summary } = report
console.log(JSON.stringify(summary, null, 1))
const i = process.argv.indexOf('--out')
if (i >= 0) {
  mkdirSync('results', { recursive: true })
  writeFileSync(process.argv[i + 1]!, JSON.stringify(report, null, 1))
  console.log(`per-question results: ${process.argv[i + 1]}`)
}
