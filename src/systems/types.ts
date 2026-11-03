import type { Passage } from '../answer.js'

export interface RagSystem {
  name: string
  // The passages the system puts in front of the model (no answering LLM call).
  retrieve(question: string): Promise<Passage[]>
  // Retrieves, then answers.
  answer(question: string): Promise<{ answer: string; retrieved: Passage[] }>
}
