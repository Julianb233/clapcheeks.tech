// AI-8762: Tiny parser for `when` expressions used by drip rules.
//
// Supports the strict subset the visual editor can round-trip:
//   <term> <op> <value> [(and|or) <term> <op> <value>]*
//
// Operators: == != < <= > >= in `not in`
// Parentheses are tolerated only when wrapping the whole expression (we
// strip them) — anything more nested falls back to "raw expression" mode.
// Python's normal precedence (`and` binds tighter than `or`) is preserved
// on serialize by wrapping each AND-run in parens.

import {
  TERM_DEFS,
  type Condition,
  type Connector,
  type Operator,
  type TermName,
  type WhenExpr,
  OPS_BOOL,
  OPS_ENUM,
  OPS_NUMERIC,
} from './types'

const ALL_OPS = ['==', '!=', '<=', '>=', '<', '>'] as const

export class WhenParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WhenParseError'
  }
}

// Strip wrapping parens that wrap the *entire* expression.
function stripWrapParens(s: string): string {
  let cur = s.trim()
  // Repeatedly peel a leading `(` matched by trailing `)` covering everything.
  while (cur.startsWith('(') && cur.endsWith(')')) {
    let depth = 0
    let wraps = true
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i]
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0 && i < cur.length - 1) {
          wraps = false
          break
        }
      }
    }
    if (wraps) cur = cur.slice(1, -1).trim()
    else break
  }
  return cur
}

// Split on AND/OR connectors at the TOP LEVEL only (don't break inside
// parens or quoted strings). Returns alternating segments and connectors.
type Segment =
  | { type: 'cond'; raw: string }
  | { type: 'conn'; value: Connector }

function tokenizeTopLevel(input: string): Segment[] {
  const out: Segment[] = []
  let depth = 0
  let inStr: '"' | "'" | null = null
  let cur = ''
  let i = 0

  const lower = input
  while (i < lower.length) {
    const c = lower[i]
    if (inStr) {
      cur += c
      if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inStr = c
      cur += c
      i++
      continue
    }
    if (c === '(') {
      depth++
      cur += c
      i++
      continue
    }
    if (c === ')') {
      depth--
      cur += c
      i++
      continue
    }
    if (depth === 0) {
      // Look for ` and ` / ` or ` (with a leading space to avoid matching
      // identifiers like `andy` or operators like `not in`).
      const rest = lower.slice(i).toLowerCase()
      if (rest.startsWith(' and ') || rest.startsWith('\tand\t') || rest.startsWith('\nand\n') || rest.startsWith(' and\n') || rest.startsWith('\nand ')) {
        out.push({ type: 'cond', raw: cur.trim() })
        out.push({ type: 'conn', value: 'and' })
        cur = ''
        // Skip the literal " and " (5 chars) or its variants — match length.
        const matchLen = rest.match(/^(\s+and\s+)/i)?.[1].length ?? 5
        i += matchLen
        continue
      }
      if (rest.startsWith(' or ') || rest.startsWith('\tor\t') || rest.startsWith('\nor\n') || rest.startsWith(' or\n') || rest.startsWith('\nor ')) {
        out.push({ type: 'cond', raw: cur.trim() })
        out.push({ type: 'conn', value: 'or' })
        cur = ''
        const matchLen = rest.match(/^(\s+or\s+)/i)?.[1].length ?? 4
        i += matchLen
        continue
      }
    }
    cur += c
    i++
  }
  if (cur.trim().length > 0) out.push({ type: 'cond', raw: cur.trim() })
  return out
}

function parseCondition(raw: string): Condition {
  let s = stripWrapParens(raw)

  // Try `not in` first (multi-word op).
  const notInMatch = s.match(/^(\w+)\s+not\s+in\s+(.+)$/i)
  if (notInMatch) {
    const term = notInMatch[1] as TermName
    if (!(term in TERM_DEFS)) {
      throw new WhenParseError(`unknown term \`${term}\``)
    }
    return { term, op: 'not in', value: parseListValue(notInMatch[2]) }
  }
  // Then `in`.
  const inMatch = s.match(/^(\w+)\s+in\s+(.+)$/i)
  if (inMatch) {
    const term = inMatch[1] as TermName
    if (!(term in TERM_DEFS)) {
      throw new WhenParseError(`unknown term \`${term}\``)
    }
    return { term, op: 'in', value: parseListValue(inMatch[2]) }
  }
  // Standard binary operator.
  for (const op of ALL_OPS) {
    const idx = s.indexOf(op)
    if (idx >= 0) {
      const left = s.slice(0, idx).trim()
      const right = s.slice(idx + op.length).trim()
      if (!left || !right) continue
      // ALL_OPS is sorted longest-first (`<=` before `<`), so this check
      // is just a paranoia backstop against single-char ops bleeding into
      // a multi-char neighbour (e.g. matching `<` inside `<=`).
      const after = s[idx + op.length] ?? ''
      if (op === '<' && after === '=') continue
      if (op === '>' && after === '=') continue
      if (!(left in TERM_DEFS)) {
        throw new WhenParseError(`unknown term \`${left}\``)
      }
      return { term: left as TermName, op: op as Operator, value: parseScalarValue(right) }
    }
  }
  throw new WhenParseError(`could not parse condition: ${raw}`)
}

