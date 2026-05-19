import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const files = {
  provider: readFileSync('components/pwa/pwa-provider.tsx', 'utf8'),
  sw: readFileSync('public/sw.js', 'utf8'),
}

test('production PWA provider retires stale service workers by default', () => {
  assert.match(files.provider, /unregisterStaleWorkers/)
  assert.match(files.provider, /NEXT_PUBLIC_ENABLE_PWA_SW === '1'/)
  assert.match(files.provider, /registration\.unregister\(\)/)
  assert.match(files.provider, /caches\.delete\(key\)/)
})

test('public sw.js is a kill switch for previously installed workers', () => {
  assert.match(files.sw, /skipWaiting/)
  assert.match(files.sw, /caches\.keys/)
  assert.match(files.sw, /self\.registration\.unregister/)
  assert.match(files.sw, /client\.navigate\(client\.url\)/)
})
