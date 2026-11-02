import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootstrapCI, pairedDiff } from '../src/stats.js'

test('bootstrap interval brackets the mean and is reproducible', () => {
  const v = [...Array(30).fill(1), ...Array(70).fill(0)]
  const [lo, hi] = bootstrapCI(v)
  assert.ok(lo < 0.3 && hi > 0.3 && hi - lo < 0.25)
  assert.deepEqual(bootstrapCI(v), [lo, hi])
})

test('paired difference counts who wins on which question', () => {
  const a = [1, 1, 0, 0, 1]
  const b = [1, 0, 0, 1, 0]
  const d = pairedDiff(a, b)
  assert.equal(d.aOnly, 2)
  assert.equal(d.bOnly, 1)
  assert.ok(Math.abs(d.diff - 0.2) < 1e-9)
})
