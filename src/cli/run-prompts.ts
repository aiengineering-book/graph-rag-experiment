import { readFileSync, writeFileSync } from 'node:fs'
import { createLlm } from '../llm.js'
import type { PromptRow } from '../prompts.js'

// Usage: npm run run-prompts -- prompts/hybrid.jsonl --out answers/hybrid.jsonl
// Sends each prompt's messages to any OpenAI-compatible chat API (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL
// in .env). Needs no database and no embeddings.
const file = process.argv[2]!
const out = process.argv[process.argv.indexOf('--out') + 1] ?? file.replace('prompts/', 'answers/')
const prompts = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l) as PromptRow)
const llm = createLlm()
const answers: { id: string; answer: string }[] = []
let next = 0
const worker = async () => {
  while (next < prompts.length) {
    const p = prompts[next++]!
    answers.push({ id: p.id, answer: (await llm.chat(p.messages, { maxTokens: 64 })).trim() })
  }
}
await Promise.all(Array.from({ length: 4 }, worker))
const order = new Map(prompts.map((p, i) => [p.id, i]))
answers.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
const { mkdirSync } = await import('node:fs')
mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true })
writeFileSync(out, answers.map(a => JSON.stringify(a)).join('\n') + '\n')
console.log(`${out}: ${answers.length} answers`, llm.usage())
