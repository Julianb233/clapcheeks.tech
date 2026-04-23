#!/usr/bin/env npx tsx
/**
 * Security Audit — OWASP Top 10 Check
 * Scans the Clapcheeks codebase for common security vulnerabilities.
 *
 * OWASP Top 10 (2021):
 * A01 - Broken Access Control
 * A02 - Cryptographic Failures
 * A03 - Injection
 * A04 - Insecure Design
 * A05 - Security Misconfiguration
 * A06 - Vulnerable/Outdated Components
 * A07 - Auth Failures
 * A08 - Data Integrity Failures
 * A09 - Security Logging
 * A10 - Server-Side Request Forgery (SSRF)
 *
 * Usage: npx tsx scripts/security-audit.ts
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

interface Finding {
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: string
  title: string
  description: string
  file?: string
  line?: number
  recommendation: string
}

const findings: Finding[] = []
const rootDir = path.resolve(__dirname, '..')

function addFinding(f: Finding) {
  findings.push(f)
}

function searchFiles(pattern: string, extensions: string[] = ['ts', 'tsx', 'js']): string[] {
  const ext = extensions.map(e => `--include="*.${e}"`).join(' ')
  try {
    return execSync(`grep -rn "${pattern}" ${ext} web/ api/ 2>/dev/null || true`, {
      cwd: rootDir,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

// ═══════════════════════════════════════════════════════════
// A01: Broken Access Control
// ═══════════════════════════════════════════════════════════
function checkAccessControl() {
  console.log('\n🔍 A01: Broken Access Control...')

  // Check for missing auth checks in API routes
  const apiRoutes = searchFiles('export async function (GET|POST|PUT|DELETE|PATCH)')
  const authPatterns = ['getUser', 'requireAuth', 'validateAgentToken', 'auth.getUser', 'verifySession']

  for (const line of apiRoutes) {
    const [filePath] = line.split(':')
    if (!filePath) continue

    // Skip public routes and webhook
    if (filePath.includes('webhook') || filePath.includes('callback') || filePath.includes('cron')) continue

    try {
      const content = fs.readFileSync(path.join(rootDir, filePath), 'utf-8')
      const hasAuth = authPatterns.some(p => content.includes(p))

      if (!hasAuth && !filePath.includes('health')) {
        addFinding({
          severity: 'high',
          category: 'A01',
          title: 'API route may lack authentication',
          description: `No auth check found in ${filePath}`,
          file: filePath,
          recommendation: 'Add auth.getUser() or requireAuth middleware to protect this endpoint.',
        })
      }
    } catch { /* file read error */ }
  }

  // Check for direct Supabase admin client usage without auth
  const adminUsage = searchFiles('SUPABASE_SERVICE_ROLE_KEY')
  for (const line of adminUsage) {
    if (line.includes('.env') || line.includes('node_modules')) continue
    addFinding({
      severity: 'medium',
      category: 'A01',
      title: 'Service role key usage',
      description: `Service role key used in ${line.split(':')[0]} — ensure proper auth gating`,
      file: line.split(':')[0],
      recommendation: 'Service role bypasses RLS. Ensure the endpoint has auth middleware.',
    })
  }
}

