import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('lib/conversation-ai/generate-replies.ts', 'utf8')

test('local fallback drafts use short Julian-style specific replies', () => {
  assert.match(source, /profileContext\?: unknown/)
  assert.match(source, /what was the best part of the hike\?/)
  assert.match(source, /that sounds sick/)
  assert.match(source, /we should compare hike stories over drinks this week/)
  assert.doesNotMatch(source, /tell me more about \\$\\{hook/)
})
