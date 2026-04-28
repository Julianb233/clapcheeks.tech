// AI-8762: Structured types for drip rules visual editor.
//
// These types model the YAML schema in agent/clapcheeks/conversation/drip.py.
// The wire format (Supabase column `drip_rules_yaml`) stays YAML — these
// types are only used inside the visual editor.

export const STAGE_VALUES = [
  'matched',
  'opened',
  'replying',
  'date_proposed',
  'date_booked',
  'date_done',
  'ongoing',
] as const
export type StageValue = (typeof STAGE_VALUES)[number]

export const PLATFORM_VALUES = ['tinder', 'hinge', 'bumble', 'instagram'] as const
export type PlatformValue = (typeof PLATFORM_VALUES)[number]

// Variables available in `when` expressions — names must match the agent.
// See agent/clapcheeks/conversation/drip.py.
export const TERM_DEFS = {
  stage: {
    type: 'enum' as const,
    options: STAGE_VALUES,
    label: 'stage',
  },
  message_count: {
    type: 'int' as const,
    label: 'message count',
  },
  days_in_stage: {
    type: 'int' as const,
    label: 'days in stage',
  },
  hours_since_theirs: {
    type: 'int' as const,
    label: 'hours since their last',
  },
  hours_since_last_ours: {
    type: 'int' as const,
    label: 'hours since our last',
  },
  hours_since_last_ts: {
    type: 'int' as const,
    label: 'hours since any message',
  },
  date_asked: {
    type: 'bool' as const,
    label: 'date asked?',
  },
  platform: {
    type: 'enum' as const,
    options: PLATFORM_VALUES,
    label: 'platform',
  },
  lead_score: {
    type: 'float' as const,
    label: 'lead score',
  },
} as const
export type TermName = keyof typeof TERM_DEFS

// Operators allowed per term type.
export const OPS_NUMERIC = ['==', '!=', '<', '<=', '>', '>='] as const
export const OPS_ENUM = ['==', '!=', 'in', 'not in'] as const
export const OPS_BOOL = ['==', '!='] as const
export type Operator =
  | (typeof OPS_NUMERIC)[number]
  | (typeof OPS_ENUM)[number]
  | (typeof OPS_BOOL)[number]

export type Connector = 'and' | 'or'

// One condition row: <term> <op> <value>.
// `value` is stored as a string for display; it is coerced on serialize.
export type Condition = {
  term: TermName
  op: Operator
  value: string // for `in` / `not in`, comma-separated list (e.g. `replying, opened`)
}

// A flat AND/OR chain — left-to-right. Mirrors how non-engineers think about
// "do this AND that OR the other". Python evaluates `and` before `or`, so we
// keep that ordering by wrapping `and`-runs in parens on serialize.
export type WhenExpr = {
  conditions: Condition[]
  connectors: Connector[] // length = conditions.length - 1
}

export const ACTION_NAMES = [
  'send_template',
  'send_reengagement',
  'send_date_ask',
  'send_ai_reply',
  'advance_stage',
  'mark_dead',
] as const
export type ActionName = (typeof ACTION_NAMES)[number]

export type Action = {
  name: ActionName
  args?: Record<string, string>
}

export type Rule = {
  id: string
  when: WhenExpr
  action: Action
  // If the YAML had something the visual editor can't render losslessly,
  // we keep the raw `when` string here and surface a warning. The rule can
  // still be edited by switching to raw-YAML mode.
  rawWhen?: string
  rawWhenInvalid?: string // human-readable parse error
}

export type Template = {
  name: string
  body: string
}

export type DripRulesModel = {
  templates: Template[]
  rules: Rule[]
}