// ═══════════════════════════════════════════════════════════
// A02: Cryptographic Failures
// ═══════════════════════════════════════════════════════════
function checkCryptography() {
  console.log('🔍 A02: Cryptographic Failures...')

  // Check for hardcoded secrets
  const secretPatterns = [
    'sk_test_', 'sk_live_', 'whsec_', 'password\\s*=\\s*["\']',
    'apiKey\\s*=\\s*["\']', 'secret\\s*=\\s*["\'][^{]',
  ]

  for (const pattern of secretPatterns) {
    const matches = searchFiles(pattern)
    for (const match of matches) {
      if (match.includes('.env') || match.includes('node_modules') || match.includes('.example')) continue
      addFinding({
        severity: 'critical',
        category: 'A02',
        title: 'Potential hardcoded secret',
        description: `Found pattern "${pattern}" in: ${match.split(':').slice(0, 2).join(':')}`,
        file: match.split(':')[0],
        recommendation: 'Move all secrets to environment variables. Never commit secrets to code.',
      })
    }
  }

  // Check for HTTP (not HTTPS) URLs in code
  const httpUrls = searchFiles('http://[^l]')  // exclude localhost
  for (const match of httpUrls) {
    if (match.includes('localhost') || match.includes('127.0.0.1') || match.includes('node_modules')) continue
    addFinding({
      severity: 'medium',
      category: 'A02',
      title: 'Non-HTTPS URL detected',
      description: match.split(':').slice(0, 2).join(':'),
      file: match.split(':')[0],
      recommendation: 'Use HTTPS for all external URLs.',
    })
  }
}

// ═══════════════════════════════════════════════════════════
// A03: Injection
// ═══════════════════════════════════════════════════════════
function checkInjection() {
  console.log('🔍 A03: Injection...')

  // Check for raw SQL queries (SQL injection risk)
  const rawSql = searchFiles('\\$\\{.*\\}.*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)')
  for (const match of rawSql) {
    if (match.includes('node_modules')) continue
    addFinding({
      severity: 'high',
      category: 'A03',
      title: 'Potential SQL injection',
      description: `Template literal in SQL: ${match.split(':').slice(0, 2).join(':')}`,
      file: match.split(':')[0],
      recommendation: 'Use parameterized queries or Supabase client methods instead of raw SQL with interpolation.',
    })
  }

  // Check for eval() or Function() usage
  const evalUsage = searchFiles('\\beval\\(|new Function\\(')
  for (const match of evalUsage) {
    if (match.includes('node_modules')) continue
    addFinding({
      severity: 'critical',
      category: 'A03',
      title: 'eval() or Function() usage',
      description: match.split(':').slice(0, 2).join(':'),
      file: match.split(':')[0],
      recommendation: 'Never use eval() or new Function() — they enable code injection.',
    })
  }

  // Check for dangerouslySetInnerHTML
  const dangerousHtml = searchFiles('dangerouslySetInnerHTML')
  for (const match of dangerousHtml) {
    if (match.includes('node_modules')) continue
    addFinding({
      severity: 'medium',
      category: 'A03',
      title: 'dangerouslySetInnerHTML usage (XSS risk)',
      description: match.split(':').slice(0, 2).join(':'),
      file: match.split(':')[0],
      recommendation: 'Sanitize HTML with DOMPurify before using dangerouslySetInnerHTML.',
    })
  }
}

// ═══════════════════════════════════════════════════════════
// A05: Security Misconfiguration
// ═══════════════════════════════════════════════════════════
function checkSecurityConfig() {
  console.log('🔍 A05: Security Misconfiguration...')

  // Check for helmet() in API
  const serverContent = fs.readFileSync(path.join(rootDir, 'api/server.js'), 'utf-8')
  if (!serverContent.includes('helmet')) {
    addFinding({
      severity: 'high',
      category: 'A05',
      title: 'Missing security headers (Helmet)',
      description: 'API server does not use helmet middleware',
      file: 'api/server.js',
      recommendation: 'Add helmet() middleware for security headers.',
    })
  } else {
    addFinding({
      severity: 'info',
      category: 'A05',
      title: 'Helmet security headers in use',
      description: 'API uses helmet() for security headers — good',
      file: 'api/server.js',
      recommendation: 'No action needed.',
    })
  }

  // Check for CORS configuration
  if (serverContent.includes("cors({ origin: '*'") || serverContent.includes('cors()')) {
    addFinding({
      severity: 'high',
      category: 'A05',
      title: 'Overly permissive CORS',
      description: 'CORS allows all origins',
      file: 'api/server.js',
      recommendation: 'Restrict CORS to specific allowed origins.',
    })
  }

  // Check for body size limits
  if (!serverContent.includes('limit:')) {
    addFinding({
      severity: 'medium',
      category: 'A05',
      title: 'Missing request body size limit',
      description: 'No explicit body size limit found',
      file: 'api/server.js',
      recommendation: 'Set express.json({ limit: "1mb" }) to prevent large payload attacks.',
    })
  }

  // Check if .env files are in .gitignore
  try {
    const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf-8')
    if (!gitignore.includes('.env')) {
      addFinding({
        severity: 'critical',
        category: 'A05',
        title: '.env files not in .gitignore',
        description: 'Environment files may be committed to git',
        recommendation: 'Add .env* to .gitignore immediately.',
      })
    }
  } catch { /* no .gitignore */ }
}

