// AI-8762: YAML <-> DripRulesModel conversion.
//
// The Supabase column `drip_rules_yaml` stays a YAML string — this file
// translates that to/from the structured shape the visual editor uses.

import yaml from 'js-yaml'

import { parseWhen, serializeWhen, WhenParseError } from './expression'
import {
  ACTION_NAMES,
  type ActionName,
  type DripRulesModel,
  type Rule,
  type Template,
} from './types'

export type ParseResult =
  | { ok: true; model: DripRulesModel }
  | { ok: false; error: string; raw: string }

function isActionName(s: unknown): s is ActionName {
  return typeof s === 'string' && (ACTION_NAMES as readonly string[]).includes(s)
}

export function parseDripYaml(input: string): ParseResult {
  let doc: unknown
  try {
    doc = yaml.load(input ?? '')
  } catch (e) {
    return {
      ok: false,
      error: `YAML syntax error: ${e instanceof Error ? e.message : String(e)}`,
      raw: input,
    }
  }
  if (doc == null) {
    return { ok: true, model: { templates: [], rules: [] } }
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: 'Top level must be a YAML mapping', raw: input }
  }

  const obj = doc as Record<string, unknown>

  // Templates
  const templates: Template[] = []
  if (obj.templates && typeof obj.templates === 'object' && !Array.isArray(obj.templates)) {
    for (const [name, body] of Object.entries(obj.templates as Record<string, unknown>)) {
      templates.push({ name, body: typeof body === 'string' ? body : String(body ?? '') })
    }
  }

  // Rules
  const rules: Rule[] = []
  const rulesRaw = obj.rules
  if (Array.isArray(rulesRaw)) {
    for (const r of rulesRaw) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue
      const row = r as Record<string, unknown>
      const id = typeof row.id === 'string' ? row.id : ''
      const whenStr = typeof row.when === 'string' ? row.when : ''
      const doVal = row.do
      let actionName: ActionName = 'send_ai_reply'
      if (isActionName(doVal)) actionName = doVal
      let args: Record<string, string> | undefined
      if (row.args && typeof row.args === 'object' && !Array.isArray(row.args)) {
        args = {}
        for (const [k, v] of Object.entries(row.args as Record<string, unknown>)) {
          args[k] = typeof v === 'string' ? v : String(v ?? '')
        }
      }

      let when
      let rawWhen: string | undefined
      let rawWhenInvalid: string | undefined
      try {
        when = parseWhen(whenStr)
      } catch (e) {
        rawWhen = whenStr
        rawWhenInvalid = e instanceof WhenParseError ? e.message : 'unparseable'
        // Leave a single-condition placeholder so the row renders.
        when = {
          conditions: [{ term: 'stage' as const, op: '==' as const, value: 'replying' }],
          connectors: [],
        }
      }

      rules.push({
        id,
        when,
        action: { name: actionName, args },
        rawWhen,
        rawWhenInvalid,
      })
    }
  }

  return { ok: true, model: { templates, rules } }
}

export function serializeDripModel(model: DripRulesModel): string {
  // Build the YAML by hand (rather than via js-yaml.dump) so we can force
  // double-quotes around template bodies, leave `when` strings unquoted
  // (matching the agent's hand-authored format), and keep `args` on a
  // single line.

  const lines: string[] = []
  const validTemplates = model.templates.filter(t => t.name)

  if (validTemplates.length > 0) {
    lines.push('templates:')
    for (const tpl of validTemplates) {
      lines.push(`  ${tpl.name}: ${quoteForYaml(tpl.body)}`)
    }
  }

  if (model.rules.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('rules:')
    for (const r of model.rules) {
      const whenStr = r.rawWhen != null ? r.rawWhen : serializeWhen(r.when)
      lines.push(`  - id: ${r.id}`)
      lines.push(`    when: ${whenStr}`)
      lines.push(`    do: ${r.action.name}`)
      if (r.action.args && Object.keys(r.action.args).length > 0) {
        const inner = Object.entries(r.action.args)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
        lines.push(`    args: { ${inner} }`)
      }
    }
  }

  // Trailing newline keeps git diffs sane.
  return lines.join('\n') + (lines.length > 0 ? '\n' : '')
}

function quoteForYaml(s: string): string {
  // Always wrap in double quotes; escape backslashes and embedded quotes.
  // We don't need full JSON escaping because the bodies are short message
  // templates — newline / control char support is unnecessary.
  const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}
