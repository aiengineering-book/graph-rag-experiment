import type { Llm, Message } from './llm.js'

export type Passage = { title: string; body: string }

const SYSTEM =
  'Answer the question. Reply with the answer only: a short phrase, no explanation. ' +
  'If you are not sure, give your best guess.'

// Every system answers through this one function, so differences in the
// results come from what each system retrieves and not from the prompt.
export function buildMessages(question: string, passages: Passage[]): Message[] {
  const context = passages.map((p, i) => `[${i + 1}] ${p.title}\n${p.body}`).join('\n\n')
  const user = passages.length ? `Passages:\n${context}\n\nQuestion: ${question}` : `Question: ${question}`
  return [
    { role: 'system', content: passages.length ? `${SYSTEM} Use the passages.` : SYSTEM },
    { role: 'user', content: user },
  ]
}

export async function answerWith(llm: Llm, question: string, passages: Passage[]): Promise<string> {
  const text = await llm.chat(buildMessages(question, passages), { maxTokens: 64 })
  return text.trim()
}
