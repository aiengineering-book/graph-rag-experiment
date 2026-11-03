// BM25 over the passages, held in memory (1,847 passages is small). Parameters
// follow the book's Chapter 11 implementation: k1 = 1.5, b = 0.75 and
// idf = ln((N - df + 0.5) / (df + 0.5) + 1).
const STOPWORDS = new Set(
  ('a an the is are was were be been being have has had do does did will would could should may might shall can ' +
    'to of in on at by for with from as into about than then that this these those it its and or but not no ' +
    'who whom whose which what when where why how')
    .split(' '),
)

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(t => !STOPWORDS.has(t))
}

export type Doc = { id: number; title: string; body: string }

export class Bm25Index {
  private readonly tf = new Map<number, Map<string, number>>()
  private readonly len = new Map<number, number>()
  private readonly df = new Map<string, number>()
  private avgLen = 0
  readonly docs = new Map<number, Doc>()

  constructor(
    docs: Doc[],
    private readonly k1 = 1.5,
    private readonly b = 0.75,
  ) {
    let total = 0
    for (const d of docs) {
      const tokens = tokenize(`${d.title} ${d.body}`)
      const counts = new Map<string, number>()
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      this.tf.set(d.id, counts)
      this.len.set(d.id, tokens.length)
      this.docs.set(d.id, d)
      total += tokens.length
    }
    this.avgLen = docs.length ? total / docs.length : 0
  }

  search(query: string, limit: number): Doc[] {
    const terms = [...new Set(tokenize(query))]
    const n = this.docs.size
    const scored: { doc: Doc; score: number }[] = []
    for (const [id, counts] of this.tf) {
      let score = 0
      for (const t of terms) {
        const f = counts.get(t)
        if (!f) continue
        const df = this.df.get(t)!
        const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1)
        const norm = 1 - this.b + (this.b * this.len.get(id)!) / this.avgLen
        score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * norm))
      }
      if (score > 0) scored.push({ doc: this.docs.get(id)!, score })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.doc)
  }
}
