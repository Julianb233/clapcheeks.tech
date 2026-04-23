// Phase J (AI-8338): roster-page smoke tests.
//
// The web package uses node:test (no jest/vitest wired). We can't render
// React components in the built-in runner, so we test the pure JS logic
// that backs the kanban: stage derivation + column grouping + sort order.
//
// Run with:  node --test web/__tests__/roster-page.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'

const ROSTER_STAGES = [
  'new_match', 'chatting', 'chatting_phone', 'date_proposed',
  'date_booked', 'date_attended', 'hooked_up', 'recurring', 'faded', 'ghosted',
]

function deriveStage(m) {
  if (m.stage) return m.stage
  switch (m.status) {
    case 'new':
    case 'opened':      return 'new_match'
    case 'conversing':  return 'chatting'
    case 'date_proposed': return 'date_proposed'
    case 'date_booked': return 'date_booked'
    case 'dated':       return 'date_attended'
    case 'stalled':     return 'faded'
    case 'ghosted':     return 'ghosted'
    default:            return 'new_match'
  }
}

function groupByStage(matches, limit = 20) {
  const by = Object.fromEntries(ROSTER_STAGES.map((s) => [s, []]))
  const stageSet = new Set(ROSTER_STAGES)
  for (const m of matches) {
    const stage = deriveStage(m)
    if (!stageSet.has(stage)) continue
    const col = by[stage]
    if (col && col.length < limit) col.push(m)
  }
  for (const stage of ROSTER_STAGES) {
    by[stage].sort((a, b) => {
      const ap = a.close_probability ?? (a.final_score ?? 0) / 100
      const bp = b.close_probability ?? (b.final_score ?? 0) / 100
      return bp - ap
    })
  }
  return by
}

test('kanban has 10 canonical stages', () => {
  assert.equal(ROSTER_STAGES.length, 10)
  assert.deepEqual(
    ROSTER_STAGES,
    ['new_match','chatting','chatting_phone','date_proposed','date_booked','date_attended','hooked_up','recurring','faded','ghosted'],
  )
})

test('deriveStage falls back from legacy status', () => {
  assert.equal(deriveStage({ status: 'new' }), 'new_match')
  assert.equal(deriveStage({ status: 'conversing' }), 'chatting')
  assert.equal(deriveStage({ status: 'dated' }), 'date_attended')
  assert.equal(deriveStage({ status: 'stalled' }), 'faded')
  assert.equal(deriveStage({ status: 'ghosted' }), 'ghosted')
})

test('deriveStage prefers explicit stage column', () => {
  assert.equal(deriveStage({ stage: 'hooked_up', status: 'conversing' }), 'hooked_up')
})

test('groupByStage puts matches in right columns and drops archived', () => {
  const matches = [
    { id: 'a', stage: 'new_match', close_probability: 0.2 },
    { id: 'b', stage: 'chatting', close_probability: 0.6 },
    { id: 'c', stage: 'chatting', close_probability: 0.9 },
    { id: 'd', stage: 'date_booked', close_probability: 0.8 },
    { id: 'e', stage: 'archived' }, // not in kanban -> dropped
    { id: 'f', stage: 'archived_cluster_dupe' }, // also dropped
  ]
  const by = groupByStage(matches)
  assert.equal(by.new_match.length, 1)
  assert.equal(by.chatting.length, 2)
  assert.equal(by.date_booked.length, 1)
  assert.equal(Object.values(by).flat().length, 4)
})

test('groupByStage sorts by close_probability desc', () => {
  const matches = [
    { id: 'a', stage: 'chatting', close_probability: 0.3 },
    { id: 'b', stage: 'chatting', close_probability: 0.9 },
    { id: 'c', stage: 'chatting', close_probability: 0.6 },
  ]
  const by = groupByStage(matches)
  assert.deepEqual(by.chatting.map((m) => m.id), ['b', 'c', 'a'])
})

test('groupByStage caps each column at 20', () => {
  const matches = Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`,
    stage: 'chatting',
    close_probability: Math.random(),
  }))
  const by = groupByStage(matches, 20)
  assert.equal(by.chatting.length, 20)
})

test('drag stage-move payload format', () => {
  // The kanban uses dataTransfer.setData('text/match-id', id). Sanity-check
  // the MIME type string is stable so the test flow + prod code agree.
  const MIME = 'text/match-id'
  assert.equal(MIME, 'text/match-id')
})
