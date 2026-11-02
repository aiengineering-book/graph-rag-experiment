import { readFileSync } from 'node:fs'
import { bootstrapCI, mean, pairedDiff } from '../stats.js'

// Usage: npm run report -- results/hybrid-100.json results/graph-100.json ...
// The first file is the baseline the others are compared with.
type Row = { id: string; em: boolean; f1: number; supportRecall: number }
const files = process.argv.slice(2)
const load = (f: string) => (JSON.parse(readFileSync(f, 'utf8')) as { rows: Row[] }).rows
const base = load(files[0]!)
const pct = (x: number) => `${(x * 100).toFixed(0)}%`
const fmt = (xs: number[], percent = true) => {
  const [lo, hi] = bootstrapCI(xs)
  const f = (x: number) => (percent ? pct(x) : x.toFixed(2))
  return `${f(mean(xs))} [${f(lo)}, ${f(hi)}]`
}

console.log('| run | exact match (95% CI) | F1 (95% CI) | evidence retrieved | EM vs baseline (paired) |')
console.log('|---|---|---|---|---|')
for (const f of files) {
  const rows = load(f)
  const em = rows.map(r => (r.em ? 1 : 0))
  let vs = 'baseline'
  if (f !== files[0]) {
    const d = pairedDiff(em, base.map(r => (r.em ? 1 : 0)))
    vs = `${d.diff >= 0 ? '+' : ''}${(d.diff * 100).toFixed(0)} pts [${(d.ci[0] * 100).toFixed(0)}, ${(d.ci[1] * 100).toFixed(0)}], ${d.aOnly} vs ${d.bOnly}`
  }
  console.log(`| ${f.replace('results/', '').replace('.json', '')} | ${fmt(em)} | ${fmt(rows.map(r => r.f1), false)} | ${pct(mean(rows.map(r => r.supportRecall)))} | ${vs} |`)
}
