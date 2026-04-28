// AI-8762: Coverage for the drip rules visual editor's parse/serialize layer.
//
// The visual component (web/components/settings/drip-rule-builder.tsx) is a
// thin wrapper over these pure functions — every visual edit calls
// serializeDripModel(...) and bubbles the YAML up to the form. Vitest is
// configured for `node`, so we test the pure logic here; the React render
// is exercised by `next build` and manual smoke.

import { describe, expect, test } from 'vitest'

import {
  parseWhen,
  serializeWhen,
  defaultOpFor,
  defaultValueFor,
  operatorsFor,
} from '../lib/drip-rules/expression'
import { parseDripYaml, serializeDripModel } from '../lib/drip-rules/parser'
import type { DripRulesModel } from '../lib/drip-rules/types'

const KNOWN_GOOD_YAML = `templates:
  soft_bump: "hey, how's your week going?"
  confirm_date: "still good for our plan? :)"

rules:
  - id: followup_2d_silent
    when: stage == "replying" and hours_since_theirs > 48 and hours_since_theirs <= 120
    do: send_reengagement
  - id: opener_ghosted_3d
    when: stage == "opened" and hours_since_last_ours > 72 and hours_since_last_ours <= 168
    do: send_template
    args: { name: soft_bump }
  - id: archive_10d_dead
    when: stage in ("replying", "opened", "date_proposed") and hours_since_last_ts > 240
    do: mark_dead
`

describe('parseDripYaml', () => {
  test('parses a known-good YAML into the right shape', () => {
    const r = parseDripYaml(KNOWN_GOOD_YAML)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.templates.length).toBe(2)
    expect(r.model.templates[0].name).toBe('soft_bump')
    expect(r.model.templates[0].body).toBe("hey, how's your week going?")
    expect(r.model.rules.length).toBe(3)
    expect(r.model.rules[0].id).toBe('followup_2d_silent')
    expect(r.model.rules[0].when.conditions.length).toBe(3)
    expect(r.model.rules[0].when.conditions[0].term).toBe('stage')
    expect(r.model.rules[0].when.conditions[0].op).toBe('==')
    expect(r.model.rules[0].when.conditions[0].value).toBe('replying')
    expect(r.model.rules[0].when.connectors).toEqual(['and', 'and'])
    expect(r.model.rules[0].action.name).toBe('send_reengagement')
    expect(r.model.rules[1].action.name).toBe('send_template')
    expect(r.model.rules[1].action.args).toEqual({ name: 'soft_bump' })
  })

  test('parses `in` operator with quoted enum list', () => {
    const r = parseDripYaml(KNOWN_GOOD_YAML)
    if (!r.ok) throw new Error('parse failed')
    const archive = r.model.rules[2]
    const c0 = archive.when.conditions[0]
    expect(c0.term).toBe('stage')
    expect(c0.op).toBe('in')
    expect(c0.value).toBe('replying, opened, date_proposed')
  })

  test('returns ok=false on invalid YAML and preserves raw text', () => {
    const bad = 'rules: [unclosed\n  - bad: ]['
    const r = parseDripYaml(bad)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/YAML/)
    expect(r.raw).toBe(bad)
  })

  test('empty YAML returns empty model', () => {
    const r = parseDripYaml('')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.model.templates).toEqual([])
    expect(r.model.rules).toEqual([])
  })

  test('rule with unparseable `when` keeps raw expression and flags it', () => {
    const yaml = `rules:
  - id: weird
    when: not_a_real_term == "replying"
    do: send_ai_reply
`
    const r = parseDripYaml(yaml)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const rule = r.model.rules[0]
    expect(rule.rawWhen).toBeTruthy()
    expect(rule.rawWhenInvalid).toBeTruthy()
  })
})

