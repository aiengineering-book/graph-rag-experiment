import type { Passage } from '../answer.js'

export interface RagSystem {
  name: string
  // Returns the answer and the passages the system put in front of the model.
  answer(question: string): Promise<{ answer: string; retrieved: Passage[] }>
}