function parseListValue(s: string): string {
  // Accept `("a", "b")` or `[a, b]` or `("a","b")`.
  let inner = s.trim()
  if ((inner.startsWith('(') && inner.endsWith(')')) || (inner.startsWith('[') && inner.endsWith(']'))) {
    inner = inner.slice(1, -1)
  }
  return inner
    .split(',')
    .map(x => unquote(x.trim()))
    .filter(Boolean)
    .join(', ')
}

function parseScalarValue(s: string): string {
  return unquote(s.trim())
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

export function parseWhen(input: string): WhenExpr {
  const trimmed = stripWrapParens((input ?? '').trim())
  if (!trimmed) {
    throw new WhenParseError('empty expression')
  }
  const segments = tokenizeTopLevel(trimmed)
  const conditions: Condition[] = []
  const connectors: Connector[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg.type === 'cond') {
      conditions.push(parseCondition(seg.raw))
    } else {
      connectors.push(seg.value)
    }
  }
  if (conditions.length === 0) {
    throw new WhenParseError('no conditions found')
  }
  if (connectors.length !== conditions.length - 1) {
    throw new WhenParseError('mismatched conditions and connectors')
  }
  return { conditions, connectors }
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

function termType(term: TermName): 'enum' | 'int' | 'float' | 'bool' {
  return TERM_DEFS[term].type
}

function serializeValue(cond: Condition): string {
  const t = termType(cond.term)
  const op = cond.op
  if (op === 'in' || op === 'not in') {
    const items = cond.value.split(',').map(x => x.trim()).filter(Boolean)
    if (t === 'enum') {
      return '(' + items.map(x => `"${x}"`).join(', ') + ')'
    }
    return '(' + items.join(', ') + ')'
  }
  if (t === 'enum') {
    return `"${cond.value}"`
  }
  if (t === 'bool') {
    const v = cond.value.toLowerCase()
    if (v === 'true' || v === 'false') return v
    return cond.value
  }
  return cond.value
}

function serializeCondition(cond: Condition): string {
  const v = serializeValue(cond)
  return `${cond.term} ${cond.op} ${v}`
}

export function serializeWhen(expr: WhenExpr): string {
  if (expr.conditions.length === 0) return ''
  if (expr.conditions.length === 1) return serializeCondition(expr.conditions[0])

  // Group consecutive `and` runs, then join with ` or `. This preserves
  // Python's operator precedence (and binds tighter than or) without
  // adding parens unless they're necessary.
  const groups: string[][] = [[serializeCondition(expr.conditions[0])]]
  for (let i = 0; i < expr.connectors.length; i++) {
    const c = expr.connectors[i]
    const next = serializeCondition(expr.conditions[i + 1])
    if (c === 'and') {
      groups[groups.length - 1].push(next)
    } else {
      groups.push([next])
    }
  }
  if (groups.length === 1) return groups[0].join(' and ')
  return groups.map(g => (g.length > 1 ? `(${g.join(' and ')})` : g[0])).join(' or ')
}

export function defaultOpFor(term: TermName): Operator {
  const t = termType(term)
  if (t === 'enum') return '=='
  if (t === 'bool') return '=='
  return '>'
}

export function defaultValueFor(term: TermName): string {
  const def = TERM_DEFS[term]
  if (def.type === 'enum') return (def as { options: readonly string[] }).options[0]
  if (def.type === 'bool') return 'true'
  return '0'
}

export function operatorsFor(term: TermName): readonly Operator[] {
  const t = termType(term)
  if (t === 'enum') return OPS_ENUM
  if (t === 'bool') return OPS_BOOL
  return OPS_NUMERIC
}