describe('serializeDripModel', () => {
  test('round-trips the known-good YAML to a parseable equivalent', () => {
    const r = parseDripYaml(KNOWN_GOOD_YAML)
    if (!r.ok) throw new Error('parse failed')
    const out = serializeDripModel(r.model)
    expect(out).toContain('soft_bump:')
    expect(out).toContain('id: followup_2d_silent')
    expect(out).toContain('do: send_reengagement')
    // Re-parse the serialized output to confirm it survives.
    const round = parseDripYaml(out)
    expect(round.ok).toBe(true)
    if (!round.ok) return
    expect(round.model.rules.length).toBe(3)
    expect(round.model.rules[1].action.args).toEqual({ name: 'soft_bump' })
  })

  test('adding a rule shows up in serialized YAML with default values', () => {
    const r = parseDripYaml(KNOWN_GOOD_YAML)
    if (!r.ok) throw new Error('parse failed')
    const next: DripRulesModel = {
      ...r.model,
      rules: [
        ...r.model.rules,
        {
          id: 'brand_new',
          when: {
            conditions: [{ term: 'stage', op: '==', value: 'matched' }],
            connectors: [],
          },
          action: { name: 'send_ai_reply' },
        },
      ],
    }
    const out = serializeDripModel(next)
    expect(out).toContain('id: brand_new')
    expect(out).toContain('stage == "matched"')
    expect(out).toContain('do: send_ai_reply')
  })

  test('deleting a rule removes it from the YAML', () => {
    const r = parseDripYaml(KNOWN_GOOD_YAML)
    if (!r.ok) throw new Error('parse failed')
    const next: DripRulesModel = {
      ...r.model,
      rules: r.model.rules.filter(rule => rule.id !== 'followup_2d_silent'),
    }
    const out = serializeDripModel(next)
    expect(out).not.toContain('followup_2d_silent')
    expect(out).toContain('opener_ghosted_3d')
    expect(out).toContain('archive_10d_dead')
  })

  test('editing an expression term reflects in the YAML', () => {
    const r = parseDripYaml(KNOWN_GOOD_YAML)
    if (!r.ok) throw new Error('parse failed')
    const rules = r.model.rules.map((rule, i) => {
      if (i !== 0) return rule
      const conditions = rule.when.conditions.map((c, ci) =>
        ci === 1 ? { ...c, value: '99' } : c,
      )
      return { ...rule, when: { ...rule.when, conditions } }
    })
    const next: DripRulesModel = { ...r.model, rules }
    const out = serializeDripModel(next)
    // Original "> 48" should be replaced with "> 99".
    expect(out).toContain('hours_since_theirs > 99')
    expect(out).not.toContain('hours_since_theirs > 48')
  })

  test('templates with empty names are dropped, others survive', () => {
    const model: DripRulesModel = {
      templates: [
        { name: '', body: 'orphan' },
        { name: 'kept', body: 'hello' },
      ],
      rules: [],
    }
    const out = serializeDripModel(model)
    expect(out).toContain('kept: "hello"')
    expect(out).not.toContain('orphan')
  })
})

describe('parseWhen / serializeWhen', () => {
  test('round-trips a simple AND chain', () => {
    const expr = parseWhen('stage == "replying" and hours_since_theirs > 48')
    expect(expr.conditions.length).toBe(2)
    expect(expr.connectors).toEqual(['and'])
    const out = serializeWhen(expr)
    expect(out).toBe('stage == "replying" and hours_since_theirs > 48')
  })

  test('parses `in` with parenthesized enum list', () => {
    const expr = parseWhen('stage in ("replying", "opened")')
    expect(expr.conditions.length).toBe(1)
    expect(expr.conditions[0].op).toBe('in')
    expect(expr.conditions[0].value).toBe('replying, opened')
    const out = serializeWhen(expr)
    expect(out).toBe('stage in ("replying", "opened")')
  })

  test('parses `not in`', () => {
    const expr = parseWhen('platform not in ("tinder", "hinge")')
    expect(expr.conditions[0].op).toBe('not in')
    expect(expr.conditions[0].value).toBe('tinder, hinge')
  })

  test('groups AND-runs with parens when serializing OR chains', () => {
    const expr = parseWhen(
      'stage == "replying" and hours_since_theirs > 48 or stage == "opened"',
    )
    expect(expr.conditions.length).toBe(3)
    expect(expr.connectors).toEqual(['and', 'or'])
    const out = serializeWhen(expr)
    expect(out).toBe(
      '(stage == "replying" and hours_since_theirs > 48) or stage == "opened"',
    )
  })

  test('throws WhenParseError on unknown term', () => {
    expect(() => parseWhen('not_a_term == 1')).toThrow(/unknown term/)
  })

  test('throws on empty input', () => {
    expect(() => parseWhen('')).toThrow()
  })
})

describe('defaults helpers', () => {
  test('defaultOpFor enum -> ==', () => {
    expect(defaultOpFor('stage')).toBe('==')
  })
  test('defaultOpFor numeric -> >', () => {
    expect(defaultOpFor('hours_since_theirs')).toBe('>')
  })
  test('defaultValueFor stage is a stage value', () => {
    const v = defaultValueFor('stage')
    expect(typeof v).toBe('string')
    expect(v.length).toBeGreaterThan(0)
  })
  test('operatorsFor enum includes `in`', () => {
    expect(operatorsFor('stage')).toContain('in')
  })
  test('operatorsFor numeric includes `<=`', () => {
    expect(operatorsFor('hours_since_theirs')).toContain('<=')
  })
})
