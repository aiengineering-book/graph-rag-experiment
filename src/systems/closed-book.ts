import { answerWith } from '../answer.js'
import type { Llm } from '../llm.js'
import type { RagSystem } from './types.js'

// Control: no retrieval. Shows how much the model already knows.
export function closedBook(llm: Llm): RagSystem {
  return {
    name: 'closed-book',
    async answer(question) {
      return { answer: await answerWith(llm, question, []), retrieved: [] }
    },
  }
}
