import { config } from './config.js'

export type Message = { role: 'system' | 'user' | 'assistant'; content: string }
export type Usage = { calls: number; promptTokens: number; completionTokens: number }

export interface Llm {
  chat(messages: Message[], opts?: { maxTokens?: number; json?: boolean }): Promise<string>
  usage(): Usage
}

export class BudgetExceeded extends Error {}

// Chat Completions client (any OpenAI-compatible API). Every call is counted,
// and the client throws once prompt + completion tokens reach the budget, so a
// bug in a loop cannot run up the bill.
export function createLlm(budget = config.tokenBudget): Llm {
  const used: Usage = { calls: 0, promptTokens: 0, completionTokens: 0 }
  return {
    usage: () => ({ ...used }),
    async chat(messages, opts = {}) {
      if (used.promptTokens + used.completionTokens >= budget) {
        throw new BudgetExceeded(`token budget ${budget} reached`)
      }
      const res = await fetch(`${config.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.llmApiKey}` },
        body: JSON.stringify({
          model: config.llmModel,
          messages,
          temperature: 0,
          max_tokens: opts.maxTokens ?? 1024,
          thinking: { type: 'disabled' },
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      })
      if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${await res.text()}`)
      const json = (await res.json()) as {
        choices: { message: { content: string } }[]
        usage?: { prompt_tokens: number; completion_tokens: number }
      }
      used.calls += 1
      used.promptTokens += json.usage?.prompt_tokens ?? 0
      used.completionTokens += json.usage?.completion_tokens ?? 0
      return json.choices[0]?.message.content ?? ''
    },
  }
}

// Test stand-in: answers from a handler and counts rough tokens (chars / 4),
// enforcing the same budget as the real client.
export function mockLlm(handler: (messages: Message[]) => string, budget = Infinity): Llm {
  const used: Usage = { calls: 0, promptTokens: 0, completionTokens: 0 }
  return {
    usage: () => ({ ...used }),
    async chat(messages) {
      if (used.promptTokens + used.completionTokens >= budget) {
        throw new BudgetExceeded(`token budget ${budget} reached`)
      }
      const text = handler(messages)
      used.calls += 1
      used.promptTokens += Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4)
      used.completionTokens += Math.ceil(text.length / 4)
      return text
    },
  }
}
