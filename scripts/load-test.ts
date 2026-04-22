#!/usr/bin/env npx tsx
/**
 * Load Test — Clapcheeks API
 * Tests API endpoints with 100 concurrent requests
 *
 * Usage:
 *   npx tsx scripts/load-test.ts [--base-url URL] [--concurrency N]
 *
 * Environment:
 *   LOAD_TEST_BASE_URL  — API base URL (default: http://localhost:3001)
 *   LOAD_TEST_TOKEN     — Bearer token for authenticated endpoints
 */

const DEFAULT_BASE_URL = process.env.LOAD_TEST_BASE_URL || 'http://localhost:3001'
const DEFAULT_CONCURRENCY = 100

interface TestResult {
  endpoint: string
  method: string
  concurrency: number
  totalRequests: number
  successCount: number
  failCount: number
  avgLatencyMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  maxMs: number
  minMs: number
  requestsPerSecond: number
  errors: Record<number, number>  // status code -> count
}

interface RequestResult {
  status: number
  latencyMs: number
  ok: boolean
}

async function makeRequest(
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
  body?: string
): Promise<RequestResult> {
  const start = performance.now()
  try {
    const opts: RequestInit = { method, headers }
    if (body) opts.body = body
    const res = await fetch(url, opts)
    const latencyMs = Math.round(performance.now() - start)
    return { status: res.status, latencyMs, ok: res.ok }
  } catch {
    return { status: 0, latencyMs: Math.round(performance.now() - start), ok: false }
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

async function runLoadTest(
  endpoint: string,
  method: string = 'GET',
  concurrency: number = DEFAULT_CONCURRENCY,
  headers: Record<string, string> = {},
  body?: string
): Promise<TestResult> {
  const url = `${DEFAULT_BASE_URL}${endpoint}`
  const totalRequests = concurrency

  console.log(`\n🔄 Testing ${method} ${endpoint} — ${concurrency} concurrent requests...`)

  const startTime = performance.now()
  const promises = Array.from({ length: totalRequests }, () =>
    makeRequest(url, method, headers, body)
  )
  const results = await Promise.all(promises)
  const totalTimeMs = performance.now() - startTime

  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b)
  const successes = results.filter(r => r.ok)
  const failures = results.filter(r => !r.ok)

  const errors: Record<number, number> = {}
  for (const r of failures) {
    errors[r.status] = (errors[r.status] || 0) + 1
  }

  const result: TestResult = {
    endpoint,
    method,
    concurrency,
    totalRequests,
    successCount: successes.length,
    failCount: failures.length,
    avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: latencies[latencies.length - 1],
    minMs: latencies[0],
    requestsPerSecond: Math.round((totalRequests / totalTimeMs) * 1000),
    errors,
  }

  // Print results
  const status = result.failCount === 0 ? '✅ PASS' : result.failCount <= 5 ? '⚠️  WARN' : '❌ FAIL'
  console.log(`${status} ${method} ${endpoint}`)
  console.log(`  Requests:    ${result.successCount}/${result.totalRequests} success`)
  console.log(`  Latency:     avg=${result.avgLatencyMs}ms p50=${result.p50Ms}ms p95=${result.p95Ms}ms p99=${result.p99Ms}ms max=${result.maxMs}ms`)
  console.log(`  Throughput:  ${result.requestsPerSecond} req/s`)
  if (Object.keys(result.errors).length > 0) {
    console.log(`  Errors:      ${JSON.stringify(result.errors)}`)
  }

  return result
}

async function main() {
  const args = process.argv.slice(2)
  const concurrency = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '', 10) || DEFAULT_CONCURRENCY
  const token = process.env.LOAD_TEST_TOKEN || ''

  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║           Clapcheeks API Load Test Suite                ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`Base URL:    ${DEFAULT_BASE_URL}`)
  console.log(`Concurrency: ${concurrency}`)
  console.log(`Auth:        ${token ? 'Bearer token provided' : 'No auth (public endpoints only)'}`)

  const results: TestResult[] = []

  // 1. Health endpoint (should handle any load)
  results.push(await runLoadTest('/health', 'GET', concurrency))

  // 2. Public API — various endpoints
  const authHeaders: Record<string, string> = token
    ? { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }

  // 3. Auth-protected endpoints (if token provided)
  if (token) {
    results.push(await runLoadTest('/analytics/summary', 'GET', concurrency, authHeaders))
    results.push(await runLoadTest('/agent/status', 'GET', concurrency, authHeaders))
  }

  // 4. Rate-limited endpoints (expect some 429s)
  results.push(await runLoadTest('/health', 'GET', concurrency * 2))

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('LOAD TEST SUMMARY')
  console.log('═'.repeat(60))

  let allPassed = true
  for (const r of results) {
    const status = r.failCount === 0 ? '✅' : r.failCount <= 5 ? '⚠️ ' : '❌'
    if (r.failCount > 5) allPassed = false
    console.log(`${status} ${r.method.padEnd(6)} ${r.endpoint.padEnd(30)} ${r.successCount}/${r.totalRequests} ok  avg=${r.avgLatencyMs}ms p95=${r.p95Ms}ms`)
  }

  console.log('═'.repeat(60))

  if (allPassed) {
    console.log('✅ All load tests passed — API handles 100 concurrent connections')
  } else {
    console.log('❌ Some load tests failed — review results above')
    process.exit(1)
  }

  // Write results to JSON for CI integration
  const outputPath = './scripts/load-test-results.json'
  const fs = await import('fs')
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    baseUrl: DEFAULT_BASE_URL,
    concurrency,
    results,
    passed: allPassed,
  }, null, 2))
  console.log(`\nResults written to ${outputPath}`)
}

main().catch(err => {
  console.error('Load test failed:', err)
  process.exit(1)
})