// ═══════════════════════════════════════════════════════════
// A06: Vulnerable/Outdated Components
// ═══════════════════════════════════════════════════════════
function checkDependencies() {
  console.log('🔍 A06: Vulnerable/Outdated Components...')

  // Run npm audit
  for (const dir of ['web', 'api']) {
    try {
      const result = execSync(`cd ${path.join(rootDir, dir)} && npm audit --json 2>/dev/null || true`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      })
      const audit = JSON.parse(result || '{}')
      const vulns = audit.metadata?.vulnerabilities || {}

      if (vulns.critical > 0 || vulns.high > 0) {
        addFinding({
          severity: vulns.critical > 0 ? 'critical' : 'high',
          category: 'A06',
          title: `npm vulnerabilities in ${dir}/`,
          description: `Critical: ${vulns.critical || 0}, High: ${vulns.high || 0}, Medium: ${vulns.moderate || 0}`,
          recommendation: `Run "cd ${dir} && npm audit fix" to resolve known vulnerabilities.`,
        })
      } else {
        addFinding({
          severity: 'info',
          category: 'A06',
          title: `No critical npm vulnerabilities in ${dir}/`,
          description: 'npm audit passed with no critical/high issues',
          recommendation: 'Keep dependencies updated.',
        })
      }
    } catch { /* npm audit not available */ }
  }
}

// ═══════════════════════════════════════════════════════════
// A07: Authentication Failures
// ═══════════════════════════════════════════════════════════
function checkAuth() {
  console.log('🔍 A07: Authentication Failures...')

  // Check for rate limiting on auth endpoints
  const rateLimiterContent = fs.readFileSync(path.join(rootDir, 'api/middleware/rateLimiter.js'), 'utf-8')
  if (!rateLimiterContent.includes('authLimiter')) {
    addFinding({
      severity: 'high',
      category: 'A07',
      title: 'Missing rate limiting on auth endpoints',
      description: 'Auth endpoints lack rate limiting — vulnerable to brute force',
      recommendation: 'Add rate limiting middleware to auth routes.',
    })
  } else {
    addFinding({
      severity: 'info',
      category: 'A07',
      title: 'Auth rate limiting in place',
      description: 'Auth endpoints have rate limiting — good',
      recommendation: 'No action needed.',
    })
  }

  // Check for JWT/session configuration
  const middlewareContent = fs.readFileSync(path.join(rootDir, 'web/lib/supabase/middleware.ts'), 'utf-8')
  if (middlewareContent.includes('publicRoutes')) {
    addFinding({
      severity: 'info',
      category: 'A07',
      title: 'Route protection via middleware',
      description: 'Public route allowlist with redirect for unauthenticated users',
      recommendation: 'Regularly review publicRoutes list to ensure no protected pages are exposed.',
    })
  }
}

