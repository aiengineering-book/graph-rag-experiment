import type { Passage } from './answer.js'

// Normalize as in standard QA scoring: lowercase, drop punctuation and articles.
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(a|an|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function exactMatch(pred: string, golds: string[]): boolean {
  const p = normalize(pred)
  return golds.some(g => normalize(g) === p)
}

export function tokenF1(pred: string, golds: string[]): number {
  const p = normalize(pred).split(' ').filter(Boolean)
  let best = 0
  for (const g of golds) {
    const gt = normalize(g).split(' ').filter(Boolean)
    const counts = new Map<string, number>()
    for (const t of gt) counts.set(t, (counts.get(t) ?? 0) + 1)
    let overlap = 0
    for (const t of p) {
      const c = counts.get(t) ?? 0
      if (c > 0) {
        overlap++
        counts.set(t, c - 1)
      }
    }
    if (overlap === 0) continue
    const precision = overlap / p.length
    const recall = overlap / gt.length
    best = Math.max(best, (2 * precision * recall) / (precision + recall))
  }
  return best
}

// Share of the question's supporting passages that were put in front of the model.
export function supportRecall(retrieved: Passage[], supporting: Passage[]): number {
  if (supporting.length === 0) return 1
  const key = (p: Passage) => `${p.title}\n${p.body}`
  const got = new Set(retrieved.map(key))
  return supporting.filter(p => got.has(key(p))).length / supporting.length
}
