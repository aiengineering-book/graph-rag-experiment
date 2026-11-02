import { config } from './config.js'

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>
}

// Local model served by Ollama (https://ollama.com).
export function ollamaEmbedder(url = config.ollamaUrl, model = config.embedModel): Embedder {
  return {
    async embed(texts) {
      const res = await fetch(`${url}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
      })
      if (!res.ok) throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`)
      const json = (await res.json()) as { embeddings: number[][] }
      return json.embeddings
    },
  }
}

// Deterministic stand-in for tests: hashes words into a fixed-size vector,
// so texts that share words end up close together.
export function mockEmbedder(dim = 64): Embedder {
  return {
    async embed(texts) {
      return texts.map(text => {
        const v = new Array<number>(dim).fill(0)
        for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
          let h = 0
          for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0
          v[h % dim] += 1
        }
        const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
        return v.map(x => x / norm)
      })
    },
  }
}