// ═══════════════════════════════════════════════════════════
// A09: Security Logging & Monitoring
// ═══════════════════════════════════════════════════════════
function checkLogging() {
  console.log('🔍 A09: Security Logging...')

  // Check for error logging
  const errorHandlerContent = fs.readFileSync(path.join(rootDir, 'api/middleware/errorHandler.js'), 'utf-8')
  if (errorHandlerContent.includes('console.error')) {
    addFinding({
      severity: 'info',
      category: 'A09',
      title: 'Error logging present',
      description: 'Global error handler logs errors',
      recommendation: 'Consider structured logging (JSON) for production observability.',
    })
  }

  // Check if errors expose stack traces in production
  if (errorHandlerContent.includes("process.env.NODE_ENV === 'production'")) {
    addFinding({
      severity: 'info',
      category: 'A09',
      title: 'Production error masking',
      description: 'Error handler masks internal errors in production — good',
      recommendation: 'No action needed.',
    })
  }
}

// ═══════════════════════════════════════════════════════════
// A10: SSRF
// ═══════════════════════════════════════════════════════════
function checkSSRF() {
  console.log('🔍 A10: Server-Side Request Forgery...')

  // Check for user-controlled fetch/axios calls
  const fetchCalls = searchFiles('fetch\\(.*req\\.')
  for (const match of fetchCalls) {
    if (match.includes('node_modules')) continue
    addFinding({
      severity: 'medium',
      category: 'A10',
      title: 'Potential SSRF — user-controlled fetch',
      description: match.split(':').slice(0, 2).join(':'),
      file: match.split(':')[0],
      recommendation: 'Validate and allowlist URLs before making server-side requests.',
    })
  }
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║         Clapcheeks Security Audit (OWASP Top 10)       ║')
  console.log('╚══════════════════════════════════════════════════════════╝')

  checkAccessControl()
  checkCryptography()
  checkInjection()
  checkSecurityConfig()
  checkDependencies()
  checkAuth()
  checkLogging()
  checkSSRF()

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('SECURITY AUDIT SUMMARY')
  console.log('═'.repeat(60))

  const bySeverity = {
    critical: findings.filter(f => f.severity === 'critical'),
    high: findings.filter(f => f.severity === 'high'),
    medium: findings.filter(f => f.severity === 'medium'),
    low: findings.filter(f => f.severity === 'low'),
    info: findings.filter(f => f.severity === 'info'),
  }

  console.log(`\n🔴 Critical: ${bySeverity.critical.length}`)
  for (const f of bySeverity.critical) {
    console.log(`   → [${f.category}] ${f.title}`)
    console.log(`     ${f.description}`)
    console.log(`     Fix: ${f.recommendation}`)
  }

  console.log(`\n🟠 High: ${bySeverity.high.length}`)
  for (const f of bySeverity.high) {
    console.log(`   → [${f.category}] ${f.title}`)
    console.log(`     ${f.description}`)
  }

  console.log(`\n🟡 Medium: ${bySeverity.medium.length}`)
  for (const f of bySeverity.medium) {
    console.log(`   → [${f.category}] ${f.title}`)
  }

  console.log(`\n🟢 Low/Info: ${bySeverity.low.length + bySeverity.info.length}`)

  const hasCritical = bySeverity.critical.length > 0
  console.log('\n' + '═'.repeat(60))
  if (hasCritical) {
    console.log('❌ AUDIT FAILED — Critical vulnerabilities found. Fix before launch.')
    process.exit(1)
  } else if (bySeverity.high.length > 0) {
    console.log('⚠️  AUDIT WARNING — High-severity issues found. Review before launch.')
  } else {
    console.log('✅ AUDIT PASSED — No critical vulnerabilities. Ready for beta.')
  }

  // Write report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      critical: bySeverity.critical.length,
      high: bySeverity.high.length,
      medium: bySeverity.medium.length,
      low: bySeverity.low.length,
      info: bySeverity.info.length,
    },
    passed: !hasCritical,
    findings,
  }

  fs.writeFileSync(
    path.join(rootDir, 'scripts/security-audit-results.json'),
    JSON.stringify(report, null, 2)
  )
  console.log('\nFull report: scripts/security-audit-results.json')
}

main().catch(err => {
  console.error('Security audit failed:', err)
  process.exit(1)
})
