// Bootstrap confidence intervals, seeded so the same results give the same intervals.
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

// 95% interval for the mean of `values`, by resampling questions with replacement.
export function bootstrapCI(values: number[], resamples = 10000, seed = 1): [number, number] {
  const rand = rng(seed)
  const means: number[] = []
  for (let r = 0; r < resamples; r++) {
    let sum = 0
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(rand() * values.length)]!
    means.push(sum / values.length)
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(resamples * 0.025)]!, means[Math.floor(resamples * 0.975)]!]
}

// Paired comparison: the same questions scored under two systems.
export function pairedDiff(a: number[], b: number[], resamples = 10000, seed = 1) {
  const diffs = a.map((x, i) => x - b[i]!)
  return {
    diff: mean(diffs),
    ci: bootstrapCI(diffs, resamples, seed),
    aOnly: diffs.filter(d => d > 0).length,
    bOnly: diffs.filter(d => d < 0).length,
  }
}

export { mean }
