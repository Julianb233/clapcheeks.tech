#!/usr/bin/env node
// Quick test harness for the Instagram extractor. Run via:
//   npx tsx web/scripts/test-instagram-extractor.mjs
// or transpile to JS first.
import { extractInstagramHandles, findHandleInMessages } from '../lib/instagram-extractor.ts'

const cases = [
  // [input, expectedHandle | null, label]
  ['my ig is sarahlovesyoga', 'sarahlovesyoga', 'phrase: my ig is X'],
  ['its sarahlovesyoga on ig', 'sarahlovesyoga', 'trailing: X on ig'],
  ['@sarahlovesyoga btw', 'sarahlovesyoga', 'bare @ with ig context'],
  ['follow me on instagram @sarahlovesyoga', 'sarahlovesyoga', 'find me'],
  ['https://instagram.com/sarahlovesyoga/', 'sarahlovesyoga', 'url'],
  ['ig: sarahlovesyoga', 'sarahlovesyoga', 'colon'],
  ['Instagram is @sarah.loves.yoga', 'sarah.loves.yoga', 'dotted handle'],
  ['yeah lol', null, 'no handle'],
  ['follow me on Instagram im on tiktok too', null, 'trailing without handle'],
  ['my email is sarah@gmail.com', null, 'email is not handle'],
  ['its lit on ig', null, 'lit is false-positive (no @)'],
  ['ill follow you', null, 'follow without me/handle'],
  ['her name is sarah', null, 'name is not handle'],
]

let pass = 0, fail = 0
for (const [text, expected, label] of cases) {
  const found = extractInstagramHandles(text)
  const got = found[0]?.handle ?? null
  const ok = got === expected
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(40)} | "${text}" → ${got ?? 'null'} (expected ${expected ?? 'null'})`)
  if (ok) pass++; else fail++
}
console.log(`\n${pass} pass · ${fail} fail`)

console.log()
console.log('=== conversation-level context tests ===')
const convoCases = [
  [
    [
      { from: 'him', text: "what's your insta?" },
      { from: 'her', text: '@sarahlovesyoga' },
    ],
    'sarahlovesyoga',
    'context: he asked, she replied with bare @',
  ],
  [
    [
      { from: 'her', text: '@sarahlovesyoga btw' },
    ],
    null,
    'no context: bare @ alone, no IG word',
  ],
  [
    [
      { from: 'her', text: 'check my ig: sarahlovesyoga' },
    ],
    'sarahlovesyoga',
    'self-context phrase',
  ],
  [
    [
      { from: 'him', text: 'lit night' },
      { from: 'her', text: 'its lit on ig' },
    ],
    null,
    'lit on ig is not a handle',
  ],
]
let cpass = 0, cfail = 0
for (const [messages, expected, label] of convoCases) {
  const got = findHandleInMessages(messages)?.handle ?? null
  const ok = got === expected
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(50)} → ${got ?? 'null'} (expected ${expected ?? 'null'})`)
  if (ok) cpass++; else cfail++
}
console.log(`\nconversation: ${cpass} pass · ${cfail} fail`)
process.exit(fail + cfail > 0 ? 1 : 0)
